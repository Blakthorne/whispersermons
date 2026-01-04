"""
AST Builder - Transforms processed text into structured document model

This module takes the output from the existing bible_quote_processor (text with quotes
and QuoteBoundary objects) and transforms it into the new Hybrid AST document model.

The builder:
1. Takes paragraphed text with embedded quote marks
2. Takes QuoteBoundary objects with rich metadata
3. Builds a proper AST with stable node IDs
4. Preserves all metadata (confidence, translation, interjections)
5. Creates event log for the document creation

This is a bridge module that allows incremental migration from the old system.
"""

import re
import time
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
    # Minimum confidence to include a quote
    min_quote_confidence: float = 0.4
    # Whether to include low-confidence quotes (with warning flag)
    include_low_confidence: bool = True
    # Whether to strip extra whitespace from text nodes
    normalize_whitespace: bool = True
    # Maximum text node length before splitting
    max_text_node_length: int = 10000


# ============================================================================
# AST BUILDER
# ============================================================================

class ASTBuilder:
    """
    Builds a document AST from processed text and quote boundaries.
    
    This is the bridge between the existing bible_quote_processor output
    and the new structured document model.
    """
    
    def __init__(self, config: Optional[ASTBuilderConfig] = None):
        self.config = config or ASTBuilderConfig()
        self.processing_metadata = ProcessingMetadata()
        self._stage_start_time: Optional[float] = None
    
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
        Build document AST from processed text and quote boundaries.
        
        Args:
            paragraphed_text: Text with paragraph breaks (double newlines)
            quote_boundaries: List of QuoteBoundary objects from bible_quote_processor
            title: Document title (from metadata)
            bible_passage: Main Bible passage (from metadata)
            speaker: Speaker/Author (from metadata)
            tags: Extracted tags
        
        Returns:
            ASTBuilderResult with document state and processing metadata
        """
        start_time = time.time()
        
        # Stage 1: Parse paragraphs
        self._start_stage('parse_paragraphs')
        paragraphs = self._split_into_paragraphs(paragraphed_text)
        self._end_stage('parse_paragraphs')
        
        # Stage 2: Map quotes to paragraphs
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
        
        # Stage 5: Extract references from quotes
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
        
        return ASTBuilderResult(
            document_state=state,
            processing_metadata=self.processing_metadata
        )
    
    def _split_into_paragraphs(self, text: str) -> List[Tuple[int, int, str]]:
        """
        Split text into paragraphs based on double newlines.
        
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
        
        return paragraphs
    
    def _map_quotes_to_paragraphs(
        self,
        paragraphs: List[Tuple[int, int, str]],
        quotes: List[QuoteBoundary],
        full_text: str
    ) -> Dict[int, List[QuoteBoundary]]:
        """
        Map quotes to the paragraphs they appear in.
        
        Returns:
            Dict mapping paragraph index to list of QuoteBoundary objects in that paragraph
        """
        paragraph_quotes: Dict[int, List[QuoteBoundary]] = {i: [] for i in range(len(paragraphs))}
        
        for quote in quotes:
            # Skip quotes below confidence threshold
            if quote.confidence < self.config.min_quote_confidence and not self.config.include_low_confidence:
                continue
            
            # Find which paragraph contains this quote
            for para_idx, (para_start, para_end, _) in enumerate(paragraphs):
                # Quote is in this paragraph if it overlaps
                if quote.start_pos < para_end and quote.end_pos > para_start:
                    paragraph_quotes[para_idx].append(quote)
                    break
        
        return paragraph_quotes
    
    def _build_paragraph_nodes(
        self,
        paragraphs: List[Tuple[int, int, str]],
        paragraph_quote_map: Dict[int, List[QuoteBoundary]],
        all_quotes: List[QuoteBoundary],
        full_text: str
    ) -> List[ParagraphNode]:
        """
        Build paragraph nodes with embedded passage nodes.
        """
        paragraph_nodes = []
        
        for para_idx, (para_start, para_end, para_content) in enumerate(paragraphs):
            quotes_in_para = paragraph_quote_map.get(para_idx, [])
            
            if not quotes_in_para:
                # Simple paragraph with just text
                children = [create_text_node(para_content)]
                paragraph_nodes.append(create_paragraph_node(children=children))
            else:
                # Paragraph with passages - need to interleave text and passage nodes
                children = self._build_paragraph_children_with_passages(
                    para_content, para_start, quotes_in_para
                )
                paragraph_nodes.append(create_paragraph_node(children=children))
        
        return paragraph_nodes
    
    def _build_paragraph_children_with_passages(
        self,
        para_content: str,
        para_start: int,
        quotes: List[QuoteBoundary]
    ) -> List[Any]:
        """
        Build children for a paragraph that contains passages.
        
        This interleaves TextNode and PassageNode based on passage positions.
        """
        children = []
        current_pos_in_para = 0
        
        # Sort quotes by start position
        sorted_quotes = sorted(quotes, key=lambda q: q.start_pos)
        
        for quote in sorted_quotes:
            # Convert absolute positions to relative positions within paragraph
            quote_start_rel = quote.start_pos - para_start
            quote_end_rel = quote.end_pos - para_start
            
            # Clamp to paragraph bounds
            quote_start_rel = max(0, quote_start_rel)
            quote_end_rel = min(len(para_content), quote_end_rel)
            
            # Skip if quote is outside this paragraph
            if quote_start_rel >= len(para_content) or quote_end_rel <= 0:
                continue
            
            # Add text before quote
            if quote_start_rel > current_pos_in_para:
                text_before = para_content[current_pos_in_para:quote_start_rel]
                if text_before.strip():
                    children.append(create_text_node(text_before))
            
            # Add passage node
            quote_content = para_content[quote_start_rel:quote_end_rel]
            
            passage_node = self._build_passage_node(quote, quote_content)
            children.append(passage_node)
            
            current_pos_in_para = quote_end_rel
        
        # Add remaining text after last quote
        if current_pos_in_para < len(para_content):
            text_after = para_content[current_pos_in_para:]
            if text_after.strip():
                children.append(create_text_node(text_after))
        
        # If no children were added, add the whole content as text
        if not children:
            children.append(create_text_node(para_content))
        
        return children
    
    
    def _build_passage_node(self, quote: QuoteBoundary, content: str) -> PassageNode:
        """
        Build a PassageNode from a QuoteBoundary.
        """
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
        
        # Create the passage block node
        return create_passage_node(
            content=content,
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
    config: Optional[ASTBuilderConfig] = None
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
    
    Returns:
        ASTBuilderResult
    """
    builder = ASTBuilder(config=config)
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
