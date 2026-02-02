"""
AST Builder - Transforms processed text into structured document model

This module takes the output from the existing bible_quote_processor (text with passages
and QuoteBoundary objects) and transforms it into the new Hybrid AST document model.

The builder:
1. Takes paragraphed text with embedded passage marks
2. Takes QuoteBoundary objects with rich metadata (passage boundaries)
3. Builds a proper AST with stable node IDs
4. Preserves all metadata (confidence, translation, interjections)
5. Creates event log for the document creation

IMPORTANT CONSTRAINTS:
- Passages MUST NOT span multiple paragraphs (single-paragraph passage constraint)
- Passage boundaries from bible_quote_processor.py indicate actual verse TEXT, not references
- Spoken references (e.g., "Romans 12:1 says Paul writes") remain in paragraph text

This is a bridge module that allows incremental migration from the old system.
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


# ============================================================================
# BUILDER CONFIGURATION
# ============================================================================

@dataclass
class ASTBuilderConfig:
    """Configuration for AST builder."""
    # Minimum confidence to include a passage
    min_quote_confidence: float = 0.4
    # Whether to include low-confidence passages (with warning flag)
    include_low_confidence: bool = True
    # Whether to strip extra whitespace from text nodes
    normalize_whitespace: bool = True
    # Maximum text node length before splitting
    max_text_node_length: int = 10000


# ============================================================================
# DEBUG LOGGING
# ============================================================================

def _debug_log(message: str, debug: bool = False, prefix: str = "[AST]"):
    """Print debug message if debug mode is enabled."""
    if debug:
        print(f"{prefix} {message}", file=sys.stderr, flush=True)


def _debug_passage_boundary(passage, full_text: str, debug: bool = False):
    """Log detailed passage boundary information for debugging."""
    if not debug:
        return
    
    ref_str = passage.reference.to_standard_format()
    _debug_log(f"Passage boundary for {ref_str}:", debug)
    _debug_log(f"  Absolute positions: start={passage.start_pos}, end={passage.end_pos}", debug)
    _debug_log(f"  Passage length: {passage.end_pos - passage.start_pos} chars", debug)
    _debug_log(f"  Confidence: {passage.confidence:.2%}", debug)
    
    # Show actual text at those positions (truncated)
    if 0 <= passage.start_pos < len(full_text) and 0 <= passage.end_pos <= len(full_text):
        actual_text = full_text[passage.start_pos:passage.end_pos]
        preview = actual_text[:100].replace('\n', ' ')
        _debug_log(f"  Actual text at positions: '{preview}...'", debug)
    else:
        _debug_log(f"  WARNING: Positions out of range (text length: {len(full_text)})", debug)
    
    # Show verse text from API for comparison
    verse_preview = passage.verse_text[:80].replace('\n', ' ') if passage.verse_text else "(no verse text)"
    _debug_log(f"  Expected verse text: '{verse_preview}...'", debug)


def _debug_paragraph_info(para_idx: int, para_start: int, para_end: int, para_content: str, debug: bool = False):
    """Log paragraph boundary information for debugging."""
    if not debug:
        return
    
    _debug_log(f"Paragraph {para_idx}:", debug)
    _debug_log(f"  Absolute bounds: [{para_start}, {para_end}]", debug)
    _debug_log(f"  Length: {para_end - para_start} chars (content: {len(para_content)} chars)", debug)
    
    # Show preview of paragraph content
    preview = para_content[:80].replace('\n', ' ')
    _debug_log(f"  Content preview: '{preview}...'", debug)


def _debug_passage_mapping(passage, para_idx: int, para_start: int, para_end: int, debug: bool = False):
    """Log passage-to-paragraph mapping decision for debugging."""
    if not debug:
        return
    
    ref_str = passage.reference.to_standard_format()
    in_para = passage.start_pos >= para_start and passage.start_pos < para_end
    _debug_log(f"Mapping {ref_str} to paragraph {para_idx}:", debug)
    _debug_log(f"  Passage start ({passage.start_pos}) in para [{para_start}, {para_end}]: {in_para}", debug)
    
    if not in_para:
        distance = passage.start_pos - para_end if passage.start_pos >= para_end else para_start - passage.start_pos
        _debug_log(f"  WARNING: Passage start is {distance} chars outside paragraph!", debug)


# ============================================================================
# AST BUILDER
# ============================================================================

class ASTBuilder:
    """
    Builds a document AST from processed text and quote boundaries.
    
    This is the bridge between the existing bible_quote_processor output
    and the new structured document model.
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
    
    def build_from_processed_text(
        self,
        paragraphed_text: str,
        quote_boundaries: List[QuoteBoundary],
        title: Optional[str] = None,
        bible_passage: Optional[str] = None,
        speaker: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> ASTBuilderResult:
        """
        Build document AST from processed text and passage boundaries.
        
        Args:
            paragraphed_text: Text with paragraph breaks (double newlines)
            quote_boundaries: List of QuoteBoundary objects from bible_quote_processor
                             (these represent passage boundaries, not displayed quotes)
            title: Document title (from metadata)
            bible_passage: Main Bible passage (from metadata)
            speaker: Speaker/Author (from metadata)
            tags: Extracted tags
        
        Returns:
            ASTBuilderResult with document state and processing metadata
        """
        start_time = time.time()
        
        if self.debug:
            _debug_log("=" * 60, self.debug)
            _debug_log("AST Builder: Starting document construction", self.debug)
            _debug_log(f"Text length: {len(paragraphed_text)} chars", self.debug)
            _debug_log(f"Passages to process: {len(quote_boundaries)}", self.debug)
            _debug_log("=" * 60, self.debug)
        
        # Stage 1: Parse paragraphs (passage-aware to enforce single-paragraph constraint)
        self._start_stage('parse_paragraphs')
        paragraphs = self._split_into_paragraphs(paragraphed_text, quote_boundaries)
        self._end_stage('parse_paragraphs')
        
        # Stage 2: Map passages to paragraphs
        self._start_stage('map_quotes')
        paragraph_quote_map = self._map_quotes_to_paragraphs(
            paragraphs, quote_boundaries, paragraphed_text
        )
        self._end_stage('map_quotes')
        
        # Stage 3: Build paragraph nodes
        self._start_stage('build_nodes')
        paragraph_nodes = self._build_paragraph_nodes(
            paragraphs, paragraph_quote_map, quote_boundaries, paragraphed_text
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
        
        # Stage 5: Extract references from passages
        self._start_stage('extract_references')
        references = self._extract_references(quote_boundaries)
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
        self.processing_metadata.passage_count = len(quote_boundaries)
        self.processing_metadata.interjection_count = sum(
            1 for qb in quote_boundaries if qb.has_interjection
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
    
    def _split_into_paragraphs(self, text: str, passage_boundaries: Optional[List[QuoteBoundary]] = None) -> List[Tuple[int, int, str]]:
        """
        Split text into paragraphs based on double newlines.
        
        IMPORTANT: This method enforces the single-paragraph passage constraint.
        If a passage would span multiple paragraphs, paragraph breaks are adjusted
        to ensure each passage is contained within a single paragraph.
        
        Args:
            text: The full transcript text
            passage_boundaries: Optional list of QuoteBoundary objects for passage-aware splitting
        
        Returns:
            List of (start_pos, end_pos, content) tuples
        """
        paragraphs = []
        current_pos = 0
        
        # Split on double newlines (paragraph breaks)
        parts = re.split(r'\n\n+', text)
        
        for part in parts:
            part_stripped = part.strip()
            if part_stripped:
                # Find actual position in original text
                start_pos = text.find(part, current_pos)
                if start_pos == -1:
                    # Fallback: use current position
                    start_pos = current_pos
                end_pos = start_pos + len(part)
                
                paragraphs.append((start_pos, end_pos, part_stripped))
                current_pos = end_pos
        
        # Debug logging for paragraph boundaries
        if self.debug:
            _debug_log(f"Split text into {len(paragraphs)} paragraphs:", self.debug)
            for i, (start, end, content) in enumerate(paragraphs):
                _debug_paragraph_info(i, start, end, content, self.debug)
        
        # Enforce single-paragraph passage constraint
        if passage_boundaries:
            paragraphs = self._enforce_single_paragraph_passages(paragraphs, passage_boundaries, text)
        
        return paragraphs
    
    def _enforce_single_paragraph_passages(
        self,
        paragraphs: List[Tuple[int, int, str]],
        passages: List[QuoteBoundary],
        full_text: str
    ) -> List[Tuple[int, int, str]]:
        """
        Ensure each passage is fully contained within a single paragraph.
        
        If a passage would span multiple paragraphs, merge those paragraphs
        to maintain the single-paragraph passage constraint.
        
        Args:
            paragraphs: List of (start_pos, end_pos, content) tuples
            passages: List of QuoteBoundary objects
            full_text: The full transcript text
        
        Returns:
            Adjusted list of paragraphs with passages properly contained
        """
        if not passages:
            return paragraphs
        
        # For each passage, check if it spans multiple paragraphs
        # and merge if necessary
        for passage in passages:
            start_para_idx = None
            end_para_idx = None
            
            for i, (para_start, para_end, _) in enumerate(paragraphs):
                # Find paragraph containing passage start
                if start_para_idx is None and passage.start_pos >= para_start and passage.start_pos < para_end:
                    start_para_idx = i
                # Find paragraph containing passage end
                if passage.end_pos > para_start and passage.end_pos <= para_end:
                    end_para_idx = i
                    break
                # Also handle case where passage end is at paragraph boundary
                if passage.end_pos > para_start and passage.end_pos >= para_end:
                    end_para_idx = i
            
            # If passage spans multiple paragraphs, merge them
            if start_para_idx is not None and end_para_idx is not None and start_para_idx != end_para_idx:
                ref_str = passage.reference.to_standard_format()
                if self.debug:
                    _debug_log(f"WARNING: Passage {ref_str} spans paragraphs {start_para_idx} to {end_para_idx}", self.debug)
                    _debug_log(f"  Merging paragraphs to enforce single-paragraph constraint", self.debug)
                
                # Merge paragraphs from start_para_idx to end_para_idx
                merged_start = paragraphs[start_para_idx][0]
                merged_end = paragraphs[end_para_idx][1]
                # Keep the raw content - positions are based on raw text
                # Content normalization (removing \n\n) happens during passage extraction
                merged_content = full_text[merged_start:merged_end].strip()
                
                # Replace the range of paragraphs with the merged one
                paragraphs = (
                    paragraphs[:start_para_idx] + 
                    [(merged_start, merged_end, merged_content)] + 
                    paragraphs[end_para_idx + 1:]
                )
                
                if self.debug:
                    _debug_log(f"  Merged into single paragraph [{merged_start}, {merged_end}]", self.debug)
        
        return paragraphs
    
    def _map_quotes_to_paragraphs(
        self,
        paragraphs: List[Tuple[int, int, str]],
        passages: List[QuoteBoundary],
        full_text: str
    ) -> Dict[int, List[QuoteBoundary]]:
        """
        Map passages to the paragraphs they appear in.
        
        CRITICAL FIX: This now checks if the passage START is within the paragraph,
        not just overlap. This ensures passages are correctly assigned to the paragraph
        containing their actual verse text, not the paragraph containing the reference.
        
        Args:
            paragraphs: List of (start_pos, end_pos, content) tuples
            passages: List of QuoteBoundary objects from bible_quote_processor
            full_text: The full transcript text (for debugging)
        
        Returns:
            Dict mapping paragraph index to list of QuoteBoundary objects in that paragraph
        """
        paragraph_passages: Dict[int, List[QuoteBoundary]] = {i: [] for i in range(len(paragraphs))}
        
        if self.debug:
            _debug_log(f"Mapping {len(passages)} passages to {len(paragraphs)} paragraphs:", self.debug)
        
        for passage in passages:
            # Skip passages below confidence threshold
            if passage.confidence < self.config.min_quote_confidence and not self.config.include_low_confidence:
                if self.debug:
                    ref_str = passage.reference.to_standard_format()
                    _debug_log(f"  Skipping {ref_str} (confidence {passage.confidence:.2%} below threshold)", self.debug)
                continue
            
            # Debug: log passage boundary info
            if self.debug:
                _debug_passage_boundary(passage, full_text, self.debug)
            
            # Find which paragraph contains the START of this passage
            # This is the key fix - we look for where passage.start_pos falls,
            # not where the passage overlaps
            assigned = False
            for para_idx, (para_start, para_end, para_content) in enumerate(paragraphs):
                # Passage is in this paragraph if its START is within the paragraph bounds
                if passage.start_pos >= para_start and passage.start_pos < para_end:
                    paragraph_passages[para_idx].append(passage)
                    assigned = True
                    
                    if self.debug:
                        _debug_passage_mapping(passage, para_idx, para_start, para_end, self.debug)
                        
                        # Validate: passage end should also be within this paragraph
                        if passage.end_pos > para_end:
                            _debug_log(f"  ERROR: Passage end ({passage.end_pos}) exceeds paragraph end ({para_end})!", self.debug)
                            _debug_log(f"  This violates the single-paragraph passage constraint!", self.debug)
                    
                    break
            
            if not assigned:
                ref_str = passage.reference.to_standard_format()
                if self.debug:
                    _debug_log(f"  WARNING: Could not assign {ref_str} to any paragraph!", self.debug)
                    _debug_log(f"  Passage start ({passage.start_pos}) is outside all paragraph bounds", self.debug)
                
                # Fallback: Try to find closest paragraph
                for para_idx, (para_start, para_end, _) in enumerate(paragraphs):
                    # Check if passage overlaps at all with this paragraph
                    if passage.start_pos < para_end and passage.end_pos > para_start:
                        paragraph_passages[para_idx].append(passage)
                        if self.debug:
                            _debug_log(f"  FALLBACK: Assigned to paragraph {para_idx} (overlap-based)", self.debug)
                        break
        
        # Summary debug log
        if self.debug:
            _debug_log("Passage mapping summary:", self.debug)
            for para_idx, passages_in_para in paragraph_passages.items():
                if passages_in_para:
                    refs = [p.reference.to_standard_format() for p in passages_in_para]
                    _debug_log(f"  Paragraph {para_idx}: {len(passages_in_para)} passages - {', '.join(refs)}", self.debug)
        
        return paragraph_passages
    
    def _build_paragraph_nodes(
        self,
        paragraphs: List[Tuple[int, int, str]],
        paragraph_quote_map: Dict[int, List[QuoteBoundary]],
        all_quotes: List[QuoteBoundary],
        full_text: str
    ) -> List[ParagraphNode]:
        """
        Build paragraph nodes with ISOLATED passage nodes.
        
        CRITICAL STRUCTURAL REQUIREMENT (Phase 1 fix):
        Passages MUST be the sole child of their containing paragraph node.
        This method now splits paragraphs containing passages into separate nodes:
        - Text before passage → separate paragraph node
        - Passage → paragraph with passage as sole child
        - Text after passage → separate paragraph node
        
        This ensures TipTap compatibility and proper semantic structure.
        """
        result_nodes = []
        
        for para_idx, (para_start, para_end, para_content) in enumerate(paragraphs):
            quotes_in_para = paragraph_quote_map.get(para_idx, [])
            
            if not quotes_in_para:
                # Simple paragraph with just text - no splitting needed
                children = [create_text_node(para_content)]
                result_nodes.append(create_paragraph_node(children=children))
            else:
                # Paragraph contains passages - SPLIT into isolated nodes
                # Each passage gets its own paragraph, text before/after become separate paragraphs
                split_nodes = self._split_paragraph_around_passages(
                    para_content, para_start, quotes_in_para
                )
                result_nodes.extend(split_nodes)
        
        return result_nodes
    
    def _split_paragraph_around_passages(
        self,
        para_content: str,
        para_start: int,
        quotes: List[QuoteBoundary]
    ) -> List[ParagraphNode]:
        """
        Split a paragraph containing passages into separate nodes.
        
        This ensures each passage is the SOLE child of its paragraph node,
        maintaining proper structural isolation.
        
        Returns:
            List of nodes in order: [text_para?, passage_para, text_para?, passage_para?, ...]
            Each passage is wrapped in its own paragraph for TipTap block compatibility.
        """
        nodes = []
        current_pos_in_para = 0
        
        # Sort passages by start position
        sorted_quotes = sorted(quotes, key=lambda q: q.start_pos)
        
        if self.debug:
            _debug_log(f"Splitting paragraph around {len(sorted_quotes)} passages:", self.debug)
        
        for quote in sorted_quotes:
            ref_str = quote.reference.to_standard_format()
            
            # Convert absolute positions to relative positions within paragraph
            passage_start_rel = quote.start_pos - para_start
            passage_end_rel = quote.end_pos - para_start
            
            if self.debug:
                _debug_log(f"  Passage {ref_str}: relative [{passage_start_rel}, {passage_end_rel}]", self.debug)
            
            # VALIDATION: Skip if passage is outside paragraph bounds
            if passage_start_rel < 0 or passage_start_rel >= len(para_content):
                if self.debug:
                    _debug_log(f"    ❌ Skipping: passage position out of paragraph bounds", self.debug)
                continue
            
            # Clamp passage end to paragraph boundary
            if passage_end_rel > len(para_content):
                if self.debug:
                    _debug_log(f"    ⚠ Clamping passage end from {passage_end_rel} to {len(para_content)}", self.debug)
                passage_end_rel = len(para_content)
            
            # === Text BEFORE passage → separate paragraph ===
            if passage_start_rel > current_pos_in_para:
                text_before = para_content[current_pos_in_para:passage_start_rel].strip()
                if text_before:
                    nodes.append(create_paragraph_node(
                        children=[create_text_node(text_before)]
                    ))
                    if self.debug:
                        preview = text_before[:50].replace('\n', ' ')
                        _debug_log(f"    Created text-before paragraph: '{preview}...'", self.debug)
            
            # === Passage → standalone paragraph with passage as sole child ===
            passage_content = para_content[passage_start_rel:passage_end_rel]
            passage_node = self._build_passage_node(quote, passage_content)
            
            # Wrap passage in its own paragraph (TipTap block structure requirement)
            passage_paragraph = create_paragraph_node(children=[passage_node])
            nodes.append(passage_paragraph)
            
            if self.debug:
                preview = passage_content[:60].replace('\n', ' ')
                _debug_log(f"    Created isolated passage paragraph: '{preview}...'", self.debug)
            
            current_pos_in_para = passage_end_rel
        
        # === Text AFTER last passage → separate paragraph ===
        if current_pos_in_para < len(para_content):
            text_after = para_content[current_pos_in_para:].strip()
            if text_after:
                nodes.append(create_paragraph_node(
                    children=[create_text_node(text_after)]
                ))
                if self.debug:
                    preview = text_after[:50].replace('\n', ' ')
                    _debug_log(f"    Created text-after paragraph: '{preview}...'", self.debug)
        
        # If no nodes were created (edge case), fall back to full paragraph
        if not nodes:
            nodes.append(create_paragraph_node(
                children=[create_text_node(para_content)]
            ))
            if self.debug:
                _debug_log(f"    Fallback: created single paragraph (no valid passages)", self.debug)
        
        return nodes
    
    def _build_paragraph_children_with_passages(
        self,
        para_content: str,
        para_start: int,
        quotes: List[QuoteBoundary]
    ) -> List[Any]:
        """
        DEPRECATED: Build children for a paragraph that contains passages.
        
        NOTE: This method is kept for backward compatibility but should not be used.
        The new approach uses _split_paragraph_around_passages() to create separate
        paragraph nodes for text before/after passages, ensuring passages are always
        the sole child of their paragraph (structural isolation requirement).
        
        This interleaves TextNode and PassageNode based on passage positions.
        
        CRITICAL: This method assumes passages are correctly mapped to this
        paragraph (passage.start_pos is within [para_start, para_start + len(para_content)]).
        
        The _map_quotes_to_paragraphs() method ensures this by checking that
        passage START falls within paragraph bounds.
        """
        if self.debug:
            _debug_log("⚠ Using deprecated _build_paragraph_children_with_passages", self.debug)
        
        children = []
        current_pos_in_para = 0
        para_end = para_start + len(para_content)
        
        # Sort passages by start position
        sorted_quotes = sorted(quotes, key=lambda q: q.start_pos)
        
        for quote in sorted_quotes:
            ref_str = quote.reference.to_standard_format()
            
            # Convert absolute positions to relative positions within paragraph
            passage_start_rel = quote.start_pos - para_start
            passage_end_rel = quote.end_pos - para_start
            
            # Debug logging for boundary analysis
            if self.debug:
                _debug_log(f"  Processing passage {ref_str}:", self.debug)
                _debug_log(f"    Paragraph: chars [{para_start}, {para_end}), len={len(para_content)}", self.debug)
                _debug_log(f"    Passage absolute: [{quote.start_pos}, {quote.end_pos}]", self.debug)
                _debug_log(f"    Passage relative: [{passage_start_rel}, {passage_end_rel}]", self.debug)
            
            # VALIDATION: Passage start must be within this paragraph
            # This should always be true if _map_quotes_to_paragraphs() works correctly
            if passage_start_rel < 0:
                _debug_log(f"    ❌ ERROR: Passage start ({passage_start_rel}) is BEFORE paragraph!", self.debug)
                _debug_log(f"       This passage should have been mapped to an earlier paragraph.", self.debug)
                _debug_log(f"       Skipping to avoid incorrect content extraction.", self.debug)
                continue
            
            if passage_start_rel >= len(para_content):
                _debug_log(f"    ❌ ERROR: Passage start ({passage_start_rel}) is AFTER paragraph end ({len(para_content)})!", self.debug)
                _debug_log(f"       This passage should have been mapped to a later paragraph.", self.debug)
                _debug_log(f"       Skipping to avoid incorrect content extraction.", self.debug)
                continue
            
            # VALIDATION: Single-paragraph constraint - passage end should be within this paragraph
            # If passage extends beyond paragraph, truncate to paragraph boundary
            # (This preserves content integrity while respecting the constraint)
            if passage_end_rel > len(para_content):
                if self.debug:
                    _debug_log(f"    ⚠ WARNING: Passage extends beyond paragraph end", self.debug)
                    _debug_log(f"       Original end: {passage_end_rel}, truncating to: {len(para_content)}", self.debug)
                passage_end_rel = len(para_content)
            
            # VALIDATION: Ensure we have meaningful content
            passage_length = passage_end_rel - passage_start_rel
            if passage_length < 5:
                _debug_log(f"    ⚠ WARNING: Very short passage content ({passage_length} chars)", self.debug)
            
            # Add text before passage
            if passage_start_rel > current_pos_in_para:
                text_before = para_content[current_pos_in_para:passage_start_rel]
                if text_before.strip():
                    children.append(create_text_node(text_before))
                    if self.debug:
                        preview = text_before[:50].replace('\n', ' ')
                        _debug_log(f"    Added text before: '{preview}...' ({len(text_before)} chars)", self.debug)
            
            # Extract passage content from paragraph
            passage_content = para_content[passage_start_rel:passage_end_rel]
            
            if self.debug:
                preview = passage_content[:80].replace('\n', ' ')
                expected_preview = (quote.verse_text or '')[:80].replace('\n', ' ')
                _debug_log(f"    Extracted content: '{preview}...' ({len(passage_content)} chars)", self.debug)
                _debug_log(f"    Expected (verse_text): '{expected_preview}...'", self.debug)
            
            # Build and add passage node
            passage_node = self._build_passage_node(quote, passage_content)
            children.append(passage_node)
            
            current_pos_in_para = passage_end_rel
        
        # Add remaining text after last passage
        if current_pos_in_para < len(para_content):
            text_after = para_content[current_pos_in_para:]
            if text_after.strip():
                children.append(create_text_node(text_after))
                if self.debug:
                    preview = text_after[:50].replace('\n', ' ')
                    _debug_log(f"    Added text after: '{preview}...' ({len(text_after)} chars)", self.debug)
        
        # If no children were added, add the whole content as text
        if not children:
            children.append(create_text_node(para_content))
            if self.debug:
                _debug_log(f"    No passages mapped, using full paragraph as text", self.debug)
        
        return children
    
    
    def _build_passage_node(self, quote: QuoteBoundary, content: str) -> PassageNode:
        """
        Build a PassageNode from a QuoteBoundary.
        
        IMPORTANT: The content is normalized to remove paragraph breaks (\n\n)
        since passages must be contained within a single paragraph. This ensures
        that even if the original transcript had internal paragraph breaks within
        a Bible quote, the passage content is presented as continuous text.
        """
        # Normalize content: replace paragraph breaks with single space
        # This enforces the single-paragraph constraint for passage content
        normalized_content = re.sub(r'\n\n+', ' ', content).strip()
        
        # Build reference metadata
        reference = BibleReferenceMetadata(
            book=quote.reference.book,
            chapter=quote.reference.chapter,
            verse_start=quote.reference.verse_start,
            verse_end=quote.reference.verse_end,
            original_text=quote.reference.original_text,
            normalized_reference=quote.reference.to_standard_format()
        )
        
        # Build detection metadata
        detection = QuoteDetectionMetadata(
            confidence=quote.confidence,
            confidence_level=get_confidence_level(quote.confidence),
            translation=quote.translation,
            translation_auto_detected=True,  # Current system always auto-detects
            verse_text=quote.verse_text,
            is_partial_match=quote.confidence < 0.8
        )
        
        # Build interjection metadata
        # Note: Interjection positions are relative to ORIGINAL content,
        # so we use the original content for extraction
        interjections = []
        if quote.has_interjection and quote.interjection_positions:
            for i, (interj_start, interj_end) in enumerate(quote.interjection_positions):
                # Convert to relative positions within the quote content
                rel_start = interj_start - quote.start_pos
                rel_end = interj_end - quote.start_pos
                
                # Clamp to content bounds
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
        
        # Create the passage block node with NORMALIZED content
        return create_passage_node(
            content=normalized_content,
            reference=reference,
            detection=detection,
            interjections=interjections if interjections else None
        )
    
    def _extract_references(self, quotes: List[QuoteBoundary]) -> List[str]:
        """
        Extract and deduplicate reference strings from quotes.
        """
        seen = set()
        references = []
        
        for quote in quotes:
            ref_str = quote.reference.to_standard_format()
            if ref_str not in seen:
                seen.add(ref_str)
                references.append(ref_str)
        
        return references


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def build_ast(
    paragraphed_text: str,
    quote_boundaries: List[QuoteBoundary],
    title: Optional[str] = None,
    bible_passage: Optional[str] = None,
    speaker: Optional[str] = None,
    tags: Optional[List[str]] = None,
    config: Optional[ASTBuilderConfig] = None,
    debug: bool = False
) -> ASTBuilderResult:
    """
    Convenience function to build AST from processed text.
    
    Args:
        paragraphed_text: Text with paragraph breaks
        quote_boundaries: List of QuoteBoundary objects
        title: Document title
        bible_passage: Main Bible passage
        speaker: Speaker/Author (from metadata)
        tags: Extracted tags
        config: Optional builder configuration
        debug: Whether to output debug logging
    
    Returns:
        ASTBuilderResult
    """
    builder = ASTBuilder(config=config, debug=debug)
    return builder.build_from_processed_text(
        paragraphed_text=paragraphed_text,
        quote_boundaries=quote_boundaries,
        title=title,
        bible_passage=bible_passage,
        speaker=speaker,
        tags=tags
    )


def build_ast_from_raw_text(
    raw_text: str,
    title: Optional[str] = None,
    bible_passage: Optional[str] = None,
) -> ASTBuilderResult:
    """
    Build AST from raw text without any quote processing.
    
    This is useful for importing plain text or when quote processing fails.
    
    Args:
        raw_text: Raw text content
        title: Document title
        bible_passage: Main Bible passage
    
    Returns:
        ASTBuilderResult
    """
    builder = ASTBuilder()
    
    # Split into paragraphs
    paragraphs = []
    for para in raw_text.split('\n\n'):
        para_stripped = para.strip()
        if para_stripped:
            paragraphs.append(create_paragraph_node(
                children=[create_text_node(para_stripped)]
            ))
    
    # If no paragraphs found, create one with all content
    if not paragraphs:
        paragraphs = [create_paragraph_node(
            children=[create_text_node(raw_text.strip() or '')]
        )]
    
    root = create_document_root(
        children=paragraphs,
        title=title,
        bible_passage=bible_passage
    )
    
    state = create_document_state(root=root, references=[], tags=[])
    
    builder.processing_metadata.paragraph_count = len(paragraphs)
    builder.processing_metadata.passage_count = 0
    builder.processing_metadata.interjection_count = 0
    
    return ASTBuilderResult(
        document_state=state,
        processing_metadata=builder.processing_metadata
    )


# ============================================================================
# TESTING
# ============================================================================

if __name__ == '__main__':
    # Simple test
    test_text = """This is the first paragraph. It has some content.

This is the second paragraph. It mentions Matthew 5:3-5 and then quotes: "Blessed are the poor in spirit, for theirs is the kingdom of heaven."

This is the third paragraph after the quote."""

    # Create a mock QuoteBoundary for testing
    mock_ref = BibleReference(
        book='Matthew',
        chapter=5,
        verse_start=3,
        verse_end=5,
        original_text='Matthew 5:3-5',
        position=60
    )
    
    mock_quote = QuoteBoundary(
        start_pos=120,
        end_pos=200,
        reference=mock_ref,
        verse_text='Blessed are the poor in spirit, for theirs is the kingdom of heaven.',
        confidence=0.85,
        translation='KJV',
        has_interjection=False,
        interjection_positions=[]
    )
    
    result = build_ast(
        paragraphed_text=test_text,
        quote_boundaries=[mock_quote],
        title='Test Sermon',
        bible_passage='Matthew 5',
        tags=['Beatitudes', 'Sermon on the Mount']
    )
    
    print("AST Builder Test:")
    print("=" * 60)
    print(f"Paragraphs: {result.processing_metadata.paragraph_count}")
    print(f"Passages: {result.processing_metadata.passage_count}")
    print(f"Total time: {result.processing_metadata.total_time:.2f}ms")
    print()
    print("Document JSON (first 1000 chars):")
    print(result.to_json(indent=2)[:1000])
