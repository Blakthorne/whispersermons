/**
 * Event Factory - Creates document events for the Hybrid AST + Event Log architecture.
 *
 * This module provides factory functions for creating each type of document event.
 * All events are immutable and contain sufficient information for undo/redo.
 *
 * Event creation pattern:
 * 1. Factory function validates inputs
 * 2. Generates unique event ID and timestamp
 * 3. Creates properly typed event object
 * 4. Event is then passed to reducer for application
 */

import type {
  EventId,
  Version,
  NodeId,
  DocumentNode,
  DocumentRootNode,
  DocumentState,
  ParagraphNode,
  TextNode,
  QuoteBlockNode,
  InterjectionNode,
  QuoteMetadata,
  NodeCreatedEvent,
  NodeDeletedEvent,
  NodeMovedEvent,
  TextChangedEvent,
  ContentReplacedEvent,
  QuoteCreatedEvent,
  QuoteRemovedEvent,
  QuoteMetadataUpdatedEvent,
  QuoteVerifiedEvent,
  InterjectionAddedEvent,
  InterjectionRemovedEvent,
  NodesJoinedEvent,
  NodeSplitEvent,
  ParagraphMergedEvent,
  ParagraphSplitEvent,
  DocumentCreatedEvent,
  DocumentMetadataUpdatedEvent,
  BatchEvent,
  UndoEvent,
  RedoEvent,
  DocumentEvent,
} from '../../../../shared/documentModel';

// ============================================================================
// UUID GENERATION
// ============================================================================

/**
 * Generate a UUID v4.
 * Uses crypto.randomUUID if available, falls back to manual generation.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a unique event ID with 'evt-' prefix.
 */
export function createEventId(): EventId {
  return `evt-${generateUUID()}`;
}

/**
 * Generate a unique node ID with 'node-' prefix.
 */
export function createNodeId(): NodeId {
  return `node-${generateUUID()}`;
}

/**
 * Get current ISO timestamp.
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

// ============================================================================
// EVENT SOURCE
// ============================================================================

export type EventSource = 'system' | 'user' | 'import';

// ============================================================================
// NODE LIFECYCLE EVENTS
// ============================================================================

/**
 * Create a NodeCreatedEvent.
 */
export function createNodeCreatedEvent(
  node: DocumentNode,
  parentId: NodeId | null,
  index: number,
  resultingVersion: Version,
  source: EventSource = 'user'
): NodeCreatedEvent {
  return {
    id: createEventId(),
    type: 'node_created',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    node,
    parentId,
    index,
  };
}

/**
 * Create a NodeDeletedEvent.
 */
export function createNodeDeletedEvent(
  nodeId: NodeId,
  deletedNode: DocumentNode,
  parentId: NodeId,
  previousIndex: number,
  resultingVersion: Version,
  source: EventSource = 'user'
): NodeDeletedEvent {
  return {
    id: createEventId(),
    type: 'node_deleted',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    nodeId,
    deletedNode,
    parentId,
    previousIndex,
  };
}

/**
 * Create a NodeMovedEvent.
 */
export function createNodeMovedEvent(
  nodeId: NodeId,
  fromParentId: NodeId,
  fromIndex: number,
  toParentId: NodeId,
  toIndex: number,
  resultingVersion: Version,
  source: EventSource = 'user'
): NodeMovedEvent {
  return {
    id: createEventId(),
    type: 'node_moved',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    nodeId,
    fromParentId,
    fromIndex,
    toParentId,
    toIndex,
  };
}

// ============================================================================
// CONTENT EVENTS
// ============================================================================

/**
 * Create a TextChangedEvent.
 */
export function createTextChangedEvent(
  nodeId: NodeId,
  previousContent: string,
  newContent: string,
  offset: number,
  deleteCount: number,
  insertedText: string,
  resultingVersion: Version,
  source: EventSource = 'user'
): TextChangedEvent {
  return {
    id: createEventId(),
    type: 'text_changed',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    nodeId,
    previousContent,
    newContent,
    offset,
    deleteCount,
    insertedText,
  };
}

/**
 * Create a ContentReplacedEvent.
 */
export function createContentReplacedEvent(
  nodeId: NodeId,
  previousChildren: DocumentNode[],
  newChildren: DocumentNode[],
  resultingVersion: Version,
  source: EventSource = 'user'
): ContentReplacedEvent {
  return {
    id: createEventId(),
    type: 'content_replaced',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    nodeId,
    previousChildren,
    newChildren,
  };
}

// ============================================================================
// QUOTE-SPECIFIC EVENTS
// ============================================================================

/**
 * Create a QuoteCreatedEvent.
 */
export function createQuoteCreatedEvent(
  quote: QuoteBlockNode,
  parentId: NodeId,
  index: number,
  replacedNodeIds: NodeId[],
  resultingVersion: Version,
  source: EventSource = 'user'
): QuoteCreatedEvent {
  return {
    id: createEventId(),
    type: 'quote_created',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    quote,
    parentId,
    index,
    replacedNodeIds,
  };
}

/**
 * Create a QuoteRemovedEvent.
 */
export function createQuoteRemovedEvent(
  quoteId: NodeId,
  removedQuote: QuoteBlockNode,
  replacementNodes: DocumentNode[],
  resultingVersion: Version,
  source: EventSource = 'user'
): QuoteRemovedEvent {
  return {
    id: createEventId(),
    type: 'quote_removed',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    quoteId,
    removedQuote,
    replacementNodes,
  };
}

/**
 * Create a QuoteMetadataUpdatedEvent.
 */
export function createQuoteMetadataUpdatedEvent(
  quoteId: NodeId,
  previousMetadata: QuoteMetadata,
  newMetadata: QuoteMetadata,
  changedFields: (keyof QuoteMetadata)[],
  resultingVersion: Version,
  source: EventSource = 'user'
): QuoteMetadataUpdatedEvent {
  return {
    id: createEventId(),
    type: 'quote_metadata_updated',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    quoteId,
    previousMetadata,
    newMetadata,
    changedFields,
  };
}

/**
 * Create a QuoteVerifiedEvent.
 */
export function createQuoteVerifiedEvent(
  quoteId: NodeId,
  verified: boolean,
  notes: string | undefined,
  resultingVersion: Version,
  source: EventSource = 'user'
): QuoteVerifiedEvent {
  return {
    id: createEventId(),
    type: 'quote_verified',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    quoteId,
    verified,
    notes,
  };
}

/**
 * Create an InterjectionAddedEvent.
 */
export function createInterjectionAddedEvent(
  quoteId: NodeId,
  interjection: InterjectionNode,
  index: number,
  resultingVersion: Version,
  source: EventSource = 'user'
): InterjectionAddedEvent {
  return {
    id: createEventId(),
    type: 'interjection_added',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    quoteId,
    interjection,
    index,
  };
}

/**
 * Create an InterjectionRemovedEvent.
 */
export function createInterjectionRemovedEvent(
  quoteId: NodeId,
  interjectionId: NodeId,
  removedInterjection: InterjectionNode,
  previousIndex: number,
  resultingVersion: Version,
  source: EventSource = 'user'
): InterjectionRemovedEvent {
  return {
    id: createEventId(),
    type: 'interjection_removed',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    quoteId,
    interjectionId,
    removedInterjection,
    previousIndex,
  };
}

// ============================================================================
// STRUCTURE EVENTS
// ============================================================================

/**
 * Create a NodesJoinedEvent.
 */
export function createNodesJoinedEvent(
  sourceNodeIds: NodeId[],
  resultNode: DocumentNode,
  sourceNodes: DocumentNode[],
  resultingVersion: Version,
  source: EventSource = 'user'
): NodesJoinedEvent {
  return {
    id: createEventId(),
    type: 'nodes_joined',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    sourceNodeIds,
    resultNode,
    sourceNodes,
  };
}

/**
 * Create a NodeSplitEvent.
 */
export function createNodeSplitEvent(
  originalNodeId: NodeId,
  originalNode: DocumentNode,
  resultNodes: DocumentNode[],
  splitOffset: number,
  resultingVersion: Version,
  source: EventSource = 'user'
): NodeSplitEvent {
  return {
    id: createEventId(),
    type: 'node_split',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    originalNodeId,
    originalNode,
    resultNodes,
    splitOffset,
  };
}

/**
 * Create a ParagraphMergedEvent.
 */
export function createParagraphMergedEvent(
  targetParagraphId: NodeId,
  mergedParagraphId: NodeId,
  mergedParagraph: ParagraphNode,
  resultingVersion: Version,
  source: EventSource = 'user'
): ParagraphMergedEvent {
  return {
    id: createEventId(),
    type: 'paragraph_merged',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    targetParagraphId,
    mergedParagraphId,
    mergedParagraph,
  };
}

/**
 * Create a ParagraphSplitEvent.
 */
export function createParagraphSplitEvent(
  originalParagraphId: NodeId,
  originalParagraph: ParagraphNode,
  firstParagraph: ParagraphNode,
  secondParagraph: ParagraphNode,
  splitOffset: number,
  resultingVersion: Version,
  source: EventSource = 'user'
): ParagraphSplitEvent {
  return {
    id: createEventId(),
    type: 'paragraph_split',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    originalParagraphId,
    originalParagraph,
    firstParagraph,
    secondParagraph,
    splitOffset,
  };
}

// ============================================================================
// DOCUMENT-LEVEL EVENTS
// ============================================================================

/**
 * Create a DocumentCreatedEvent.
 */
export function createDocumentCreatedEvent(
  document: DocumentRootNode,
  creationSource: 'transcription' | 'import' | 'new',
  resultingVersion: Version,
  source: EventSource = 'system'
): DocumentCreatedEvent {
  return {
    id: createEventId(),
    type: 'document_created',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    document,
    creationSource,
  };
}

/**
 * Create a DocumentMetadataUpdatedEvent.
 */
export function createDocumentMetadataUpdatedEvent(
  updates: {
    previousTitle?: string;
    newTitle?: string;
    previousBiblePassage?: string;
    newBiblePassage?: string;
  },
  resultingVersion: Version,
  source: EventSource = 'user'
): DocumentMetadataUpdatedEvent {
  return {
    id: createEventId(),
    type: 'document_metadata_updated',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    ...updates,
  };
}

// ============================================================================
// BATCH/UNDO EVENTS
// ============================================================================

/**
 * Create a BatchEvent.
 */
export function createBatchEvent(
  events: DocumentEvent[],
  description: string,
  resultingVersion: Version,
  source: EventSource = 'user'
): BatchEvent {
  return {
    id: createEventId(),
    type: 'batch',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    events,
    description,
  };
}

/**
 * Create an UndoEvent.
 */
export function createUndoEvent(
  undoneEventId: EventId,
  inverseEvents: DocumentEvent[],
  resultingVersion: Version,
  source: EventSource = 'user'
): UndoEvent {
  return {
    id: createEventId(),
    type: 'undo',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    undoneEventId,
    inverseEvents,
  };
}

/**
 * Create a RedoEvent.
 */
export function createRedoEvent(
  redoneUndoEventId: EventId,
  reappliedEvents: DocumentEvent[],
  resultingVersion: Version,
  source: EventSource = 'user'
): RedoEvent {
  return {
    id: createEventId(),
    type: 'redo',
    timestamp: createTimestamp(),
    resultingVersion,
    source,
    redoneUndoEventId,
    reappliedEvents,
  };
}

// ============================================================================
// INVERSE EVENT GENERATORS (for undo)
// ============================================================================

/**
 * Generate the inverse event for a given event (for undo operations).
 * Returns an array of events that, when applied, reverse the original event.
 */
export function generateInverseEvents(
  event: DocumentEvent,
  currentVersion: Version
): DocumentEvent[] {
  const nextVersion = currentVersion + 1;

  switch (event.type) {
    case 'node_created':
      return [
        createNodeDeletedEvent(
          event.node.id,
          event.node,
          event.parentId ?? '',
          event.index,
          nextVersion,
          'user'
        ),
      ];

    case 'node_deleted':
      return [
        createNodeCreatedEvent(event.deletedNode, event.parentId, event.previousIndex, nextVersion, 'user'),
      ];

    case 'node_moved':
      return [
        createNodeMovedEvent(
          event.nodeId,
          event.toParentId,
          event.toIndex,
          event.fromParentId,
          event.fromIndex,
          nextVersion,
          'user'
        ),
      ];

    case 'text_changed':
      return [
        createTextChangedEvent(
          event.nodeId,
          event.newContent,
          event.previousContent,
          event.offset,
          event.insertedText.length,
          event.previousContent.slice(event.offset, event.offset + event.deleteCount),
          nextVersion,
          'user'
        ),
      ];

    case 'content_replaced':
      return [
        createContentReplacedEvent(
          event.nodeId,
          event.newChildren,
          event.previousChildren,
          nextVersion,
          'user'
        ),
      ];

    case 'quote_created':
      // Remove the quote and restore original nodes
      return [
        createQuoteRemovedEvent(
          event.quote.id,
          event.quote,
          [], // Original nodes would need to be stored - simplified for now
          nextVersion,
          'user'
        ),
      ];

    case 'quote_removed':
      // Recreate the quote
      return [
        createQuoteCreatedEvent(
          event.removedQuote,
          event.removedQuote.id, // Need parent ID - this is simplified
          0, // Need original index
          [],
          nextVersion,
          'user'
        ),
      ];

    case 'quote_metadata_updated':
      return [
        createQuoteMetadataUpdatedEvent(
          event.quoteId,
          event.newMetadata,
          event.previousMetadata,
          event.changedFields,
          nextVersion,
          'user'
        ),
      ];

    case 'quote_verified':
      return [
        createQuoteVerifiedEvent(event.quoteId, !event.verified, undefined, nextVersion, 'user'),
      ];

    case 'interjection_added':
      return [
        createInterjectionRemovedEvent(
          event.quoteId,
          event.interjection.id,
          event.interjection,
          event.index,
          nextVersion,
          'user'
        ),
      ];

    case 'interjection_removed':
      return [
        createInterjectionAddedEvent(
          event.quoteId,
          event.removedInterjection,
          event.previousIndex,
          nextVersion,
          'user'
        ),
      ];

    case 'paragraph_merged':
      // Split would restore - but we'd need the original split point
      return [];

    case 'paragraph_split':
      return [
        createParagraphMergedEvent(
          event.firstParagraph.id,
          event.secondParagraph.id,
          event.secondParagraph,
          nextVersion,
          'user'
        ),
      ];

    case 'document_metadata_updated':
      return [
        createDocumentMetadataUpdatedEvent(
          {
            previousTitle: event.newTitle,
            newTitle: event.previousTitle,
            previousBiblePassage: event.newBiblePassage,
            newBiblePassage: event.previousBiblePassage,
          },
          nextVersion,
          'user'
        ),
      ];

    case 'batch':
      // Inverse all events in reverse order
      const inverses: DocumentEvent[] = [];
      for (let i = event.events.length - 1; i >= 0; i--) {
        inverses.push(...generateInverseEvents(event.events[i]!, currentVersion + i));
      }
      return inverses;

    // These events don't have simple inverses
    case 'document_created':
    case 'document_imported':
    case 'nodes_joined':
    case 'node_split':
    case 'undo':
    case 'redo':
      return [];

    default:
      return [];
  }
}

// ============================================================================
// HELPER: Create text node
// ============================================================================

/**
 * Create a new TextNode.
 */
export function createTextNode(content: string, id?: NodeId): TextNode {
  return {
    id: id ?? createNodeId(),
    type: 'text',
    version: 1,
    updatedAt: createTimestamp(),
    content,
  };
}

/**
 * Create a new ParagraphNode.
 */
export function createParagraphNode(children: DocumentNode[], id?: NodeId): ParagraphNode {
  return {
    id: id ?? createNodeId(),
    type: 'paragraph',
    version: 1,
    updatedAt: createTimestamp(),
    children,
  };
}

/**
 * Create a new DocumentRootNode with default empty structure.
 */
export function createDocumentRootNode(
  options: {
    title?: string;
    biblePassage?: string;
    children?: DocumentNode[];
  } = {}
): DocumentRootNode {
  const { title, biblePassage, children = [] } = options;
  return {
    id: createNodeId(),
    type: 'document',
    version: 1,
    updatedAt: createTimestamp(),
    title,
    biblePassage,
    children,
  };
}

/**
 * Create a new DocumentState from a root node.
 */
export function createDocumentState(root: DocumentRootNode): DocumentState {
  // Build node index
  const nodeIndex: DocumentState['nodeIndex'] = {};
  const quoteIndex: DocumentState['quoteIndex'] = {
    byReference: {},
    byBook: {},
    all: [],
  };

  function indexNode(node: DocumentNode, parentId: NodeId | null, path: NodeId[]): void {
    nodeIndex[node.id] = {
      node,
      parentId,
      path: [...path],
    };

    // Index quotes
    if (node.type === 'quote_block') {
      const quote = node as QuoteBlockNode;
      const ref = quote.metadata.reference.normalizedReference;
      const book = quote.metadata.reference.book;

      if (!quoteIndex.byReference[ref]) {
        quoteIndex.byReference[ref] = [];
      }
      quoteIndex.byReference[ref].push(node.id);

      if (!quoteIndex.byBook[book]) {
        quoteIndex.byBook[book] = [];
      }
      quoteIndex.byBook[book].push(node.id);

      quoteIndex.all.push(node.id);
    }

    // Index children
    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach((child) => {
        indexNode(child, node.id, [...path, node.id]);
      });
    }
  }

  // Index root and all children
  nodeIndex[root.id] = {
    node: root,
    parentId: null,
    path: [],
  };
  root.children.forEach((child) => indexNode(child, root.id, [root.id]));

  const timestamp = createTimestamp();

  return {
    root,
    version: 1,
    nodeIndex,
    quoteIndex,
    extracted: {
      references: [],
      tags: [],
    },
    eventLog: [],
    undoStack: [],
    redoStack: [],
    lastModified: timestamp,
    createdAt: timestamp,
  };
}
