"""
AST Builder - Integrated Pipeline AST Construction

This module builds a structured document AST directly from the pipeline data:
- Raw text (immutable source of truth for character positions)
- Sentence tokens (SentenceInfo with positions in raw_text)
- Paragraph groups (lists of sentence indices from semantic segmentation)
- Quote boundaries (QuoteBoundary with positions in raw_text)

ARCHITECTURAL PRINCIPLE:
The raw text is NEVER modified. All positions reference the original text.
This eliminates character offset drift that occurs when text is mutated
(e.g., adding paragraph breaks, quotation marks) and then positions need
to be remapped.

The pipeline flow is:
  raw_text -> tokenize_sentences() -> sentence tokens
  raw_text -> detect_passages() -> quote boundaries (positions in raw_text)
  sentences -> segment_into_paragraph_groups() -> paragraph groups
  (raw_text, sentences, groups, boundaries) -> build_ast() -> AST

IMPORTANT CONSTRAINTS:
- Passages MUST be the sole child of their containing paragraph node
- Passage boundaries from bible_quote_processor indicate actual verse TEXT
- Spoken references remain in paragraph text
"""

import re
import time
import sys
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

# Import QuoteBoundary from bible_quote_processor
from bible_quote_processor import QuoteBoundary, BibleReference

# Import SentenceInfo from main
from main import SentenceInfo


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
# AST BUILDER (INTEGRATED PIPELINE VERSION)
# ============================================================================

class ASTBuilder:
    """
    Builds a document AST directly from pipeline data.
    
    This is the integrated version that works with:
    - raw_text: the immutable original text
    - sentences: SentenceInfo tokens with positions in raw_text
    - paragraph_groups: lists of sentence indices from segmentation
    - quote_boundaries: QuoteBoundary with positions in raw_text
    
    NO text remapping is needed because all positions reference raw_text.
    """
    
    def __init__(self, config: Optional[ASTBuilderConfig] = None, debug: bool = False):
        self.config = config or ASTBuilderConfig()
        self.processing_metadata = ProcessingMetadata()
        self._stage_start_time: Optional[float] = None
        self.debug = debug
    
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
        sentences: List[SentenceInfo],
        paragraph_groups: List[List[int]],
        quote_boundaries: List[QuoteBoundary],
        title: Optional[str] = None,
        bible_passage: Optional[str] = None,
        speaker: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> ASTBuilderResult:
        """
        Build document AST from integrated pipeline data.
        
        All positions reference raw_text directly - no remapping needed.
        """
        start_time = time.time()
        
        if self.debug:
            _debug_log("=" * 60, self.debug)
            _debug_log("AST Builder (Integrated): Starting construction", self.debug)
            _debug_log(f"Raw text length: {len(raw_text)} chars", self.debug)
            _debug_log(f"Sentences: {len(sentences)}", self.debug)
            _debug_log(f"Paragraph groups: {len(paragraph_groups)}", self.debug)
            _debug_log(f"Passages: {len(quote_boundaries)}", self.debug)
            _debug_log("=" * 60, self.debug)
        
        # Filter quote boundaries by confidence
        valid_passages = self._filter_passages(quote_boundaries)
        
        # Stage 1: Map passages to paragraph groups
        self._start_stage('map_passages')
        group_passage_map = self._map_passages_to_groups(
            sentences, paragraph_groups, valid_passages
        )
        self._end_stage('map_passages')
        
        # Stage 2: Enforce single-paragraph passage constraint
        self._start_stage('enforce_constraints')
        paragraph_groups = self._enforce_single_paragraph_passages(
            paragraph_groups, valid_passages, sentences
        )
        # Re-map after potential group merging
        group_passage_map = self._map_passages_to_groups(
            sentences, paragraph_groups, valid_passages
        )
        self._end_stage('enforce_constraints')
        
        # Stage 3: Build paragraph nodes
        self._start_stage('build_nodes')
        paragraph_nodes = self._build_paragraph_nodes(
            raw_text, sentences, paragraph_groups, group_passage_map
        )
        self._end_stage('build_nodes')
        
        # Stage 4: Create document root
        self._start_stage('create_document')
        root = create_document_root(
            children=paragraph_nodes,
            title=title,
            bible_passage=bible_passage,
            speaker=speaker,
            tags=tags
        )
        self._end_stage('create_document')
        
        # Stage 5: Extract references
        self._start_stage('extract_references')
        references = self._extract_references(valid_passages)
        self._end_stage('extract_references')
        
        # Stage 6: Create document state
        self._start_stage('create_state')
        state = create_document_state(
            root=root,
            references=references,
            tags=tags or []
        )
        self._end_stage('create_state')
        
        # Update processing metadata
        self.processing_metadata.total_time = (time.time() - start_time) * 1000
        self.processing_metadata.paragraph_count = len(paragraph_nodes)
        self.processing_metadata.passage_count = len(valid_passages)
        self.processing_metadata.interjection_count = sum(
            1 for qb in valid_passages if qb.has_interjection
            for _ in (qb.interjection_positions or [])
        )
        
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
    
    def _filter_passages(self, passages: List[QuoteBoundary]) -> List[QuoteBoundary]:
        """Filter passages by confidence threshold."""
        return [p for p in passages if p.confidence >= self.config.min_quote_confidence]
    
    def _map_passages_to_groups(
        self,
        sentences: List[SentenceInfo],
        groups: List[List[int]],
        passages: List[QuoteBoundary]
    ) -> Dict[int, List[QuoteBoundary]]:
        """
        Map passages to paragraph groups using character positions in raw_text.
        
        A passage belongs to the paragraph group whose sentence range contains
        the passage's start_pos. Since both passages and sentences reference
        positions in the same raw_text, no remapping is needed.
        """
        group_map: Dict[int, List[QuoteBoundary]] = {i: [] for i in range(len(groups))}
        
        for passage in passages:
            assigned = False
            
            for group_idx, group in enumerate(groups):
                if not group:
                    continue
                
                group_start = sentences[group[0]].start_pos
                group_end = sentences[group[-1]].end_pos
                
                if passage.start_pos >= group_start and passage.start_pos < group_end:
                    group_map[group_idx].append(passage)
                    assigned = True
                    
                    if self.debug:
                        ref = passage.reference.to_standard_format()
                        _debug_log(f"Mapped {ref} to group {group_idx} "
                                   f"[{group_start}-{group_end}]", self.debug)
                    break
            
            if not assigned:
                if self.debug:
                    ref = passage.reference.to_standard_format()
                    _debug_log(f"WARNING: Could not map {ref} "
                               f"(start={passage.start_pos}) to any group", self.debug)
                
                # Fallback: overlap-based assignment
                for group_idx, group in enumerate(groups):
                    if not group:
                        continue
                    group_start = sentences[group[0]].start_pos
                    group_end = sentences[group[-1]].end_pos
                    if passage.start_pos < group_end and passage.end_pos > group_start:
                        group_map[group_idx].append(passage)
                        if self.debug:
                            _debug_log(f"  FALLBACK: assigned to group {group_idx}", self.debug)
                        break
        
        return group_map
    
    def _enforce_single_paragraph_passages(
        self,
        groups: List[List[int]],
        passages: List[QuoteBoundary],
        sentences: List[SentenceInfo]
    ) -> List[List[int]]:
        """
        Ensure each passage is fully contained within a single paragraph group.
        If a passage spans multiple groups, merge those groups.
        """
        if not passages:
            return groups
        
        groups = [list(g) for g in groups]
        
        for passage in passages:
            start_group_idx = None
            end_group_idx = None
            
            for group_idx, group in enumerate(groups):
                if not group:
                    continue
                group_start = sentences[group[0]].start_pos
                group_end = sentences[group[-1]].end_pos
                
                if start_group_idx is None and passage.start_pos >= group_start and passage.start_pos < group_end:
                    start_group_idx = group_idx
                if passage.end_pos > group_start and passage.end_pos <= group_end:
                    end_group_idx = group_idx
                    break
                if passage.end_pos > group_end:
                    end_group_idx = group_idx
            
            if (start_group_idx is not None and end_group_idx is not None
                and start_group_idx != end_group_idx):
                if self.debug:
                    ref = passage.reference.to_standard_format()
                    _debug_log(f"Merging groups {start_group_idx}-{end_group_idx} "
                               f"for passage {ref}", self.debug)
                
                merged = []
                for i in range(start_group_idx, end_group_idx + 1):
                    merged.extend(groups[i])
                
                groups = (
                    groups[:start_group_idx] +
                    [merged] +
                    groups[end_group_idx + 1:]
                )
        
        return [g for g in groups if g]
    
    def _build_paragraph_nodes(
        self,
        raw_text: str,
        sentences: List[SentenceInfo],
        groups: List[List[int]],
        group_passage_map: Dict[int, List[QuoteBoundary]]
    ) -> List[ParagraphNode]:
        """
        Build paragraph nodes with proper passage isolation.
        
        For paragraphs with passages, splits into separate nodes:
        - Text before passage -> separate paragraph
        - Passage -> paragraph with passage as sole child
        - Text after passage -> separate paragraph
        """
        result_nodes = []
        
        for group_idx, group in enumerate(groups):
            passages_in_group = group_passage_map.get(group_idx, [])
            
            group_start = sentences[group[0]].start_pos
            group_end = sentences[group[-1]].end_pos
            group_text = raw_text[group_start:group_end]
            
            if not passages_in_group:
                text_content = group_text.strip()
                if text_content:
                    result_nodes.append(create_paragraph_node(
                        children=[create_text_node(text_content)]
                    ))
            else:
                split_nodes = self._split_group_around_passages(
                    raw_text, group_start, group_end, group_text, passages_in_group
                )
                result_nodes.extend(split_nodes)
        
        return result_nodes
    
    def _split_group_around_passages(
        self,
        raw_text: str,
        group_start: int,
        group_end: int,
        group_text: str,
        passages: List[QuoteBoundary]
    ) -> List[ParagraphNode]:
        """
        Split a paragraph group around passages for structural isolation.
        
        Each passage becomes the sole child of its own paragraph node.
        Text before/after passages become separate paragraph nodes.
        
        All positions are in raw_text coordinates - no remapping needed.
        """
        nodes = []
        current_pos = group_start
        
        sorted_passages = sorted(passages, key=lambda p: p.start_pos)
        
        if self.debug:
            _debug_log(f"Splitting group [{group_start}-{group_end}] "
                       f"around {len(sorted_passages)} passages", self.debug)
        
        for passage in sorted_passages:
            ref_str = passage.reference.to_standard_format()
            
            if passage.start_pos < group_start or passage.start_pos >= group_end:
                if self.debug:
                    _debug_log(f"  Skipping {ref_str}: outside group bounds", self.debug)
                continue
            
            passage_end = min(passage.end_pos, group_end)
            
            # Text BEFORE passage
            if passage.start_pos > current_pos:
                text_before = raw_text[current_pos:passage.start_pos].strip()
                if text_before:
                    nodes.append(create_paragraph_node(
                        children=[create_text_node(text_before)]
                    ))
                    if self.debug:
                        preview = text_before[:50].replace('\n', ' ')
                        _debug_log(f"  Text-before: '{preview}...'", self.debug)
            
            # Passage (isolated)
            passage_content = raw_text[passage.start_pos:passage_end]
            passage_content = re.sub(r'\s+', ' ', passage_content).strip()
            
            passage_node = self._build_passage_node(passage, passage_content)
            passage_paragraph = create_paragraph_node(children=[passage_node])
            nodes.append(passage_paragraph)
            
            if self.debug:
                preview = passage_content[:60].replace('\n', ' ')
                _debug_log(f"  Passage ({ref_str}): '{preview}...'", self.debug)
            
            current_pos = passage_end
        
        # Text AFTER last passage
        if current_pos < group_end:
            text_after = raw_text[current_pos:group_end].strip()
            if text_after:
                nodes.append(create_paragraph_node(
                    children=[create_text_node(text_after)]
                ))
                if self.debug:
                    preview = text_after[:50].replace('\n', ' ')
                    _debug_log(f"  Text-after: '{preview}...'", self.debug)
        
        if not nodes:
            text = raw_text[group_start:group_end].strip()
            if text:
                nodes.append(create_paragraph_node(
                    children=[create_text_node(text)]
                ))
        
        return nodes
    
    def _build_passage_node(self, quote: QuoteBoundary, content: str) -> PassageNode:
        """Build a PassageNode from a QuoteBoundary and its content."""
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
        
        interjections = []
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
    
    def _extract_references(self, passages: List[QuoteBoundary]) -> List[str]:
        """Extract and deduplicate reference strings."""
        seen = set()
        references = []
        for passage in passages:
            ref_str = passage.reference.to_standard_format()
            if ref_str not in seen:
                seen.add(ref_str)
                references.append(ref_str)
        return references


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def build_ast(
    raw_text: str,
    sentences: List[SentenceInfo],
    paragraph_groups: List[List[int]],
    quote_boundaries: List[QuoteBoundary],
    title: Optional[str] = None,
    bible_passage: Optional[str] = None,
    speaker: Optional[str] = None,
    tags: Optional[List[str]] = None,
    config: Optional[ASTBuilderConfig] = None,
    debug: bool = False
) -> ASTBuilderResult:
    """
    Build AST from integrated pipeline data.
    
    This is the primary entry point for AST construction. All positions
    reference raw_text directly - no remapping needed.
    """
    builder = ASTBuilder(config=config, debug=debug)
    return builder.build(
        raw_text=raw_text,
        sentences=sentences,
        paragraph_groups=paragraph_groups,
        quote_boundaries=quote_boundaries,
        title=title,
        bible_passage=bible_passage,
        speaker=speaker,
        tags=tags
    )
