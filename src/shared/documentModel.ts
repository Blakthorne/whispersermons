/**
 * Document Model - Hybrid AST + Event Log Architecture
 *
 * This module defines the complete type system for the structured document model
 * that replaces the legacy plain-text passage processing approach.
 *
 * Key design principles:
 * - Stable UUIDs on all nodes (survives all edits)
 * - Complete immutable event log (audit trail)
 * - Snapshot-based undo/redo
 * - Editor-agnostic document model
 * - Rich metadata travels with content
 *
 * Architecture:
 * - DocumentNode: Base interface for all nodes in the AST
 * - PassageNode: Special node for Bible passages with rich metadata
 * - DocumentEvent: Immutable events for all document mutations
 * - DocumentState: Complete state snapshot for persistence/undo
 *
 * IMPORTANT TERMINOLOGY:
 * - 'passage' = Bible passage (semantic content with scripture reference)
 * - 'blockQuote' = Visual formatting (indented block, like headings/alignment)
 * These are distinct concepts and should not be confused.
 */

// ============================================================================
// CORE IDENTIFIERS
// ============================================================================

/**
 * Unique identifier for nodes. Uses UUID v4 format.
 * These IDs are stable and survive all edits.
 */
export type NodeId = string;

/**
 * Unique identifier for events. Uses UUID v4 format.
 */
export type EventId = string;

/**
 * Monotonically increasing version number for optimistic concurrency.
 */
export type Version = number;

// ============================================================================
// NODE TYPES
// ============================================================================

/**
 * All possible node types in the document AST.
 *
 * The AST has 5 semantic node types:
 * - 'document': Root container
 * - 'paragraph': Block content (can have heading/list/blockQuote formatting)
 * - 'text': Leaf text content with optional marks
 * - 'passage': Bible passage with rich metadata (scripture reference)
 * - 'interjection': Inline element within passages (e.g., "amen")
 *
 * NOTE: Headings, lists, and block quotes are NOT separate node types. Instead,
 * ParagraphNode has optional formatting properties (headingLevel, listStyle, isBlockQuote).
 */
export type NodeType =
  | 'document'
  | 'paragraph'
  | 'text'
  | 'passage'
  | 'interjection';

/**
 * Base interface for all document nodes.
 */
export interface BaseNode {
  /** Stable UUID that survives all edits */
  id: NodeId;
  /** Node type discriminator */
  type: NodeType;
  /** Version number for optimistic concurrency */
  version: Version;
  /** Timestamp of last modification (ISO 8601) */
  updatedAt: string;
}

/**
 * Inline formatting mark type (compatible with TipTap/ProseMirror marks).
 */
export interface TextMark {
  /** Mark type: bold, italic, underline, highlight, link, strike, code, etc. */
  type: string;
  /** Optional attributes for marks that need them (e.g., link href, highlight color) */
  attrs?: Record<string, unknown>;
}

/**
 * Plain text node - leaf node containing actual text content.
 */
export interface TextNode extends BaseNode {
  type: 'text';
  /** The actual text content */
  content: string;
  /** Optional inline formatting marks (bold, italic, etc.) */
  marks?: TextMark[];
}

/**
 * Paragraph node - container for inline content.
 *
 * Can optionally have heading, list, or block quote formatting via properties.
 * This keeps the AST semantically simple while allowing rich visual formatting.
 *
 * IMPORTANT: `isBlockQuote` is visual formatting (indented text), NOT a Bible passage.
 * Bible passages use `PassageNode` with scripture metadata.
 */
export interface ParagraphNode extends BaseNode {
  type: 'paragraph';
  /** Child nodes (typically TextNode, InterjectionNode) */
  children: DocumentNode[];
  /**
   * Optional heading level for visual formatting (1-3).
   * When set, this paragraph renders as an H1-H3 element.
   */
  headingLevel?: 1 | 2 | 3;
  /**
   * Optional list style. When set, this paragraph is part of a list.
   */
  listStyle?: 'bullet' | 'ordered';
  /**
   * For ordered lists, the item number (1-based).
   */
  listNumber?: number;
  /**
   * Nesting depth for nested lists (0 = top level).
   */
  listDepth?: number;
  /**
   * Optional text alignment.
   */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  /**
   * Whether this paragraph is formatted as a block quote.
   * This is VISUAL formatting only (indented text), NOT a Bible passage.
   * Bible passages use PassageNode with scripture metadata.
   */
  isBlockQuote?: boolean;
}

// ============================================================================
// BIBLE PASSAGE TYPES
// ============================================================================

/**
 * Confidence level for passage detection.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Translation codes for Bible versions.
 */
export type BibleTranslation =
  | 'KJV'
  | 'NKJV'
  | 'NIV'
  | 'ESV'
  | 'NLT'
  | 'NASB'
  | 'RSV'
  | 'MSG'
  | 'AMP'
  | 'YLT'
  | 'WEB'
  | 'NET'
  | string; // Allow any string for flexibility

/**
 * Rich metadata for a Bible reference.
 */
export interface BibleReferenceMetadata {
  /** Book name (canonical form, e.g., "Matthew", "1 Corinthians") */
  book: string;
  /** Chapter number */
  chapter: number;
  /** Starting verse number (null for chapter-only references) */
  verseStart: number | null;
  /** Ending verse number (null for single verse or chapter-only) */
  verseEnd: number | null;
  /** Original text as it appeared in transcript (e.g., "Matthew chapter 5 verse 3") */
  originalText: string;
  /** Normalized reference string (e.g., "Matthew 5:3") */
  normalizedReference: string;
}

/**
 * Metadata for passage detection and matching.
 */
export interface PassageDetectionMetadata {
  /** Match confidence score (0.0 to 1.0) */
  confidence: number;
  /** Confidence level category */
  confidenceLevel: ConfidenceLevel;
  /** Detected Bible translation used */
  translation: BibleTranslation;
  /** Whether translation was auto-detected for this passage */
  translationAutoDetected: boolean;
  /** Actual verse text from Bible API (for verification/display) */
  verseText: string;
  /** Whether a partial verse match was used */
  isPartialMatch: boolean;
  /** Number of matching words (for debugging) */
  matchingWordCount?: number;
  /** Total words in verse (for debugging) */
  totalVerseWords?: number;
}

/**
 * Interjection within a passage (e.g., "a what?", "amen?").
 */
export interface InterjectionMetadata {
  /** Stable ID for this interjection */
  id: NodeId;
  /** The interjection text */
  text: string;
  /** Character offset within the passage content where interjection starts */
  offsetStart: number;
  /** Character offset within the passage content where interjection ends */
  offsetEnd: number;
}

/**
 * Complete metadata for a Bible passage.
 */
export interface PassageMetadata {
  /** Reference information (optional for non-biblical passages) */
  reference?: BibleReferenceMetadata;
  /** Detection metadata (optional for user-created passages) */
  detection?: PassageDetectionMetadata;
  /** Interjections found within this passage */
  interjections: InterjectionMetadata[];
  /** Whether the passage has been manually verified by user */
  userVerified: boolean;
  /** User notes about this passage */
  userNotes?: string;
  /** Whether this is a non-biblical passage (e.g., speaker's memorable statement) */
  isNonBiblicalPassage?: boolean;
  /** Character offset of passage start within parent paragraph */
  startOffset?: number;
  /** Character offset of passage end within parent paragraph */
  endOffset?: number;
}

/**
 * Interjection node - inline element within a passage.
 */
export interface InterjectionNode extends BaseNode {
  type: 'interjection';
  /** The interjection text */
  content: string;
  /** Reference to parent passage's metadata interjection entry */
  metadataId: NodeId;
}

/**
 * Passage node - contains a Bible passage with full metadata.
 *
 * This is for SEMANTIC content (scripture references), not visual formatting.
 * For visual block quote formatting, use ParagraphNode with isBlockQuote=true.
 */
export interface PassageNode extends BaseNode {
  type: 'passage';
  /** Rich metadata for this passage */
  metadata: PassageMetadata;
  /** Child nodes (TextNode and InterjectionNode) */
  children: (TextNode | InterjectionNode)[];
}

/**
 * Root document node.
 */
export interface DocumentRootNode extends BaseNode {
  type: 'document';
  /** Document title (from metadata or user-defined) */
  title?: string;
  /** Main Bible passage (from audio metadata) */
  biblePassage?: string;
  /** Speaker/Author (from audio metadata authors field) */
  speaker?: string;
  /** Semantic tags extracted from content */
  tags?: string[];
  /** Top-level children (paragraphs and passages) */
  children: DocumentNode[];
}

/**
 * Union type of all document nodes.
 *
 * The AST has 5 semantic node types:
 * - DocumentRootNode: Root container
 * - ParagraphNode: Block content (with optional heading/list/blockQuote formatting)
 * - TextNode: Leaf text with marks
 * - PassageNode: Bible passage with metadata
 * - InterjectionNode: Inline within passages
 */
export type DocumentNode =
  | DocumentRootNode
  | ParagraphNode
  | TextNode
  | PassageNode
  | InterjectionNode;

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Base interface for all document events.
 */
export interface BaseEvent {
  /** Unique event ID */
  id: EventId;
  /** Event type discriminator */
  type: string;
  /** Timestamp when event occurred (ISO 8601) */
  timestamp: string;
  /** Version after this event is applied */
  resultingVersion: Version;
  /** Optional user/system that created this event */
  source?: 'system' | 'user' | 'import';
}

// --- Node Lifecycle Events ---

export interface NodeCreatedEvent extends BaseEvent {
  type: 'node_created';
  /** The created node (full snapshot) */
  node: DocumentNode;
  /** Parent node ID (null for root) */
  parentId: NodeId | null;
  /** Index in parent's children array */
  index: number;
}

export interface NodeDeletedEvent extends BaseEvent {
  type: 'node_deleted';
  /** ID of deleted node */
  nodeId: NodeId;
  /** Snapshot of deleted node (for undo) */
  deletedNode: DocumentNode;
  /** Parent node ID */
  parentId: NodeId;
  /** Previous index in parent's children array */
  previousIndex: number;
}

export interface NodeMovedEvent extends BaseEvent {
  type: 'node_moved';
  /** ID of moved node */
  nodeId: NodeId;
  /** Previous parent ID */
  fromParentId: NodeId;
  /** Previous index */
  fromIndex: number;
  /** New parent ID */
  toParentId: NodeId;
  /** New index */
  toIndex: number;
}

// --- Content Events ---

export interface TextChangedEvent extends BaseEvent {
  type: 'text_changed';
  /** ID of the text node */
  nodeId: NodeId;
  /** Previous content (for undo) */
  previousContent: string;
  /** New content */
  newContent: string;
  /** Character offset where change starts */
  offset: number;
  /** Number of characters deleted */
  deleteCount: number;
  /** Text inserted */
  insertedText: string;
}

export interface ContentReplacedEvent extends BaseEvent {
  type: 'content_replaced';
  /** ID of the node */
  nodeId: NodeId;
  /** Previous children (for undo) */
  previousChildren: DocumentNode[];
  /** New children */
  newChildren: DocumentNode[];
}

// --- Passage-Specific Events ---

export interface PassageCreatedEvent extends BaseEvent {
  type: 'passage_created';
  /** The passage node */
  passage: PassageNode;
  /** Parent node ID */
  parentId: NodeId;
  /** Index in parent */
  index: number;
  /** IDs of nodes that were replaced/wrapped by this passage */
  replacedNodeIds: NodeId[];
}


export interface PassageRemovedEvent extends BaseEvent {
  type: 'passage_removed';
  /** ID of the passage being removed */
  passageId: NodeId;
  /** The removed passage (for undo) */
  removedPassage: PassageNode;
  /** Nodes that replace the passage (unwrapped content) */
  replacementNodes: DocumentNode[];
}


export interface PassageMetadataUpdatedEvent extends BaseEvent {
  type: 'passage_metadata_updated';
  /** ID of the passage */
  passageId: NodeId;
  /** Previous metadata (for undo) */
  previousMetadata: PassageMetadata;
  /** New metadata */
  newMetadata: PassageMetadata;
  /** Specific fields that changed */
  changedFields: (keyof PassageMetadata)[];
}


export interface PassageVerifiedEvent extends BaseEvent {
  type: 'passage_verified';
  /** ID of the passage */
  passageId: NodeId;
  /** Whether the passage is now verified */
  verified: boolean;
  /** Optional user notes */
  notes?: string;
}


export interface InterjectionAddedEvent extends BaseEvent {
  type: 'interjection_added';
  /** ID of the parent passage */
  passageId: NodeId;
  /** The interjection node */
  interjection: InterjectionNode;
  /** Index in passage's children */
  index: number;
}

export interface InterjectionRemovedEvent extends BaseEvent {
  type: 'interjection_removed';
  /** ID of the parent passage */
  passageId: NodeId;
  /** ID of the removed interjection */
  interjectionId: NodeId;
  /** The removed interjection (for undo) */
  removedInterjection: InterjectionNode;
  /** Previous index */
  previousIndex: number;
}

export interface PassageBoundaryChangedEvent extends BaseEvent {
  type: 'passage_boundary_changed';
  /** ID of the passage */
  passageId: NodeId;
  /** Previous boundaries */
  previousBoundaries: {
    startOffset: number;
    endOffset: number;
  };
  /** New boundaries */
  newBoundaries: {
    startOffset: number;
    endOffset: number;
  };
  /** Previous passage content (for undo) */
  previousContent: string;
  /** New passage content */
  newContent: string;
  /** IDs of paragraphs that were merged (if any) */
  mergedParagraphIds?: NodeId[];
  /** Snapshot of merged paragraphs (for undo) */
  mergedParagraphs?: ParagraphNode[];
}


export interface ParagraphsMergedForPassageEvent extends BaseEvent {
  type: 'paragraphs_merged_for_passage';
  /** ID of the resulting merged paragraph */
  resultParagraphId: NodeId;
  /** IDs of all paragraphs that were merged */
  mergedParagraphIds: NodeId[];
  /** Snapshots of merged paragraphs (for undo) */
  mergedParagraphs: ParagraphNode[];
  /** The passage that triggered this merge */
  triggeringPassageId?: NodeId;
}

// --- Structure Events ---

export interface NodesJoinedEvent extends BaseEvent {
  type: 'nodes_joined';
  /** IDs of nodes being joined (in order) */
  sourceNodeIds: NodeId[];
  /** The resulting merged node */
  resultNode: DocumentNode;
  /** Snapshots of source nodes (for undo) */
  sourceNodes: DocumentNode[];
}

export interface NodeSplitEvent extends BaseEvent {
  type: 'node_split';
  /** ID of the original node */
  originalNodeId: NodeId;
  /** The original node (for undo) */
  originalNode: DocumentNode;
  /** Resulting nodes after split */
  resultNodes: DocumentNode[];
  /** Character offset where split occurred */
  splitOffset: number;
}

export interface ParagraphMergedEvent extends BaseEvent {
  type: 'paragraph_merged';
  /** ID of the target paragraph (survives) */
  targetParagraphId: NodeId;
  /** ID of the merged paragraph (deleted) */
  mergedParagraphId: NodeId;
  /** Snapshot of merged paragraph (for undo) */
  mergedParagraph: ParagraphNode;
}

export interface ParagraphSplitEvent extends BaseEvent {
  type: 'paragraph_split';
  /** ID of the original paragraph */
  originalParagraphId: NodeId;
  /** Original paragraph (for undo) */
  originalParagraph: ParagraphNode;
  /** First result paragraph */
  firstParagraph: ParagraphNode;
  /** Second result paragraph */
  secondParagraph: ParagraphNode;
  /** Character offset where split occurred */
  splitOffset: number;
}

// --- Document-Level Events ---

export interface DocumentCreatedEvent extends BaseEvent {
  type: 'document_created';
  /** The root document node */
  document: DocumentRootNode;
  /** Source of the document (transcription, import, etc.) */
  creationSource: 'transcription' | 'import' | 'new';
}

export interface DocumentMetadataUpdatedEvent extends BaseEvent {
  type: 'document_metadata_updated';
  /** Previous title */
  previousTitle?: string;
  /** New title */
  newTitle?: string;
  /** Previous Bible passage */
  previousBiblePassage?: string;
  /** New Bible passage */
  newBiblePassage?: string;
  /** Previous speaker */
  previousSpeaker?: string;
  /** New speaker */
  newSpeaker?: string;
  /** Previous tags */
  previousTags?: string[];
  /** New tags */
  newTags?: string[];
}

export interface DocumentImportedEvent extends BaseEvent {
  type: 'document_imported';
  /** The imported document */
  document: DocumentRootNode;
  /** Original format */
  sourceFormat: 'html' | 'markdown' | 'plain_text' | 'legacy_sermon';
  /** Whether this replaced existing content */
  replacedExisting: boolean;
}

// --- Batch/Undo Events ---

export interface BatchEvent extends BaseEvent {
  type: 'batch';
  /** Events in this batch (applied atomically) */
  events: DocumentEvent[];
  /** Description of the batch operation */
  description: string;
}

export interface UndoEvent extends BaseEvent {
  type: 'undo';
  /** ID of the event being undone */
  undoneEventId: EventId;
  /** Inverse events that undo the operation */
  inverseEvents: DocumentEvent[];
}

export interface RedoEvent extends BaseEvent {
  type: 'redo';
  /** ID of the undo event being redone */
  redoneUndoEventId: EventId;
  /** Original events being reapplied */
  reappliedEvents: DocumentEvent[];
}

/**
 * Union type of all document events.
 */
export type DocumentEvent =
  | NodeCreatedEvent
  | NodeDeletedEvent
  | NodeMovedEvent
  | TextChangedEvent
  | ContentReplacedEvent
  | PassageCreatedEvent
  | PassageRemovedEvent
  | PassageMetadataUpdatedEvent
  | PassageVerifiedEvent
  | PassageBoundaryChangedEvent
  | InterjectionAddedEvent
  | InterjectionRemovedEvent
  | NodesJoinedEvent
  | NodeSplitEvent
  | ParagraphMergedEvent
  | ParagraphSplitEvent
  | ParagraphsMergedForPassageEvent
  | DocumentCreatedEvent
  | DocumentMetadataUpdatedEvent
  | DocumentImportedEvent
  | BatchEvent
  | UndoEvent
  | RedoEvent;

// ============================================================================
// DOCUMENT STATE
// ============================================================================

/**
 * Index for fast node lookups by ID.
 */
export interface NodeIndex {
  [nodeId: NodeId]: {
    node: DocumentNode;
    parentId: NodeId | null;
    path: NodeId[];
  };
}

/**
 * Index for fast passage lookups by reference.
 */
export interface PassageIndex {
  /** Map from normalized reference string to passage node IDs */
  byReference: { [reference: string]: NodeId[] };
  /** Map from book name to passage node IDs */
  byBook: { [book: string]: NodeId[] };
  /** All passage node IDs in document order */
  all: NodeId[];
}


/**
 * Extracted references for backward compatibility.
 */
export interface ExtractedReferences {
  /** List of normalized reference strings */
  references: string[];
  /** List of extracted tags */
  tags: string[];
}

/**
 * Complete document state for persistence and undo.
 */
export interface DocumentState {
  /** Current version number */
  version: Version;
  /** Root document node (the AST) */
  root: DocumentRootNode;
  /** Event log (newest last) */
  eventLog: DocumentEvent[];
  /** Undo stack (event IDs that can be undone) */
  undoStack: EventId[];
  /** Redo stack (undo event IDs that can be redone) */
  redoStack: EventId[];
  /** Node index for fast lookups */
  nodeIndex: NodeIndex;
  /** Passage index for fast lookups */
  passageIndex: PassageIndex;
  /** Extracted references (for backward compatibility) */
  extracted: ExtractedReferences;
  /** Last modified timestamp (ISO 8601) */
  lastModified: string;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Options for creating a new document.
 */
export interface CreateDocumentOptions {
  /** Document title */
  title?: string;
  /** Main Bible passage */
  biblePassage?: string;
  /** Initial content (plain text to be parsed) */
  initialContent?: string;
  /** Creation source */
  source?: 'transcription' | 'import' | 'new';
}

/**
 * Options for finding passage boundaries.
 */
export interface PassageBoundaryOptions {
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Whether to auto-detect translation */
  autoDetectTranslation?: boolean;
  /** Preferred translation if not auto-detecting */
  preferredTranslation?: BibleTranslation;
}


/**
 * Result from Python AST builder (serialized).
 */
export interface ASTBuilderResult {
  /** The document state */
  documentState: DocumentState;
  /** Processing metadata */
  processingMetadata: {
    /** Time taken for each stage (ms) */
    stageTimes: { [stage: string]: number };
    /** Total processing time (ms) */
    totalTime: number;
    /** Number of passages detected */
    passageCount: number;
    /** Number of paragraphs */
    paragraphCount: number;
    /** Number of interjections */
    interjectionCount: number;
  };
}

// ============================================================================
// UTILITY FUNCTIONS (TYPE GUARDS)
// ============================================================================

/**
 * Type guard for TextNode.
 */
export function isTextNode(node: DocumentNode): node is TextNode {
  return node.type === 'text';
}

/**
 * Type guard for ParagraphNode.
 */
export function isParagraphNode(node: DocumentNode): node is ParagraphNode {
  return node.type === 'paragraph';
}

/**
 * Type guard for PassageNode.
 */
export function isPassageNode(node: DocumentNode): node is PassageNode {
  return node.type === 'passage';
}

/**
 * Type guard for InterjectionNode.
 */
export function isInterjectionNode(node: DocumentNode): node is InterjectionNode {
  return node.type === 'interjection';
}

/**
 * Type guard for DocumentRootNode.
 */
export function isDocumentRootNode(node: DocumentNode): node is DocumentRootNode {
  return node.type === 'document';
}

/**
 * Check if a paragraph has heading formatting.
 */
export function isHeadingParagraph(node: DocumentNode): node is ParagraphNode & { headingLevel: 1 | 2 | 3 } {
  return isParagraphNode(node) && node.headingLevel !== undefined;
}

/**
 * Check if a paragraph is a list item.
 */
export function isListItemParagraph(node: DocumentNode): node is ParagraphNode & { listStyle: 'bullet' | 'ordered' } {
  return isParagraphNode(node) && node.listStyle !== undefined;
}

/**
 * Check if a paragraph has block quote formatting.
 * This is visual formatting only, NOT a Bible passage.
 */
export function isBlockQuoteParagraph(node: DocumentNode): node is ParagraphNode & { isBlockQuote: true } {
  return isParagraphNode(node) && node.isBlockQuote === true;
}

/**
 * Check if a node has children.
 */
export function hasChildren(
  node: DocumentNode
): node is DocumentRootNode | ParagraphNode | PassageNode {
  return 'children' in node && Array.isArray(node.children);
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Confidence thresholds for passage detection.
 */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.8,
  MEDIUM: 0.6,
  LOW: 0.4,
} as const;

/**
 * Get confidence level from score.
 */
export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Default maximum events to keep in log before compaction.
 */
export const DEFAULT_MAX_EVENT_LOG_SIZE = 1000;

/**
 * Default undo stack size.
 */
export const DEFAULT_UNDO_STACK_SIZE = 100;
