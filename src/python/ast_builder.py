"""
AST Builder — AST-First Pipeline Architecture

This module builds a structured document AST using an incremental, AST-first approach:

  1. Create a flat AST: one DocumentRootNode → one ParagraphNode → one TextNode(raw_text)
  2. apply_passages_to_ast(): split text nodes around detected Bible passage boundaries
  3. segment_ast_paragraphs(): split remaining text-only paragraphs at semantic topic breaks
  4. Extract references, create DocumentState, return ASTBuilderResult

ARCHITECTURAL PRINCIPLE:
Each processing stage directly mutates the AST instead of producing intermediate data
structures that must later be aligned. Passage positions are used exactly once — at the
moment of extraction — eliminating all coordinate-space mismatch bugs.

There are NO parallel representations (List[QuoteBoundary], List[SentenceInfo],
List[List[int]]) that must be reconciled afterward. The AST is the single evolving
data representation throughout the pipeline.

IMPORTANT CONSTRAINTS:
- Passages MUST be the sole child of their containing paragraph node
- Passage boundaries from bible_quote_processor indicate actual verse TEXT
- Spoken references remain in paragraph text
- raw_text is NEVER modified; all positions reference the original text
"""

import re
import time
import sys
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass

# Import from the document model
from document_model import (
    NodeId,
    DocumentState,
    DocumentRootNode,
    ParagraphNode,
    TextNode,
    PassageNode,
    InterjectionNode,
    BibleReferenceMetadata,
    QuoteDetectionMetadata,
    InterjectionMetadata,
    PassageMetadata,
    ExtractedReferences,
    ProcessingMetadata,
    ASTBuilderResult,
    create_text_node,
    create_paragraph_node,
    create_passage_node,
    create_document_root,
    create_document_state,
    generate_node_id,
    get_confidence_level,
)

# Import QuoteBoundary and normalization utilities from bible_quote_processor
from bible_quote_processor import (
    QuoteBoundary,
    BibleReference,
    BibleAPIClient,
    ReferenceNormalization,
    normalize_bible_references_in_segment,
)


# ============================================================================
# SENTENCE TOKENIZATION (shared with main.py to avoid circular imports)
# ============================================================================

@dataclass
class SentenceInfo:
    """A sentence with its position in the original raw text.
    
    This is the fundamental unit of the integrated pipeline. By working with
    sentence tokens instead of mutated text, we avoid all character offset
    drift issues that arise from text modifications (adding paragraph breaks,
    quotation marks, etc.).
    """
    index: int           # Sentence index (0-based)
    text: str            # The sentence text
    start_pos: int       # Character start position in raw_text
    end_pos: int         # Character end position in raw_text


def tokenize_sentences(text: str) -> List[SentenceInfo]:
    """
    Split raw text into sentence tokens with character positions.
    
    Uses the same sentence-splitting regex as paragraph segmentation to ensure
    consistency. Each SentenceInfo records its position in the ORIGINAL text,
    which is the single source of truth for all downstream operations.
    
    Args:
        text: Raw text to tokenize (NOT modified text)
    
    Returns:
        List of SentenceInfo with positions in original text
    """
    stripped = text.strip()
    if not stripped:
        return []
    
    # Split into sentences using the same regex as segment_into_paragraphs
    sentence_texts = re.split(r'(?<=[.!?])\s+', stripped)
    
    sentences = []
    current_pos = 0
    
    for idx, sent_text in enumerate(sentence_texts):
        if not sent_text:
            continue
        # Find the actual position in the original text
        start_pos = text.find(sent_text, current_pos)
        if start_pos == -1:
            # Fallback: use current position (shouldn't happen with well-formed text)
            start_pos = current_pos
        end_pos = start_pos + len(sent_text)
        
        sentences.append(SentenceInfo(
            index=idx,
            text=sent_text,
            start_pos=start_pos,
            end_pos=end_pos
        ))
        current_pos = end_pos
    
    return sentences


# Prayer detection patterns - sentences that start prayers (NOT including "Amen" which ENDS prayers)
# These patterns should be SPECIFIC to prayer invocations, not just any sentence starting with "God" or "Lord"
PRAYER_START_PATTERNS = [
    r"^let'?s\s+pray",                          # "Let's pray"
    r"^let\s+us\s+pray",                        # "Let us pray"
    r"^dearly?\s+(heavenly\s+)?father",         # "Dear Father", "Dearly Father"  
    r"^dear\s+(lord|god)",                      # "Dear Lord", "Dear God"
    r"^(lord|father|god),?\s+(we|i)\s+(ask|pray|thank|come)\b",  # "Lord, we pray/ask/thank/come"
    r"^in\s+jesus['']?\s+name",                 # "In Jesus' name"
    # NOTE: "Amen" is NOT a prayer start - it ENDS prayers. Handled separately below.
]

# Pattern to detect sentences that END with "Amen" (prayer endings)
# This matches "Amen.", "In Jesus' name we pray, Amen.", etc.
AMEN_END_PATTERN = r"\bamen\s*[.!]?\s*$"


# ============================================================================
# BUILDER CONFIGURATION
# ============================================================================

@dataclass
class ASTBuilderConfig:
    """Configuration for AST builder."""
    min_quote_confidence: float = 0.4
    include_low_confidence: bool = True
    normalize_whitespace: bool = True
    max_text_node_length: int = 10000


# ============================================================================
# DEBUG LOGGING
# ============================================================================

def _debug_log(message: str, debug: bool = False, prefix: str = "[AST]"):
    """Print debug message if debug mode is enabled."""
    if debug:
        print(f"{prefix} {message}", file=sys.stderr, flush=True)


# ============================================================================
# STANDALONE HELPER FUNCTIONS
# ============================================================================

def _filter_passages(
    passages: List[QuoteBoundary],
    min_confidence: float = 0.4
) -> List[QuoteBoundary]:
    """Filter passages by confidence threshold."""
    return [p for p in passages if p.confidence >= min_confidence]


def _build_passage_node(quote: QuoteBoundary, content: str) -> PassageNode:
    """
    Build a PassageNode from a QuoteBoundary and its extracted content.

    Creates the full metadata structure including interjection nodes
    when the quote contains speaker interjections.
    """
    reference = BibleReferenceMetadata(
        book=quote.reference.book,
        chapter=quote.reference.chapter,
        verse_start=quote.reference.verse_start,
        verse_end=quote.reference.verse_end,
        original_text=quote.reference.original_text,
        normalized_reference=quote.reference.to_standard_format()
    )

    detection = QuoteDetectionMetadata(
        confidence=quote.confidence,
        confidence_level=get_confidence_level(quote.confidence),
        translation=quote.translation,
        translation_auto_detected=True,
        verse_text=quote.verse_text,
        is_partial_match=quote.confidence < 0.8
    )

    interjections: List[InterjectionMetadata] = []
    if quote.has_interjection and quote.interjection_positions:
        for interj_start, interj_end in quote.interjection_positions:
            rel_start = interj_start - quote.start_pos
            rel_end = interj_end - quote.start_pos
            rel_start = max(0, rel_start)
            rel_end = min(len(content), rel_end)

            if rel_start < rel_end:
                interj_text = content[rel_start:rel_end]
                interj_id = generate_node_id()
                interjections.append(InterjectionMetadata(
                    id=interj_id,
                    text=interj_text,
                    offset_start=rel_start,
                    offset_end=rel_end
                ))

    return create_passage_node(
        content=content,
        reference=reference,
        detection=detection,
        interjections=interjections if interjections else None
    )


def _verify_content_match(
    passage: QuoteBoundary,
    extracted_content: str,
    debug: bool = False
):
    """
    Debug check: verify extracted passage content overlaps with expected verse text.

    Logs a warning if word overlap between extracted content and known verse text
    falls below 30%, indicating a potential coordinate misalignment.
    """
    verse_words = set(re.findall(r'\w+', passage.verse_text.lower()))
    content_words = set(re.findall(r'\w+', extracted_content.lower()))

    if not verse_words or not content_words:
        return

    overlap = verse_words & content_words
    overlap_ratio = len(overlap) / len(verse_words) if verse_words else 0
    ref_str = passage.reference.to_standard_format()

    if overlap_ratio < 0.3:
        _debug_log(
            f"CONTENT MISMATCH WARNING for {ref_str}: "
            f"only {overlap_ratio:.0%} word overlap between extracted content "
            f"and verse text. Possible coordinate misalignment."
            f"\n  Extracted: '{extracted_content[:80]}...'"
            f"\n  Expected:  '{passage.verse_text[:80]}...'",
            True
        )
    elif debug:
        _debug_log(
            f"Content match OK for {ref_str}: {overlap_ratio:.0%} word overlap",
            debug
        )


def _extract_references(passages: List[QuoteBoundary]) -> List[str]:
    """Extract and deduplicate reference strings from passage list."""
    seen: set = set()
    references: List[str] = []
    for passage in passages:
        ref_str = passage.reference.to_standard_format()
        if ref_str not in seen:
            seen.add(ref_str)
            references.append(ref_str)
    return references


# ============================================================================
# TRAILING PUNCTUATION ABSORPTION
# ============================================================================

# Punctuation characters that should stay attached to a passage's trailing word
# rather than appearing at the start of the next text node.
_TRAILING_PUNCT_RE = re.compile(r'^[.,:;!?\-\u2014\u2013\'"\)\]\u2019\u201D\u2026]+')


def _extend_past_trailing_punctuation(
    raw_text: str,
    end_pos: int,
    segment_end: int,
    debug: bool = False
) -> int:
    """
    Extend end_pos to absorb any punctuation immediately following the last word.

    bible_quote_processor determines passage boundaries using word-boundary
    matching (\\b\\w+\\b), so end_pos typically stops at the last alphanumeric
    character.  Any sentence-ending punctuation (period, comma, semicolon,
    exclamation/question mark, closing quotes, etc.) is left stranded at the
    start of the next text node.  This function fixes that by extending
    end_pos to include those characters.

    Args:
        raw_text: The immutable original transcript text
        end_pos: Current passage end position (exclusive)
        segment_end: End of the containing text segment (upper bound)
        debug: Enable debug logging

    Returns:
        Adjusted end_pos that includes trailing punctuation (capped at segment_end)
    """
    if end_pos >= segment_end or end_pos >= len(raw_text):
        return end_pos

    remaining = raw_text[end_pos:min(end_pos + 10, segment_end)]
    punct_match = _TRAILING_PUNCT_RE.match(remaining)

    if punct_match:
        new_end = end_pos + punct_match.end()
        if debug:
            _debug_log(
                f"  Absorbed trailing punctuation: "
                f"'{punct_match.group()}' (end_pos {end_pos} → {new_end})",
                debug
            )
        return min(new_end, segment_end)

    return end_pos


# ============================================================================
# PHASE 1: APPLY PASSAGES TO AST
# ============================================================================

def apply_passages_to_ast(
    root: DocumentRootNode,
    raw_text: str,
    quote_boundaries: List[QuoteBoundary],
    min_confidence: float = 0.4,
    debug: bool = False
) -> Tuple[DocumentRootNode, List[QuoteBoundary]]:
    """
    Split a flat AST around detected Bible passages.

    Takes a DocumentRootNode (initially containing one ParagraphNode → one TextNode)
    and splits it so that each passage becomes the sole child of its own ParagraphNode.

    Passages are processed in REVERSE start_pos order (GUD-001) to avoid index
    shifting when splitting text segments.

    Uses a segment-based approach:
      1. Represent the document as a list of text/passage segments with positions
      2. For each passage (reverse order), find the containing text segment and split it
      3. After all passages are processed, convert segments to AST nodes

    Args:
        root: DocumentRootNode to modify (mutated in place)
        raw_text: The immutable original text
        quote_boundaries: QuoteBoundary list from bible_quote_processor
        min_confidence: Minimum confidence for passage inclusion
        debug: Enable debug logging

    Returns:
        Tuple of (modified root, list of valid passages that were applied)

    Invariants:
        - No empty TextNodes or empty ParagraphNodes are created
        - Each passage is the sole child of its containing ParagraphNode
        - Text content is preserved exactly (no text lost during splitting)
    """
    # Filter by confidence
    valid_passages = _filter_passages(quote_boundaries, min_confidence)

    if not valid_passages:
        _debug_log("No valid passages after filtering", debug)
        return root, valid_passages

    # Sort in REVERSE order by start_pos (GUD-001)
    sorted_passages = sorted(valid_passages, key=lambda p: p.start_pos, reverse=True)

    if debug:
        _debug_log("=" * 60, debug)
        _debug_log(f"Applying {len(sorted_passages)} passages to AST (reverse order)", debug)
        _debug_log("=" * 60, debug)

    # Represent document as a list of segments with positions in raw_text.
    # Each segment is either a text segment or a passage segment.
    # Initially one text segment spanning [0, len(raw_text)].
    segments: List[Dict[str, Any]] = [
        {'start': 0, 'end': len(raw_text), 'is_passage': False, 'passage': None}
    ]

    for passage in sorted_passages:
        ref_str = passage.reference.to_standard_format()

        if debug:
            _debug_log(f"Processing {ref_str} [{passage.start_pos}:{passage.end_pos}]", debug)
            preview = raw_text[passage.start_pos:passage.end_pos][:40].replace('\n', ' ')
            _debug_log(f"  Content preview: '{preview}...'", debug)

        # Find the text segment containing this passage's start_pos
        found = False
        for i, seg in enumerate(segments):
            if seg['is_passage']:
                continue
            if passage.start_pos >= seg['start'] and passage.start_pos < seg['end']:
                # Split this segment around the passage
                new_segs: List[Dict[str, Any]] = []
                passage_end = min(passage.end_pos, seg['end'])

                # Absorb trailing punctuation that the word-boundary
                # matcher in bible_quote_processor left behind
                passage_end = _extend_past_trailing_punctuation(
                    raw_text, passage_end, seg['end'], debug=debug
                )

                # Text before passage
                if passage.start_pos > seg['start']:
                    new_segs.append({
                        'start': seg['start'],
                        'end': passage.start_pos,
                        'is_passage': False,
                        'passage': None
                    })
                    if debug:
                        before_text = raw_text[seg['start']:passage.start_pos].strip()
                        preview = before_text[:50].replace('\n', ' ')
                        _debug_log(f"  Text-before: '{preview}...'", debug)

                # Passage segment
                new_segs.append({
                    'start': passage.start_pos,
                    'end': passage_end,
                    'is_passage': True,
                    'passage': passage
                })
                if debug:
                    p_content = raw_text[passage.start_pos:passage_end][:60].replace('\n', ' ')
                    _debug_log(f"  Passage ({ref_str}): '{p_content}...'", debug)

                # Text after passage
                if passage_end < seg['end']:
                    new_segs.append({
                        'start': passage_end,
                        'end': seg['end'],
                        'is_passage': False,
                        'passage': None
                    })
                    if debug:
                        after_text = raw_text[passage_end:seg['end']].strip()
                        preview = after_text[:50].replace('\n', ' ')
                        _debug_log(f"  Text-after: '{preview}...'", debug)

                # Replace original segment with the split
                segments[i:i + 1] = new_segs
                found = True
                break

        if not found:
            _debug_log(f"WARNING: Could not find text segment for {ref_str} "
                       f"(start_pos={passage.start_pos})", True)

    # Convert segments to AST nodes
    new_children: List[ParagraphNode] = []
    for seg in segments:
        if seg['is_passage']:
            passage = seg['passage']
            content = raw_text[seg['start']:seg['end']]
            content_normalized = re.sub(r'\s+', ' ', content).strip()

            # Verify content match in debug mode
            if debug and passage.verse_text:
                _verify_content_match(passage, content_normalized, debug)

            passage_node = _build_passage_node(passage, content_normalized)
            new_children.append(create_paragraph_node(children=[passage_node]))
        else:
            text = raw_text[seg['start']:seg['end']].strip()
            if text:
                new_children.append(create_paragraph_node(
                    children=[create_text_node(text)]
                ))

    root.children = new_children

    if debug:
        text_paras = sum(1 for c in root.children
                         if all(getattr(sub, 'type', '') == 'text' for sub in c.children))
        passage_paras = len(root.children) - text_paras
        _debug_log(f"After passage application: {text_paras} text paragraphs, "
                   f"{passage_paras} passage paragraphs", debug)

    return root, valid_passages


# ============================================================================
# PHASE 2: SEGMENT AST PARAGRAPHS
# ============================================================================

def _find_paragraph_breaks(
    sentences: List[Any],
    similarity_threshold: float = 0.55,
    min_sentences: int = 8,
    window_size: int = 3,
    debug: bool = False
) -> List[int]:
    """
    Find paragraph break points using semantic similarity analysis.

    Implements topic-change detection via embedding cosine similarity and
    prayer detection (break before prayer start, after Amen). Does NOT
    include quote-aware logic — passages are already isolated in their own
    paragraph nodes, so no don't-break-inside-quotes guard is needed.

    Args:
        sentences: List of SentenceInfo from tokenize_sentences()
        similarity_threshold: Cosine similarity threshold for topic change
        min_sentences: Minimum sentences before allowing a break
        window_size: Rolling average window for smoothing
        debug: Enable debug logging

    Returns:
        List of sentence indices where new paragraphs should START
    """
    from embedding_model import encode_texts

    sentence_texts = [s.text for s in sentences]

    if len(sentences) <= min_sentences:
        return []

    # Detect prayer starts and Amen endings
    prayer_start_sentences: set = set()
    amen_sentences: set = set()
    for sent_idx, sent_info in enumerate(sentences):
        sent_stripped = sent_info.text.strip()
        if re.search(AMEN_END_PATTERN, sent_stripped, re.IGNORECASE):
            amen_sentences.add(sent_idx)
        else:
            for pattern in PRAYER_START_PATTERNS:
                if re.search(pattern, sent_stripped, re.IGNORECASE):
                    prayer_start_sentences.add(sent_idx)
                    break

    if debug:
        if prayer_start_sentences:
            _debug_log(f"Detected {len(prayer_start_sentences)} prayer start(s)", debug)
        if amen_sentences:
            _debug_log(f"Detected {len(amen_sentences)} 'Amen' sentence(s)", debug)

    # Build prayer ranges
    sentences_in_prayers: set = set()
    primary_prayer_starts: set = set()
    prayer_ranges: List[Tuple[int, int]] = []
    sorted_prayer_starts = sorted(prayer_start_sentences)
    sorted_amens = sorted(amen_sentences)
    used_amens: set = set()

    for prayer_start_idx in sorted_prayer_starts:
        already_in_range = any(
            range_start <= prayer_start_idx <= range_end
            for range_start, range_end in prayer_ranges
        )
        if already_in_range:
            continue

        amen_idx = None
        for candidate_amen in sorted_amens:
            if candidate_amen > prayer_start_idx and candidate_amen not in used_amens:
                amen_idx = candidate_amen
                used_amens.add(amen_idx)
                break

        if amen_idx is not None:
            primary_prayer_starts.add(prayer_start_idx)
            prayer_ranges.append((prayer_start_idx, amen_idx))
            for idx in range(prayer_start_idx, amen_idx + 1):
                sentences_in_prayers.add(idx)

    # Get embeddings for all sentences
    if debug:
        _debug_log(f"Computing embeddings for {len(sentence_texts)} sentences...", debug)
    embeddings = encode_texts(sentence_texts, task="semantic_similarity")

    # Calculate cosine similarities between consecutive sentences
    similarities: List[float] = []
    for i in range(len(embeddings) - 1):
        cos_sim = float(np.dot(embeddings[i], embeddings[i + 1]) / (
            np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[i + 1])
        ))
        similarities.append(cos_sim)

    # Smooth similarities with rolling average
    smoothed: List[float] = []
    for i in range(len(similarities)):
        start_idx = max(0, i - window_size // 2)
        end_idx = min(len(similarities), i + window_size // 2 + 1)
        avg_sim = float(np.mean(similarities[start_idx:end_idx]))
        smoothed.append(avg_sim)

    # Find break points
    breaks: List[int] = []
    current_group_size = 1  # sentence 0 is already in the first group
    just_ended_prayer = False

    for i, similarity in enumerate(smoothed):
        next_sentence_idx = i + 1

        # Force paragraph break after prayer ending
        if just_ended_prayer:
            breaks.append(next_sentence_idx)
            current_group_size = 0
            just_ended_prayer = False

        # Force paragraph break before primary prayer start
        if next_sentence_idx in primary_prayer_starts:
            if current_group_size > 0:
                breaks.append(next_sentence_idx)
                current_group_size = 0
            current_group_size += 1
            continue

        # Amen sentences: add to current group, flag for break after
        if next_sentence_idx in amen_sentences:
            current_group_size += 1
            just_ended_prayer = True
            continue

        current_group_size += 1

        # Don't break inside prayers
        can_break = True
        if sentences_in_prayers:
            if next_sentence_idx in sentences_in_prayers:
                if ((next_sentence_idx + 1) < len(sentences)
                        and (next_sentence_idx + 1) in sentences_in_prayers):
                    can_break = False

        # Break on significant topic change
        if current_group_size >= min_sentences and can_break:
            if similarity < similarity_threshold:
                breaks.append(next_sentence_idx)
                current_group_size = 0

    if debug:
        _debug_log(f"Found {len(breaks)} break points", debug)

    return breaks


# ============================================================================
# STAGE 2b: NORMALIZE BIBLE REFERENCES IN TEXT NODES
# ============================================================================

def normalize_ast_references(
    root: DocumentRootNode,
    api_client: Optional[BibleAPIClient] = None,
    debug: bool = False,
) -> Tuple[DocumentRootNode, List[ReferenceNormalization]]:
    """
    Normalize malformed Bible references in TextNode content strings.

    Walks root.children, finds ParagraphNode children that are TextNode
    (not PassageNode), and applies normalize_bible_references_in_segment()
    to each TextNode.content. Updates TextNode.content in-place.

    PassageNode content is NEVER modified (it contains actual Bible verse
    text, not spoken references).

    This runs as Stage 2b in the AST pipeline — after apply_passages_to_ast()
    and before segment_ast_paragraphs().

    Args:
        root: DocumentRootNode to process (mutated in place)
        api_client: Optional BibleAPIClient for online verification
        debug: Enable debug logging

    Returns:
        Tuple of (root, all_normalizations). root is the same object,
        mutated in place. all_normalizations is a flat list of every
        ReferenceNormalization applied across all TextNodes.
    """
    all_normalizations: List[ReferenceNormalization] = []

    for para in root.children:
        if not isinstance(para, ParagraphNode):
            continue
        for child in para.children:
            # Only normalize TextNode content, skip PassageNode
            if not isinstance(child, TextNode):
                continue
            if child.type != 'text':
                continue
            if not child.content or not child.content.strip():
                continue

            normalized_text, norms = normalize_bible_references_in_segment(
                child.content,
                api_client=api_client,
            )

            if norms:
                child.content = normalized_text
                all_normalizations.extend(norms)
                if debug:
                    for n in norms:
                        _debug_log(
                            f"Normalized: '{n.original_text}' → '{n.normalized_text}' "
                            f"(rule: {n.rule_applied})",
                            debug,
                        )

    if debug:
        _debug_log(
            f"Stage 2b: Applied {len(all_normalizations)} reference normalizations",
            debug,
        )

    return root, all_normalizations


def segment_ast_paragraphs(
    root: DocumentRootNode,
    similarity_threshold: float = 0.55,
    min_sentences: int = 8,
    window_size: int = 3,
    debug: bool = False
) -> DocumentRootNode:
    """
    Segment text-only ParagraphNodes in the AST using semantic similarity.

    Walks root.children, identifies text-only paragraphs (children are TextNodes
    only, not PassageNodes), and splits them at topic-change boundaries detected
    via embedding cosine similarity. Includes prayer detection (break before
    prayer start, after Amen).

    Passage paragraphs are never modified — they are skipped entirely.

    For text blocks shorter than min_sentences, no segmentation is performed
    (they are kept as single paragraphs).

    Args:
        root: DocumentRootNode to modify (mutated in place)
        similarity_threshold: Cosine similarity threshold for topic change
        min_sentences: Minimum sentences before allowing a break
        window_size: Rolling average window for smoothing
        debug: Enable debug logging

    Returns:
        The modified DocumentRootNode
    """
    new_children: List[ParagraphNode] = []

    for child_idx, child in enumerate(root.children):
        if child.type != 'paragraph':
            new_children.append(child)
            continue

        # Check if this is a text-only paragraph (no passage children)
        has_passage = any(
            hasattr(c, 'type') and c.type == 'passage'
            for c in child.children
        )

        if has_passage:
            # Passage paragraph — do not split
            new_children.append(child)
            continue

        # Get concatenated text content
        text_content = ''.join(
            c.content for c in child.children
            if hasattr(c, 'content')
        )

        if not text_content.strip():
            new_children.append(child)
            continue

        # Tokenize into sentences
        sentences = tokenize_sentences(text_content)

        if len(sentences) <= min_sentences:
            # Too few sentences — keep as single paragraph
            if debug:
                _debug_log(f"Text paragraph {child_idx}: {len(sentences)} sentences "
                           f"(≤ {min_sentences}), skipping segmentation", debug)
            new_children.append(child)
            continue

        # Find break points using semantic similarity + prayer detection
        break_indices = _find_paragraph_breaks(
            sentences,
            similarity_threshold=similarity_threshold,
            min_sentences=min_sentences,
            window_size=window_size,
            debug=debug
        )

        if not break_indices:
            # No breaks found — keep as single paragraph
            if debug:
                _debug_log(f"Text paragraph {child_idx}: no breaks found in "
                           f"{len(sentences)} sentences", debug)
            new_children.append(child)
            continue

        # Split into multiple paragraphs at break points
        all_breaks = sorted(set([0] + break_indices + [len(sentences)]))

        para_count = 0
        for b_idx in range(len(all_breaks) - 1):
            start_sent = all_breaks[b_idx]
            end_sent = all_breaks[b_idx + 1]

            if start_sent >= end_sent:
                continue

            # Extract text for this paragraph using sentence positions
            para_start = sentences[start_sent].start_pos
            para_end = sentences[end_sent - 1].end_pos
            para_text = text_content[para_start:para_end].strip()

            if para_text:
                new_children.append(create_paragraph_node(
                    children=[create_text_node(para_text)]
                ))
                para_count += 1

        if debug:
            _debug_log(f"Text paragraph {child_idx}: split into {para_count} "
                       f"paragraphs from {len(sentences)} sentences "
                       f"({len(break_indices)} break points)", debug)

    root.children = new_children
    return root


# ============================================================================
# AST BUILDER (AST-FIRST PIPELINE)
# ============================================================================

class ASTBuilder:
    """
    Builds a document AST using the AST-first pipeline:

      1. Create initial flat AST: DocumentRootNode → ParagraphNode → TextNode(raw_text)
      2. apply_passages_to_ast(): split around Bible passage boundaries
      2b. normalize_ast_references(): normalize malformed Bible references in TextNode content
      3. segment_ast_paragraphs(): split text paragraphs at semantic topic changes
      4. Extract references and create DocumentState

    No intermediate data structures (sentence lists, paragraph groups) are passed
    between stages — each stage reads from and writes to the AST directly.
    """

    def __init__(self, config: Optional[ASTBuilderConfig] = None, debug: bool = False,
                 api_client: Optional[BibleAPIClient] = None):
        self.config = config or ASTBuilderConfig()
        self.processing_metadata = ProcessingMetadata()
        self._stage_start_time: Optional[float] = None
        self.debug = debug
        self._api_client = api_client

    def _start_stage(self, stage_name: str):
        """Start timing a stage."""
        self._stage_start_time = time.time()

    def _end_stage(self, stage_name: str):
        """End timing a stage and record duration."""
        if self._stage_start_time is not None:
            duration_ms = (time.time() - self._stage_start_time) * 1000
            self.processing_metadata.stage_times[stage_name] = duration_ms
            self._stage_start_time = None

    def build(
        self,
        raw_text: str,
        quote_boundaries: List[QuoteBoundary],
        title: Optional[str] = None,
        bible_passage: Optional[str] = None,
        speaker: Optional[str] = None,
        tags: Optional[List[str]] = None,
        similarity_threshold: float = 0.45,
        min_sentences: int = 5,
        window_size: int = 3,
    ) -> ASTBuilderResult:
        """
        Build document AST from raw text and quote boundaries.

        AST-first pipeline:
          1. Create initial flat AST (one ParagraphNode → one TextNode)
          2. Apply passages (split around detected Bible quotes)
          2b. Normalize Bible references in TextNode content
          3. Segment paragraphs (split text at semantic topic changes)
          4. Extract references from passage nodes
          5. Create DocumentState and return ASTBuilderResult

        Args:
            raw_text: The immutable original transcript text
            quote_boundaries: QuoteBoundary list from bible_quote_processor
            title: Document title (from audio metadata)
            bible_passage: Bible passage reference (from audio metadata)
            speaker: Speaker name (from audio metadata)
            tags: Extracted tags
            similarity_threshold: For paragraph segmentation topic change detection
            min_sentences: Minimum sentences before allowing a paragraph break
            window_size: Rolling average window for similarity smoothing

        Returns:
            ASTBuilderResult containing DocumentState and ProcessingMetadata
        """
        start_time = time.time()

        if self.debug:
            _debug_log("=" * 60, self.debug)
            _debug_log("AST Builder (AST-First): Starting construction", self.debug)
            _debug_log(f"Raw text length: {len(raw_text)} chars", self.debug)
            _debug_log(f"Quote boundaries: {len(quote_boundaries)}", self.debug)
            _debug_log("=" * 60, self.debug)

        # Validate quote boundary coordinates
        text_len = len(raw_text)
        for qb in quote_boundaries:
            ref_str = qb.reference.to_standard_format()
            if qb.start_pos < 0 or qb.start_pos >= text_len:
                _debug_log(f"WARNING: {ref_str} start_pos={qb.start_pos} is out of "
                           f"bounds [0, {text_len})", True)
            if qb.end_pos <= 0 or qb.end_pos > text_len:
                _debug_log(f"WARNING: {ref_str} end_pos={qb.end_pos} is out of "
                           f"bounds (0, {text_len}]", True)
            if qb.start_pos >= qb.end_pos:
                _debug_log(f"WARNING: {ref_str} has empty range "
                           f"[{qb.start_pos}, {qb.end_pos})", True)
            else:
                extracted = raw_text[qb.start_pos:qb.end_pos].strip()
                if not extracted:
                    _debug_log(f"WARNING: {ref_str} extracts empty content from "
                               f"raw_text[{qb.start_pos}:{qb.end_pos}]", True)

        # Stage 1: Create initial flat AST
        self._start_stage('create_initial_ast')
        initial_text = create_text_node(raw_text)
        initial_para = create_paragraph_node(children=[initial_text])
        root = create_document_root(
            children=[initial_para],
            title=title,
            bible_passage=bible_passage,
            speaker=speaker,
            tags=tags
        )
        self._end_stage('create_initial_ast')

        if self.debug:
            _debug_log("Stage 1: Created initial flat AST "
                       f"(1 paragraph, 1 text node, {len(raw_text)} chars)", self.debug)

        # Stage 2: Apply passages to AST
        self._start_stage('apply_passages')
        root, valid_passages = apply_passages_to_ast(
            root, raw_text, quote_boundaries,
            min_confidence=self.config.min_quote_confidence,
            debug=self.debug
        )
        self._end_stage('apply_passages')

        if self.debug:
            _debug_log(f"Stage 2: Applied {len(valid_passages)} passages", self.debug)

        # Stage 2b: Normalize Bible references in TextNode content
        self._start_stage('normalize_references')
        root, ref_normalizations = normalize_ast_references(
            root,
            api_client=self._api_client,
            debug=self.debug,
        )
        self._end_stage('normalize_references')

        if self.debug:
            _debug_log(
                f"Stage 2b: {len(ref_normalizations)} reference normalizations applied",
                self.debug,
            )

        # Stage 3: Segment text paragraphs
        self._start_stage('segment_paragraphs')
        root = segment_ast_paragraphs(
            root,
            similarity_threshold=similarity_threshold,
            min_sentences=min_sentences,
            window_size=window_size,
            debug=self.debug
        )
        self._end_stage('segment_paragraphs')

        if self.debug:
            _debug_log(f"Stage 3: Segmented into {len(root.children)} paragraphs", self.debug)

        # Stage 4: Extract references
        self._start_stage('extract_references')
        references = _extract_references(valid_passages)
        self._end_stage('extract_references')

        # Stage 5: Create document state
        self._start_stage('create_state')
        state = create_document_state(
            root=root,
            references=references,
            tags=tags or []
        )
        self._end_stage('create_state')

        # Update processing metadata
        self.processing_metadata.total_time = (time.time() - start_time) * 1000
        self.processing_metadata.paragraph_count = len(root.children)
        self.processing_metadata.passage_count = len(valid_passages)
        self.processing_metadata.interjection_count = sum(
            1 for qb in valid_passages if qb.has_interjection
            for _ in (qb.interjection_positions or [])
        )
        self.processing_metadata.normalization_count = len(ref_normalizations)

        if self.debug:
            _debug_log("=" * 60, self.debug)
            _debug_log("AST Builder: Construction complete", self.debug)
            _debug_log(f"Paragraphs: {self.processing_metadata.paragraph_count}", self.debug)
            _debug_log(f"Passages: {self.processing_metadata.passage_count}", self.debug)
            _debug_log(f"Interjections: {self.processing_metadata.interjection_count}", self.debug)
            _debug_log(f"Total time: {self.processing_metadata.total_time:.2f}ms", self.debug)
            _debug_log("=" * 60, self.debug)

        return ASTBuilderResult(
            document_state=state,
            processing_metadata=self.processing_metadata
        )


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def build_ast(
    raw_text: str,
    quote_boundaries: List[QuoteBoundary],
    title: Optional[str] = None,
    bible_passage: Optional[str] = None,
    speaker: Optional[str] = None,
    tags: Optional[List[str]] = None,
    config: Optional[ASTBuilderConfig] = None,
    debug: bool = False,
    similarity_threshold: float = 0.45,
    min_sentences: int = 5,
    window_size: int = 3,
    api_client: Optional[BibleAPIClient] = None,
) -> ASTBuilderResult:
    """
    Build AST from raw text and quote boundaries (AST-first pipeline).

    This is the primary entry point for AST construction. Creates an initial
    flat AST, applies passage boundaries, normalizes Bible references in
    TextNode content, then segments text paragraphs using semantic similarity.

    Args:
        raw_text: The immutable original transcript text
        quote_boundaries: QuoteBoundary list from bible_quote_processor
        title: Document title
        bible_passage: Bible passage reference
        speaker: Speaker name
        tags: Extracted tags
        config: Optional ASTBuilderConfig
        debug: Enable debug logging
        similarity_threshold: For paragraph segmentation
        min_sentences: Minimum sentences for a paragraph
        window_size: Similarity smoothing window
        api_client: Optional BibleAPIClient for reference verification

    Returns:
        ASTBuilderResult containing DocumentState and ProcessingMetadata
    """
    builder = ASTBuilder(config=config, debug=debug, api_client=api_client)
    return builder.build(
        raw_text=raw_text,
        quote_boundaries=quote_boundaries,
        title=title,
        bible_passage=bible_passage,
        speaker=speaker,
        tags=tags,
        similarity_threshold=similarity_threshold,
        min_sentences=min_sentences,
        window_size=window_size,
    )
