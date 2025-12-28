/**
 * Document Model - Hybrid AST + Event Log Architecture
 *
 * This module defines the complete type system for the structured document model
 * that replaces the legacy plain-text quote processing approach.
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
 * - QuoteBlockNode: Special node for Bible quotes with rich metadata
 * - DocumentEvent: Immutable events for all document mutations
 * - DocumentState: Complete state snapshot for persistence/undo
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
 */
export type NodeType =
  | 'document'
  | 'paragraph'
  | 'text'
  | 'quote_block'
  | 'interjection'
  | 'heading'
  | 'list'
  | 'list_item';

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
 * Plain text node - leaf node containing actual text content.
 */
export interface TextNode extends BaseNode {
  type: 'text';
  /** The actual text content */
  content: string;
}

/**
 * Paragraph node - container for inline content.
 */
export interface ParagraphNode extends BaseNode {
  type: 'paragraph';
  /** Child nodes (typically TextNode, InterjectionNode, etc.) */
  children: DocumentNode[];
}

/**
 * Heading node for section titles.
 */
export interface HeadingNode extends BaseNode {
  type: 'heading';
  /** Heading level (1-6) */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Child nodes */
  children: DocumentNode[];
}

/**
 * List node for ordered/unordered lists.
 */
export interface ListNode extends BaseNode {
  type: 'list';
  /** Whether the list is ordered (numbered) */
  ordered: boolean;
  /** List item children */
  children: ListItemNode[];
}

/**
 * List item node.
 */
export interface ListItemNode extends BaseNode {
  type: 'list_item';
  /** Content nodes */
  children: DocumentNode[];
}

// ============================================================================
// BIBLE QUOTE TYPES
// ============================================================================

/**
 * Confidence level for quote detection.
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
 * Metadata for quote detection and matching.
 */
export interface QuoteDetectionMetadata {
  /** Match confidence score (0.0 to 1.0) */
  confidence: number;
  /** Confidence level category */
  confidenceLevel: ConfidenceLevel;
  /** Detected Bible translation used */
  translation: BibleTranslation;
  /** Whether translation was auto-detected for this quote */
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
 * Interjection within a quote (e.g., "a what?", "amen?").
 */
export interface InterjectionMetadata {
  /** Stable ID for this interjection */
  id: NodeId;
  /** The interjection text */
  text: string;
  /** Character offset within the quote content where interjection starts */
  offsetStart: number;
  /** Character offset within the quote content where interjection ends */
  offsetEnd: number;
}

/**
 * Complete metadata for a Bible quote block.
 */
export interface QuoteMetadata {
  /** Reference information */
  reference: BibleReferenceMetadata;
  /** Detection metadata */
  detection: QuoteDetectionMetadata;
  /** Interjections found within this quote */
  interjections: InterjectionMetadata[];
  /** Whether the quote has been manually verified by user */
  userVerified: boolean;
  /** User notes about this quote */
  userNotes?: string;
}

/**
 * Interjection node - inline element within a quote.
 */
export interface InterjectionNode extends BaseNode {
  type: 'interjection';
  /** The interjection text */
  content: string;
  /** Reference to parent quote's metadata interjection entry */
  metadataId: NodeId;
}

/**
 * Quote block node - contains the Bible quote with full metadata.
 */
export interface QuoteBlockNode extends BaseNode {
  type: 'quote_block';
  /** Rich metadata for this quote */
  metadata: QuoteMetadata;
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
  /** Top-level children (paragraphs, quote blocks, headings, etc.) */
  children: DocumentNode[];
}

/**
 * Union type of all document nodes.
 */
export type DocumentNode =
  | DocumentRootNode
  | ParagraphNode
  | TextNode
  | QuoteBlockNode
  | InterjectionNode
  | HeadingNode
  | ListNode
  | ListItemNode;

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

// --- Quote-Specific Events ---

export interface QuoteCreatedEvent extends BaseEvent {
  type: 'quote_created';
  /** The quote node */
  quote: QuoteBlockNode;
  /** Parent node ID */
  parentId: NodeId;
  /** Index in parent */
  index: number;
  /** IDs of nodes that were replaced/wrapped by this quote */
  replacedNodeIds: NodeId[];
}

export interface QuoteRemovedEvent extends BaseEvent {
  type: 'quote_removed';
  /** ID of the quote being removed */
  quoteId: NodeId;
  /** The removed quote (for undo) */
  removedQuote: QuoteBlockNode;
  /** Nodes that replace the quote (unwrapped content) */
  replacementNodes: DocumentNode[];
}

export interface QuoteMetadataUpdatedEvent extends BaseEvent {
  type: 'quote_metadata_updated';
  /** ID of the quote */
  quoteId: NodeId;
  /** Previous metadata (for undo) */
  previousMetadata: QuoteMetadata;
  /** New metadata */
  newMetadata: QuoteMetadata;
  /** Specific fields that changed */
  changedFields: (keyof QuoteMetadata)[];
}

export interface QuoteVerifiedEvent extends BaseEvent {
  type: 'quote_verified';
  /** ID of the quote */
  quoteId: NodeId;
  /** Whether the quote is now verified */
  verified: boolean;
  /** Optional user notes */
  notes?: string;
}

export interface InterjectionAddedEvent extends BaseEvent {
  type: 'interjection_added';
  /** ID of the parent quote */
  quoteId: NodeId;
  /** The interjection node */
  interjection: InterjectionNode;
  /** Index in quote's children */
  index: number;
}

export interface InterjectionRemovedEvent extends BaseEvent {
  type: 'interjection_removed';
  /** ID of the parent quote */
  quoteId: NodeId;
  /** ID of the removed interjection */
  interjectionId: NodeId;
  /** The removed interjection (for undo) */
  removedInterjection: InterjectionNode;
  /** Previous index */
  previousIndex: number;
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
  | QuoteCreatedEvent
  | QuoteRemovedEvent
  | QuoteMetadataUpdatedEvent
  | QuoteVerifiedEvent
  | InterjectionAddedEvent
  | InterjectionRemovedEvent
  | NodesJoinedEvent
  | NodeSplitEvent
  | ParagraphMergedEvent
  | ParagraphSplitEvent
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
 * Index for fast quote lookups by reference.
 */
export interface QuoteIndex {
  /** Map from normalized reference string to quote node IDs */
  byReference: { [reference: string]: NodeId[] };
  /** Map from book name to quote node IDs */
  byBook: { [book: string]: NodeId[] };
  /** All quote node IDs in document order */
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
  /** Quote index for fast lookups */
  quoteIndex: QuoteIndex;
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
 * Options for finding quote boundaries.
 */
export interface QuoteBoundaryOptions {
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
    /** Number of quotes detected */
    quoteCount: number;
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
 * Type guard for QuoteBlockNode.
 */
export function isQuoteBlockNode(node: DocumentNode): node is QuoteBlockNode {
  return node.type === 'quote_block';
}

/**
 * Type guard for InterjectionNode.
 */
export function isInterjectionNode(node: DocumentNode): node is InterjectionNode {
  return node.type === 'interjection';
}

/**
 * Type guard for HeadingNode.
 */
export function isHeadingNode(node: DocumentNode): node is HeadingNode {
  return node.type === 'heading';
}

/**
 * Type guard for ListNode.
 */
export function isListNode(node: DocumentNode): node is ListNode {
  return node.type === 'list';
}

/**
 * Type guard for DocumentRootNode.
 */
export function isDocumentRootNode(node: DocumentNode): node is DocumentRootNode {
  return node.type === 'document';
}

/**
 * Check if a node has children.
 */
export function hasChildren(
  node: DocumentNode
): node is DocumentRootNode | ParagraphNode | QuoteBlockNode | HeadingNode | ListNode | ListItemNode {
  return 'children' in node && Array.isArray(node.children);
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Confidence thresholds for quote detection.
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
