"""
Document Model - Hybrid AST + Event Log Architecture (Python Implementation)

This module defines the Python dataclasses that mirror the TypeScript document model.
These classes are used by the AST builder to create structured documents from
transcribed sermon text.

Design principles:
- Stable UUIDs on all nodes (survives all edits)
- Rich metadata travels with content
- JSON-serializable for IPC with Electron
- Type-safe with dataclasses and Optional types
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Union, Literal
from datetime import datetime
import uuid
import json


# ============================================================================
# TYPE ALIASES
# ============================================================================

NodeId = str  # UUID v4 format
EventId = str  # UUID v4 format
Version = int  # Monotonically increasing


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def generate_node_id() -> NodeId:
    """Generate a new unique node ID."""
    return str(uuid.uuid4())


def generate_event_id() -> EventId:
    """Generate a new unique event ID."""
    return str(uuid.uuid4())


def now_iso() -> str:
    """Get current timestamp in ISO 8601 format."""
    return datetime.utcnow().isoformat() + 'Z'


# ============================================================================
# CONFIDENCE THRESHOLDS
# ============================================================================

CONFIDENCE_THRESHOLDS = {
    'HIGH': 0.8,
    'MEDIUM': 0.6,
    'LOW': 0.4,
}


def get_confidence_level(score: float) -> Literal['high', 'medium', 'low']:
    """Get confidence level from score."""
    if score >= CONFIDENCE_THRESHOLDS['HIGH']:
        return 'high'
    if score >= CONFIDENCE_THRESHOLDS['MEDIUM']:
        return 'medium'
    return 'low'


# ============================================================================
# BIBLE REFERENCE TYPES
# ============================================================================

@dataclass
class BibleReferenceMetadata:
    """Rich metadata for a Bible reference."""
    book: str  # Canonical form, e.g., "Matthew", "1 Corinthians"
    chapter: int
    verse_start: Optional[int]  # None for chapter-only references
    verse_end: Optional[int]  # None for single verse or chapter-only
    original_text: str  # As it appeared in transcript
    normalized_reference: str  # e.g., "Matthew 5:3"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'book': self.book,
            'chapter': self.chapter,
            'verseStart': self.verse_start,
            'verseEnd': self.verse_end,
            'originalText': self.original_text,
            'normalizedReference': self.normalized_reference,
        }


@dataclass
class QuoteDetectionMetadata:
    """Metadata for quote detection and matching."""
    confidence: float  # 0.0 to 1.0
    confidence_level: Literal['high', 'medium', 'low']
    translation: str  # e.g., 'KJV', 'NIV'
    translation_auto_detected: bool
    verse_text: str  # Actual verse text from Bible API
    is_partial_match: bool
    matching_word_count: Optional[int] = None
    total_verse_words: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            'confidence': self.confidence,
            'confidenceLevel': self.confidence_level,
            'translation': self.translation,
            'translationAutoDetected': self.translation_auto_detected,
            'verseText': self.verse_text,
            'isPartialMatch': self.is_partial_match,
        }
        if self.matching_word_count is not None:
            result['matchingWordCount'] = self.matching_word_count
        if self.total_verse_words is not None:
            result['totalVerseWords'] = self.total_verse_words
        return result


@dataclass
class InterjectionMetadata:
    """Interjection within a quote (e.g., "a what?", "amen?")."""
    id: NodeId
    text: str
    offset_start: int  # Character offset within quote content
    offset_end: int
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'text': self.text,
            'offsetStart': self.offset_start,
            'offsetEnd': self.offset_end,
        }


@dataclass
class PassageMetadata:
    """Complete metadata for a Bible passage block."""
    reference: BibleReferenceMetadata
    detection: QuoteDetectionMetadata
    interjections: List[InterjectionMetadata] = field(default_factory=list)
    user_verified: bool = False
    user_notes: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            'reference': self.reference.to_dict(),
            'detection': self.detection.to_dict(),
            'interjections': [i.to_dict() for i in self.interjections],
            'userVerified': self.user_verified,
        }
        if self.user_notes is not None:
            result['userNotes'] = self.user_notes
        return result


# ============================================================================
# NODE TYPES
# ============================================================================

@dataclass
class BaseNode:
    """Base class for all document nodes."""
    id: NodeId
    type: str
    version: Version
    updated_at: str
    
    def base_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'type': self.type,
            'version': self.version,
            'updatedAt': self.updated_at,
        }


@dataclass
class TextNode(BaseNode):
    """Plain text node - leaf node containing actual text content."""
    content: str
    
    def __init__(self, content: str, id: Optional[NodeId] = None, version: Version = 1):
        self.id = id or generate_node_id()
        self.type = 'text'
        self.version = version
        self.updated_at = now_iso()
        self.content = content
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            **self.base_dict(),
            'content': self.content,
        }


@dataclass
class InterjectionNode(BaseNode):
    """Interjection node - inline element within a quote."""
    content: str
    metadata_id: NodeId  # Reference to parent quote's metadata interjection entry
    
    def __init__(self, content: str, metadata_id: NodeId, id: Optional[NodeId] = None, version: Version = 1):
        self.id = id or generate_node_id()
        self.type = 'interjection'
        self.version = version
        self.updated_at = now_iso()
        self.content = content
        self.metadata_id = metadata_id
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            **self.base_dict(),
            'content': self.content,
            'metadataId': self.metadata_id,
        }


@dataclass
class ParagraphNode(BaseNode):
    """
    Paragraph node - container for inline content.
    
    Formatting properties:
    - headingLevel: 1-3 for heading styling (renders as h1/h2/h3)
    - listStyle: 'bullet' or 'ordered' for list item styling
    - listNumber: Item number for ordered lists
    - listDepth: Nesting depth for nested lists
    - textAlign: Text alignment ('left', 'center', 'right')
    """
    children: List[Union['TextNode', 'InterjectionNode', 'PassageNode']]
    heading_level: Optional[int] = None  # 1, 2, or 3 for headings
    list_style: Optional[str] = None  # 'bullet' or 'ordered'
    list_number: Optional[int] = None  # For ordered lists
    list_depth: Optional[int] = None  # For nested lists
    text_align: Optional[str] = None  # 'left', 'center', 'right'
    
    def __init__(
        self, 
        children: Optional[List[Any]] = None, 
        id: Optional[NodeId] = None, 
        version: Version = 1,
        heading_level: Optional[int] = None,
        list_style: Optional[str] = None,
        list_number: Optional[int] = None,
        list_depth: Optional[int] = None,
        text_align: Optional[str] = None
    ):
        self.id = id or generate_node_id()
        self.type = 'paragraph'
        self.version = version
        self.updated_at = now_iso()
        self.children = children or []
        self.heading_level = heading_level
        self.list_style = list_style
        self.list_number = list_number
        self.list_depth = list_depth
        self.text_align = text_align
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            **self.base_dict(),
            'children': [c.to_dict() for c in self.children],
        }
        if self.heading_level is not None:
            result['headingLevel'] = self.heading_level
        if self.list_style is not None:
            result['listStyle'] = self.list_style
        if self.list_number is not None:
            result['listNumber'] = self.list_number
        if self.list_depth is not None:
            result['listDepth'] = self.list_depth
        if self.text_align is not None:
            result['textAlign'] = self.text_align
        return result


@dataclass
class PassageNode(BaseNode):
    """Passage node - contains the Bible passage with full metadata."""
    metadata: PassageMetadata
    children: List[Union[TextNode, InterjectionNode]]
    
    def __init__(self, metadata: PassageMetadata, children: Optional[List[Any]] = None,
                 id: Optional[NodeId] = None, version: Version = 1):
        self.id = id or generate_node_id()
        self.type = 'passage'
        self.version = version
        self.updated_at = now_iso()
        self.metadata = metadata
        self.children = children or []
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            **self.base_dict(),
            'metadata': self.metadata.to_dict(),
            'children': [c.to_dict() for c in self.children],
        }


# Backwards compatibility aliases
BiblePassageNode = PassageNode
QuoteNode = PassageNode
QuoteMetadata = PassageMetadata


@dataclass
class DocumentRootNode(BaseNode):
    """Root document node."""
    title: Optional[str]
    bible_passage: Optional[str]
    speaker: Optional[str]
    tags: Optional[List[str]]
    children: List[Any]  # ParagraphNode, PassageNode, etc.
    
    def __init__(self, children: Optional[List[Any]] = None, title: Optional[str] = None,
                 bible_passage: Optional[str] = None, speaker: Optional[str] = None,
                 tags: Optional[List[str]] = None,
                 id: Optional[NodeId] = None, version: Version = 1):
        self.id = id or generate_node_id()
        self.type = 'document'
        self.version = version
        self.updated_at = now_iso()
        self.title = title
        self.bible_passage = bible_passage
        self.speaker = speaker
        self.tags = tags
        self.children = children or []
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            **self.base_dict(),
            'children': [c.to_dict() for c in self.children],
        }
        if self.title is not None:
            result['title'] = self.title
        if self.bible_passage is not None:
            result['biblePassage'] = self.bible_passage
        if self.speaker is not None:
            result['speaker'] = self.speaker
        if self.tags is not None:
            result['tags'] = self.tags
        return result


# Type alias for any document node
# Valid types: document, paragraph, text, passage, interjection
# Headings are paragraphs with headingLevel (1-3)
# Lists are paragraphs with listStyle/listNumber/listDepth
DocumentNode = Union[
    DocumentRootNode,
    ParagraphNode,
    TextNode,
    PassageNode,
    InterjectionNode,
]


# ============================================================================
# EVENT TYPES
# ============================================================================

class BaseEvent:
    """Base class for all document events."""
    def __init__(
        self,
        id: EventId,
        type: str,
        timestamp: str,
        resulting_version: Version,
        source: Optional[Literal['system', 'user', 'import']] = None
    ):
        self.id = id
        self.type = type
        self.timestamp = timestamp
        self.resulting_version = resulting_version
        self.source = source
    
    def base_dict(self) -> Dict[str, Any]:
        result = {
            'id': self.id,
            'type': self.type,
            'timestamp': self.timestamp,
            'resultingVersion': self.resulting_version,
        }
        if self.source is not None:
            result['source'] = self.source
        return result


class DocumentCreatedEvent(BaseEvent):
    """Event for document creation."""
    
    def __init__(self, document: DocumentRootNode, creation_source: Literal['transcription', 'import', 'new'],
                 resulting_version: Version = 1, source: Optional[Literal['system', 'user', 'import']] = 'system'):
        super().__init__(
            id=generate_event_id(),
            type='document_created',
            timestamp=now_iso(),
            resulting_version=resulting_version,
            source=source
        )
        self.document = document
        self.creation_source = creation_source
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            **self.base_dict(),
            'document': self.document.to_dict(),
            'creationSource': self.creation_source,
        }


class NodeCreatedEvent(BaseEvent):
    """Event for node creation."""
    
    def __init__(self, node: Any, parent_id: Optional[NodeId], index: int,
                 resulting_version: Version, source: Optional[Literal['system', 'user', 'import']] = 'system'):
        super().__init__(
            id=generate_event_id(),
            type='node_created',
            timestamp=now_iso(),
            resulting_version=resulting_version,
            source=source
        )
        self.node = node
        self.parent_id = parent_id
        self.index = index
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            **self.base_dict(),
            'node': self.node.to_dict(),
            'parentId': self.parent_id,
            'index': self.index,
        }


class PassageCreatedEvent(BaseEvent):
    """Event for passage creation."""
    
    def __init__(self, passage: PassageNode, parent_id: NodeId, index: int,
                 replaced_node_ids: List[NodeId], resulting_version: Version,
                 source: Optional[Literal['system', 'user', 'import']] = 'system'):
        super().__init__(
            id=generate_event_id(),
            type='passage_created',
            timestamp=now_iso(),
            resulting_version=resulting_version,
            source=source
        )
        self.passage = passage
        self.parent_id = parent_id
        self.index = index
        self.replaced_node_ids = replaced_node_ids
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            **self.base_dict(),
            'passage': self.passage.to_dict(),
            'parentId': self.parent_id,
            'index': self.index,
            'replacedNodeIds': self.replaced_node_ids,
        }


# Backwards compatibility alias
QuoteCreatedEvent = PassageCreatedEvent


# Type alias for any event
DocumentEvent = Union[
    DocumentCreatedEvent,
    NodeCreatedEvent,
    QuoteCreatedEvent,
    # Additional event types would be added as implemented
]


# ============================================================================
# INDEX TYPES
# ============================================================================

@dataclass
class NodeIndexEntry:
    """Entry in the node index."""
    node: Any  # DocumentNode
    parent_id: Optional[NodeId]
    path: List[NodeId]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'node': self.node.to_dict(),
            'parentId': self.parent_id,
            'path': self.path,
        }


@dataclass
class PassageIndex:
    """Index for fast passage lookups."""
    by_reference: Dict[str, List[NodeId]] = field(default_factory=dict)  # normalized reference -> passage IDs
    by_book: Dict[str, List[NodeId]] = field(default_factory=dict)  # book name -> passage IDs
    all: List[NodeId] = field(default_factory=list)  # all passage IDs in document order
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'byReference': self.by_reference,
            'byBook': self.by_book,
            'all': self.all,
        }


# Backwards compatibility alias
QuoteIndex = PassageIndex


@dataclass
class ExtractedReferences:
    """Extracted references for backward compatibility."""
    references: List[str] = field(default_factory=list)  # normalized reference strings
    tags: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'references': self.references,
            'tags': self.tags,
        }


# ============================================================================
# DOCUMENT STATE
# ============================================================================

@dataclass
class DocumentState:
    """Complete document state for persistence and undo."""
    version: Version
    root: DocumentRootNode
    event_log: List[Any]  # List of DocumentEvent
    undo_stack: List[EventId]
    redo_stack: List[EventId]
    node_index: Dict[NodeId, NodeIndexEntry]
    passage_index: PassageIndex
    extracted: ExtractedReferences
    last_modified: str
    created_at: str
    
    def __init__(self, root: DocumentRootNode, version: Version = 1,
                 event_log: Optional[List[Any]] = None,
                 extracted: Optional[ExtractedReferences] = None):
        self.version = version
        self.root = root
        self.event_log = event_log or []
        self.undo_stack = []
        self.redo_stack = []
        self.node_index = {}
        self.passage_index = PassageIndex()
        self.extracted = extracted or ExtractedReferences()
        self.last_modified = now_iso()
        self.created_at = now_iso()
        
        # Build indexes
        self._build_indexes()
    
    def _build_indexes(self):
        """Build node and passage indexes from the document tree."""
        self.node_index = {}
        self.passage_index = PassageIndex()
        
        def index_node(node: Any, parent_id: Optional[NodeId], path: List[NodeId]):
            self.node_index[node.id] = NodeIndexEntry(
                node=node,
                parent_id=parent_id,
                path=path
            )
            
            # Index passages (type is 'passage')
            if hasattr(node, 'type') and node.type == 'passage':
                self.passage_index.all.append(node.id)
                ref = node.metadata.reference.normalized_reference
                book = node.metadata.reference.book
                
                if ref not in self.passage_index.by_reference:
                    self.passage_index.by_reference[ref] = []
                self.passage_index.by_reference[ref].append(node.id)
                
                if book not in self.passage_index.by_book:
                    self.passage_index.by_book[book] = []
                self.passage_index.by_book[book].append(node.id)
            
            # Recurse into children
            if hasattr(node, 'children'):
                for child in node.children:
                    index_node(child, node.id, path + [node.id])
        
        index_node(self.root, None, [])
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'version': self.version,
            'root': self.root.to_dict(),
            'eventLog': [e.to_dict() for e in self.event_log],
            'undoStack': self.undo_stack,
            'redoStack': self.redo_stack,
            'nodeIndex': {k: v.to_dict() for k, v in self.node_index.items()},
            'passageIndex': self.passage_index.to_dict(),
            'extracted': self.extracted.to_dict(),
            'lastModified': self.last_modified,
            'createdAt': self.created_at,
        }
    
    def to_json(self, indent: Optional[int] = None) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)


# ============================================================================
# PROCESSING METADATA
# ============================================================================

@dataclass
class ProcessingMetadata:
    """Metadata about the AST building process."""
    stage_times: Dict[str, float] = field(default_factory=dict)  # stage name -> ms
    total_time: float = 0.0
    passage_count: int = 0
    paragraph_count: int = 0
    interjection_count: int = 0
    normalization_count: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'stageTimes': self.stage_times,
            'totalTime': self.total_time,
            'passageCount': self.passage_count,
            'paragraphCount': self.paragraph_count,
            'interjectionCount': self.interjection_count,
            'normalizationCount': self.normalization_count,
        }


@dataclass
class ASTBuilderResult:
    """Result from the AST builder."""
    document_state: DocumentState
    processing_metadata: ProcessingMetadata
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'documentState': self.document_state.to_dict(),
            'processingMetadata': self.processing_metadata.to_dict(),
        }
    
    def to_json(self, indent: Optional[int] = None) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)


# ============================================================================
# FACTORY FUNCTIONS
# ============================================================================

def create_text_node(content: str) -> TextNode:
    """Create a new text node."""
    return TextNode(content=content)


def create_paragraph_node(children: Optional[List[Any]] = None) -> ParagraphNode:
    """Create a new paragraph node."""
    return ParagraphNode(children=children)


def create_passage_node(
    content: str,
    reference: BibleReferenceMetadata,
    detection: QuoteDetectionMetadata,
    interjections: Optional[List[InterjectionMetadata]] = None
) -> PassageNode:
    """Create a new passage node with text content."""
    # Build children from content and interjections
    children: List[Union[TextNode, InterjectionNode]] = []
    
    if interjections:
        # Sort interjections by offset
        sorted_interjections = sorted(interjections, key=lambda i: i.offset_start)
        
        # Build interleaved text and interjection nodes
        current_pos = 0
        for interj in sorted_interjections:
            # Add text before interjection
            if interj.offset_start > current_pos:
                text_content = content[current_pos:interj.offset_start]
                if text_content:
                    children.append(TextNode(content=text_content))
            
            # Add interjection node
            children.append(InterjectionNode(
                content=interj.text,
                metadata_id=interj.id
            ))
            
            current_pos = interj.offset_end
        
        # Add remaining text after last interjection
        if current_pos < len(content):
            remaining = content[current_pos:]
            if remaining:
                children.append(TextNode(content=remaining))
    else:
        # No interjections - single text node
        if content:
            children.append(TextNode(content=content))
    
    metadata = PassageMetadata(
        reference=reference,
        detection=detection,
        interjections=interjections or []
    )
    
    return PassageNode(metadata=metadata, children=children)


# Backwards compatibility aliases
create_quote_node = create_passage_node
create_bible_passage_node = create_passage_node


def create_document_root(
    children: Optional[List[Any]] = None,
    title: Optional[str] = None,
    bible_passage: Optional[str] = None,
    speaker: Optional[str] = None,
    tags: Optional[List[str]] = None
) -> DocumentRootNode:
    """Create a new document root node."""
    return DocumentRootNode(
        children=children,
        title=title,
        bible_passage=bible_passage,
        speaker=speaker,
        tags=tags
    )


def create_document_state(
    root: DocumentRootNode,
    references: Optional[List[str]] = None,
    tags: Optional[List[str]] = None
) -> DocumentState:
    """Create a new document state with indexes."""
    # Create the initial document created event
    event = DocumentCreatedEvent(
        document=root,
        creation_source='transcription'
    )
    
    extracted = ExtractedReferences(
        references=references or [],
        tags=tags or []
    )
    
    state = DocumentState(
        root=root,
        version=1,
        event_log=[event],
        extracted=extracted
    )
    
    return state
