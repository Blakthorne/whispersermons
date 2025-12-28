/**
 * Document Reducer - Pure function for applying events to DocumentState.
 *
 * This module provides the core state transition logic for the event-sourced
 * document model. Each event type has a corresponding handler that produces
 * a new immutable DocumentState.
 *
 * Key responsibilities:
 * - Apply events to produce new state
 * - Maintain node and quote indexes
 * - Handle version increments
 * - Update timestamps
 * - Manage undo/redo stacks
 */

import type {
  DocumentState,
  DocumentNode,
  DocumentRootNode,
  ParagraphNode,
  TextNode,
  QuoteBlockNode,
  NodeId,
  NodeIndex,
  QuoteIndex,
  DocumentEvent,
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
  ParagraphMergedEvent,
  ParagraphSplitEvent,
  DocumentMetadataUpdatedEvent,
  BatchEvent,
  UndoEvent,
  RedoEvent,
} from '../../../../shared/documentModel';

import {
  hasChildren,
  isQuoteBlockNode,
  DEFAULT_UNDO_STACK_SIZE,
} from '../../../../shared/documentModel';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from applying an event.
 */
export interface ApplyEventResult {
  /** The new state after applying the event */
  state: DocumentState;
  /** Whether the event was successfully applied */
  success: boolean;
  /** Error message if not successful */
  error?: string;
  /** Events that were successfully applied (for applyEvents) */
  appliedEvents?: DocumentEvent[];
}

/**
 * Options for the reducer.
 */
export interface ReducerOptions {
  /** Maximum events in undo stack (default: 100) */
  maxUndoStackSize?: number;
  /** Whether to add event to undo stack */
  addToUndoStack?: boolean;
}

// ============================================================================
// MAIN REDUCER
// ============================================================================

/**
 * Apply an event to a DocumentState, producing a new state.
 * This is a pure function - it does not mutate the input state.
 */
export function applyEvent(
  state: DocumentState,
  event: DocumentEvent,
  options: ReducerOptions = {}
): ApplyEventResult {
  const { maxUndoStackSize = DEFAULT_UNDO_STACK_SIZE, addToUndoStack = true } = options;

  try {
    let newState: DocumentState;

    switch (event.type) {
      case 'node_created':
        newState = applyNodeCreated(state, event);
        break;

      case 'node_deleted':
        newState = applyNodeDeleted(state, event);
        break;

      case 'node_moved':
        newState = applyNodeMoved(state, event);
        break;

      case 'text_changed':
        newState = applyTextChanged(state, event);
        break;

      case 'content_replaced':
        newState = applyContentReplaced(state, event);
        break;

      case 'quote_created':
        newState = applyQuoteCreated(state, event);
        break;

      case 'quote_removed':
        newState = applyQuoteRemoved(state, event);
        break;

      case 'quote_metadata_updated':
        newState = applyQuoteMetadataUpdated(state, event);
        break;

      case 'quote_verified':
        newState = applyQuoteVerified(state, event);
        break;

      case 'interjection_added':
        newState = applyInterjectionAdded(state, event);
        break;

      case 'interjection_removed':
        newState = applyInterjectionRemoved(state, event);
        break;

      case 'paragraph_merged':
        newState = applyParagraphMerged(state, event);
        break;

      case 'paragraph_split':
        newState = applyParagraphSplit(state, event);
        break;

      case 'document_metadata_updated':
        newState = applyDocumentMetadataUpdated(state, event);
        break;

      case 'batch':
        newState = applyBatchEvent(state, event, options);
        break;

      case 'undo':
        newState = applyUndoEvent(state, event);
        break;

      case 'redo':
        newState = applyRedoEvent(state, event);
        break;

      // Events that don't need state changes (logged only)
      case 'document_created':
      case 'document_imported':
      case 'nodes_joined':
      case 'node_split':
        newState = {
          ...state,
          version: event.resultingVersion,
          eventLog: [...state.eventLog, event],
          lastModified: event.timestamp,
        };
        break;

      default:
        return {
          state,
          success: false,
          error: `Unknown event type: ${(event as DocumentEvent).type}`,
        };
    }

    // Add event to undo stack if appropriate
    if (addToUndoStack && isUndoableEvent(event)) {
      newState = addToUndoStackImpl(newState, event.id, maxUndoStackSize);
    }

    return { state: newState, success: true };
  } catch (error) {
    return {
      state,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Apply multiple events in sequence.
 */
export function applyEvents(
  state: DocumentState,
  events: DocumentEvent[],
  options: ReducerOptions & { stopOnError?: boolean } = {}
): ApplyEventResult {
  let currentState = state;
  const appliedEvents: DocumentEvent[] = [];
  const { stopOnError = true, ...reducerOptions } = options;

  for (const event of events) {
    const result = applyEvent(currentState, event, reducerOptions);
    if (!result.success) {
      if (stopOnError) {
        return { ...result, appliedEvents };
      }
      // Continue without this event if stopOnError is false
      continue;
    }
    appliedEvents.push(event);
    currentState = result.state;
  }

  return { state: currentState, success: true, appliedEvents };
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function applyNodeCreated(state: DocumentState, event: NodeCreatedEvent): DocumentState {
  const { node, parentId, index } = event;

  // Clone the root with the new node inserted
  const newRoot = insertNodeInTree(state.root, node, parentId, index);

  // Update node index (including all descendants)
  const newNodeIndex = { ...state.nodeIndex };
  const parentPath = parentId ? state.nodeIndex[parentId]?.path ?? [] : [];
  addNodeAndDescendantsToIndex(newNodeIndex, node, parentId, parentPath);

  // Update quote index if it's a quote
  const newQuoteIndex = isQuoteBlockNode(node)
    ? addQuoteToIndex(state.quoteIndex, node)
    : state.quoteIndex;

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    quoteIndex: newQuoteIndex,
    lastModified: event.timestamp,
    redoStack: [], // Clear redo stack on new changes
  };
}

function applyNodeDeleted(state: DocumentState, event: NodeDeletedEvent): DocumentState {
  const { nodeId, parentId } = event;

  // Clone the root with the node removed
  const newRoot = removeNodeFromTree(state.root, nodeId, parentId);

  // Update node index (remove deleted node and descendants)
  const newNodeIndex = { ...state.nodeIndex };
  removeNodeAndDescendantsFromIndex(newNodeIndex, nodeId);

  // Update quote index if it was a quote
  const deletedNode = state.nodeIndex[nodeId]?.node;
  const newQuoteIndex =
    deletedNode && isQuoteBlockNode(deletedNode)
      ? removeQuoteFromIndex(state.quoteIndex, deletedNode)
      : state.quoteIndex;

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    quoteIndex: newQuoteIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyNodeMoved(state: DocumentState, event: NodeMovedEvent): DocumentState {
  const { nodeId, fromParentId, toParentId, toIndex } = event;

  const nodeEntry = state.nodeIndex[nodeId];
  if (!nodeEntry) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  // Remove from old position
  let newRoot = removeNodeFromTree(state.root, nodeId, fromParentId);

  // Insert at new position
  newRoot = insertNodeInTree(newRoot, nodeEntry.node, toParentId, toIndex);

  // Update node index with new parent and path
  const newNodeIndex = { ...state.nodeIndex };
  const newParentPath = toParentId ? state.nodeIndex[toParentId]?.path ?? [] : [];
  newNodeIndex[nodeId] = {
    ...nodeEntry,
    parentId: toParentId,
    path: toParentId ? [...newParentPath, toParentId] : [],
  };

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyTextChanged(state: DocumentState, event: TextChangedEvent): DocumentState {
  const { nodeId, newContent } = event;

  const nodeEntry = state.nodeIndex[nodeId];
  if (!nodeEntry || nodeEntry.node.type !== 'text') {
    throw new Error(`Text node not found: ${nodeId}`);
  }

  const updatedNode: TextNode = {
    ...(nodeEntry.node as TextNode),
    content: newContent,
    version: nodeEntry.node.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, nodeId, updatedNode);

  // Update index
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[nodeId] = { ...nodeEntry, node: updatedNode };

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyContentReplaced(state: DocumentState, event: ContentReplacedEvent): DocumentState {
  const { nodeId, newChildren } = event;

  const nodeEntry = state.nodeIndex[nodeId];
  if (!nodeEntry || !hasChildren(nodeEntry.node)) {
    throw new Error(`Container node not found: ${nodeId}`);
  }

  // Create updated node with new children
  const updatedNode = {
    ...nodeEntry.node,
    children: newChildren,
    version: nodeEntry.node.version + 1,
    updatedAt: event.timestamp,
  } as DocumentNode;

  // Update tree
  const newRoot = updateNodeInTree(state.root, nodeId, updatedNode);

  // Rebuild indexes for this subtree
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[nodeId] = { ...nodeEntry, node: updatedNode };

  // Add new children to index
  const parentPath = nodeEntry.path;
  newChildren.forEach((child) => {
    addNodeAndDescendantsToIndex(newNodeIndex, child, nodeId, [...parentPath, nodeId]);
  });

  // Rebuild quote index
  const newQuoteIndex = rebuildQuoteIndex(newRoot);

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    quoteIndex: newQuoteIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyQuoteCreated(state: DocumentState, event: QuoteCreatedEvent): DocumentState {
  const { quote, parentId, index } = event;

  // Insert quote into tree
  const newRoot = insertNodeInTree(state.root, quote, parentId, index);

  // Update node index (including all descendants)
  const newNodeIndex = { ...state.nodeIndex };
  const parentPath = parentId ? state.nodeIndex[parentId]?.path ?? [] : [];
  addNodeAndDescendantsToIndex(newNodeIndex, quote, parentId, parentPath);

  // Update quote index
  const newQuoteIndex = addQuoteToIndex(state.quoteIndex, quote);

  // Update extracted references
  const newExtracted = {
    ...state.extracted,
    references: [...new Set([...state.extracted.references, quote.metadata.reference.normalizedReference])],
  };

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    quoteIndex: newQuoteIndex,
    extracted: newExtracted,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyQuoteRemoved(state: DocumentState, event: QuoteRemovedEvent): DocumentState {
  const { quoteId, replacementNodes } = event;

  const quoteEntry = state.nodeIndex[quoteId];
  if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
    throw new Error(`Quote not found: ${quoteId}`);
  }

  const parentId = quoteEntry.parentId;
  if (!parentId) {
    throw new Error('Quote has no parent');
  }

  // Find the quote's index in parent before removing
  // We need to look at the actual tree, not the nodeIndex entry (which may be stale)
  let quoteIndex = -1;
  const findQuoteIndex = (node: DocumentNode): boolean => {
    if (node.id === parentId && hasChildren(node)) {
      quoteIndex = node.children.findIndex((c) => c.id === quoteId);
      return true;
    }
    if (hasChildren(node)) {
      return node.children.some(findQuoteIndex);
    }
    return false;
  };
  findQuoteIndex(state.root);

  // Remove quote from tree
  let newRoot = removeNodeFromTree(state.root, quoteId, parentId);

  // Insert replacement nodes at the quote's position
  if (quoteIndex >= 0) {
    replacementNodes.forEach((node, i) => {
      newRoot = insertNodeInTree(newRoot, node, parentId, quoteIndex + i);
    });
  }

  // Update node index
  const newNodeIndex = { ...state.nodeIndex };
  removeNodeAndDescendantsFromIndex(newNodeIndex, quoteId);

  // Add replacement nodes to index
  const parentPath = state.nodeIndex[parentId]?.path ?? [];
  replacementNodes.forEach((node) => {
    addNodeAndDescendantsToIndex(newNodeIndex, node, parentId, [...parentPath, parentId]);
  });
  replacementNodes.forEach((node) => {
    addNodeAndDescendantsToIndex(newNodeIndex, node, parentId, [...parentPath, parentId]);
  });

  // Update quote index
  const newQuoteIndex = removeQuoteFromIndex(state.quoteIndex, quoteEntry.node as QuoteBlockNode);

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    quoteIndex: newQuoteIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyQuoteMetadataUpdated(state: DocumentState, event: QuoteMetadataUpdatedEvent): DocumentState {
  const { quoteId, newMetadata } = event;

  const quoteEntry = state.nodeIndex[quoteId];
  if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
    throw new Error(`Quote not found: ${quoteId}`);
  }

  const quote = quoteEntry.node as QuoteBlockNode;
  const updatedQuote: QuoteBlockNode = {
    ...quote,
    metadata: newMetadata,
    version: quote.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, quoteId, updatedQuote);

  // Update index
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[quoteId] = { ...quoteEntry, node: updatedQuote };

  // Rebuild quote index if reference changed
  const newQuoteIndex = rebuildQuoteIndex(newRoot);

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    quoteIndex: newQuoteIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyQuoteVerified(state: DocumentState, event: QuoteVerifiedEvent): DocumentState {
  const { quoteId, verified, notes } = event;

  const quoteEntry = state.nodeIndex[quoteId];
  if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
    throw new Error(`Quote not found: ${quoteId}`);
  }

  const quote = quoteEntry.node as QuoteBlockNode;
  const updatedQuote: QuoteBlockNode = {
    ...quote,
    metadata: {
      ...quote.metadata,
      userVerified: verified,
      userNotes: notes ?? quote.metadata.userNotes,
    },
    version: quote.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, quoteId, updatedQuote);

  // Update index
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[quoteId] = { ...quoteEntry, node: updatedQuote };

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyInterjectionAdded(state: DocumentState, event: InterjectionAddedEvent): DocumentState {
  const { quoteId, interjection, index } = event;

  const quoteEntry = state.nodeIndex[quoteId];
  if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
    throw new Error(`Quote not found: ${quoteId}`);
  }

  const quote = quoteEntry.node as QuoteBlockNode;
  const newChildren = [...quote.children];
  newChildren.splice(index, 0, interjection);

  const updatedQuote: QuoteBlockNode = {
    ...quote,
    children: newChildren,
    version: quote.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, quoteId, updatedQuote);

  // Update indexes
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[quoteId] = { ...quoteEntry, node: updatedQuote };
  newNodeIndex[interjection.id] = {
    node: interjection,
    parentId: quoteId,
    path: [...quoteEntry.path, quoteId],
  };

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyInterjectionRemoved(state: DocumentState, event: InterjectionRemovedEvent): DocumentState {
  const { quoteId, interjectionId } = event;

  const quoteEntry = state.nodeIndex[quoteId];
  if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
    throw new Error(`Quote not found: ${quoteId}`);
  }

  const quote = quoteEntry.node as QuoteBlockNode;
  const newChildren = quote.children.filter((c) => c.id !== interjectionId);

  const updatedQuote: QuoteBlockNode = {
    ...quote,
    children: newChildren,
    version: quote.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, quoteId, updatedQuote);

  // Update indexes
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[quoteId] = { ...quoteEntry, node: updatedQuote };
  delete newNodeIndex[interjectionId];

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyParagraphMerged(state: DocumentState, event: ParagraphMergedEvent): DocumentState {
  const { targetParagraphId, mergedParagraphId, mergedParagraph } = event;

  const targetEntry = state.nodeIndex[targetParagraphId];
  const mergedEntry = state.nodeIndex[mergedParagraphId];

  if (!targetEntry || !mergedEntry) {
    throw new Error('Paragraph not found');
  }

  const targetPara = targetEntry.node as ParagraphNode;

  // Merge children
  const updatedTarget: ParagraphNode = {
    ...targetPara,
    children: [...targetPara.children, ...mergedParagraph.children],
    version: targetPara.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  let newRoot = updateNodeInTree(state.root, targetParagraphId, updatedTarget);
  newRoot = removeNodeFromTree(newRoot, mergedParagraphId, mergedEntry.parentId!);

  // Update indexes
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[targetParagraphId] = { ...targetEntry, node: updatedTarget };

  // Move merged paragraph's children to target
  mergedParagraph.children.forEach((child) => {
    newNodeIndex[child.id] = {
      node: child,
      parentId: targetParagraphId,
      path: [...targetEntry.path, targetParagraphId],
    };
  });

  delete newNodeIndex[mergedParagraphId];

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyParagraphSplit(state: DocumentState, event: ParagraphSplitEvent): DocumentState {
  const { originalParagraphId, firstParagraph, secondParagraph } = event;

  const originalEntry = state.nodeIndex[originalParagraphId];
  if (!originalEntry) {
    throw new Error('Original paragraph not found');
  }

  const parentId = originalEntry.parentId;
  if (!parentId) {
    throw new Error('Paragraph has no parent');
  }

  // Find original index
  const parentEntry = state.nodeIndex[parentId];
  if (!parentEntry || !hasChildren(parentEntry.node)) {
    throw new Error('Parent not found');
  }

  const originalIndex = parentEntry.node.children.findIndex((c) => c.id === originalParagraphId);

  // Remove original, insert two new paragraphs
  let newRoot = removeNodeFromTree(state.root, originalParagraphId, parentId);
  newRoot = insertNodeInTree(newRoot, firstParagraph, parentId, originalIndex);
  newRoot = insertNodeInTree(newRoot, secondParagraph, parentId, originalIndex + 1);

  // Update indexes
  const newNodeIndex = { ...state.nodeIndex };
  delete newNodeIndex[originalParagraphId];

  const parentPath = originalEntry.path;
  addNodeAndDescendantsToIndex(newNodeIndex, firstParagraph, parentId, parentPath);
  addNodeAndDescendantsToIndex(newNodeIndex, secondParagraph, parentId, parentPath);

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyDocumentMetadataUpdated(state: DocumentState, event: DocumentMetadataUpdatedEvent): DocumentState {
  const { newTitle, newBiblePassage } = event;

  const updatedRoot: DocumentRootNode = {
    ...state.root,
    title: newTitle !== undefined ? newTitle : state.root.title,
    biblePassage: newBiblePassage !== undefined ? newBiblePassage : state.root.biblePassage,
    version: state.root.version + 1,
    updatedAt: event.timestamp,
  };

  // Update index
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[state.root.id] = { ...newNodeIndex[state.root.id]!, node: updatedRoot };

  return {
    ...state,
    version: event.resultingVersion,
    root: updatedRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyBatchEvent(state: DocumentState, event: BatchEvent, options: ReducerOptions): DocumentState {
  // Apply all events in the batch without adding each to undo stack
  const result = applyEvents(state, event.events, { ...options, addToUndoStack: false });
  if (!result.success) {
    throw new Error(result.error);
  }

  // Update with batch event in log and the batch's resulting version
  return {
    ...result.state,
    version: event.resultingVersion,
    eventLog: [...state.eventLog, event],
    lastModified: event.timestamp,
  };
}

function applyUndoEvent(state: DocumentState, event: UndoEvent): DocumentState {
  // Apply the inverse events
  const result = applyEvents(state, event.inverseEvents, { addToUndoStack: false });
  if (!result.success) {
    throw new Error(result.error);
  }

  // Move event from undo to redo stack
  const newUndoStack = state.undoStack.filter((id) => id !== event.undoneEventId);
  const newRedoStack = [...state.redoStack, event.id];

  return {
    ...result.state,
    version: event.resultingVersion,
    eventLog: [...state.eventLog, event],
    undoStack: newUndoStack,
    redoStack: newRedoStack,
    lastModified: event.timestamp,
  };
}

function applyRedoEvent(state: DocumentState, event: RedoEvent): DocumentState {
  // Apply the reapplied events
  const result = applyEvents(state, event.reappliedEvents, { addToUndoStack: false });
  if (!result.success) {
    throw new Error(result.error);
  }

  // Move from redo back to undo stack
  const newRedoStack = state.redoStack.filter((id) => id !== event.redoneUndoEventId);
  const originalEventId = state.eventLog.find((e) => e.type === 'undo' && e.id === event.redoneUndoEventId);
  const newUndoStack = originalEventId
    ? [...state.undoStack, (originalEventId as UndoEvent).undoneEventId]
    : state.undoStack;

  return {
    ...result.state,
    version: event.resultingVersion,
    eventLog: [...state.eventLog, event],
    undoStack: newUndoStack,
    redoStack: newRedoStack,
    lastModified: event.timestamp,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if an event should be added to the undo stack.
 */
function isUndoableEvent(event: DocumentEvent): boolean {
  // These events are user-initiated and undoable
  const undoableTypes = [
    'node_created',
    'node_deleted',
    'node_moved',
    'text_changed',
    'content_replaced',
    'quote_created',
    'quote_removed',
    'quote_metadata_updated',
    'quote_verified',
    'interjection_added',
    'interjection_removed',
    'paragraph_merged',
    'paragraph_split',
    'document_metadata_updated',
    'batch',
  ];

  return undoableTypes.includes(event.type);
}

/**
 * Add event to undo stack with size limit.
 */
function addToUndoStackImpl(state: DocumentState, eventId: string, maxSize: number): DocumentState {
  let newUndoStack = [...state.undoStack, eventId];

  // Trim if over limit
  if (newUndoStack.length > maxSize) {
    newUndoStack = newUndoStack.slice(-maxSize);
  }

  return {
    ...state,
    undoStack: newUndoStack,
  };
}

/**
 * Insert a node into the tree at a specific position.
 */
function insertNodeInTree(
  root: DocumentRootNode,
  node: DocumentNode,
  parentId: NodeId | null,
  index: number
): DocumentRootNode {
  if (parentId === null) {
    // Inserting as top-level child of root
    const newChildren = [...root.children];
    newChildren.splice(index, 0, node);
    return { ...root, children: newChildren };
  }

  // Find the parent and insert the node
  function insertRecursive(current: DocumentNode): DocumentNode {
    if (current.id === parentId && hasChildren(current)) {
      const newChildren = [...current.children];
      newChildren.splice(index, 0, node);
      return { ...current, children: newChildren } as DocumentNode;
    }
    if (hasChildren(current)) {
      return {
        ...current,
        children: current.children.map(insertRecursive),
      } as DocumentNode;
    }
    return current;
  }
  return insertRecursive(root) as DocumentRootNode;
}

/**
 * Remove a node from the tree.
 */
function removeNodeFromTree(root: DocumentRootNode, nodeId: NodeId, parentId: NodeId): DocumentRootNode {
  function removeRecursive(current: DocumentNode): DocumentNode {
    if (current.id === parentId && hasChildren(current)) {
      return { ...current, children: current.children.filter((c) => c.id !== nodeId) } as DocumentNode;
    }
    if (hasChildren(current)) {
      return {
        ...current,
        children: current.children.map(removeRecursive),
      } as DocumentNode;
    }
    return current;
  }
  return removeRecursive(root) as DocumentRootNode;
}

/**
 * Update a node in the tree.
 */
function updateNodeInTree(root: DocumentRootNode, nodeId: NodeId, updatedNode: DocumentNode): DocumentRootNode {
  // Simple replacement - find the node and replace it
  function updateRecursive(node: DocumentNode): DocumentNode {
    if (node.id === nodeId) {
      return updatedNode;
    }
    if (hasChildren(node)) {
      return {
        ...node,
        children: node.children.map(updateRecursive),
      } as DocumentNode;
    }
    return node;
  }
  return updateRecursive(root) as DocumentRootNode;
}

/**
 * Remove a node and all descendants from the index.
 */
function removeNodeAndDescendantsFromIndex(index: NodeIndex, nodeId: NodeId): void {
  const entry = index[nodeId];
  if (!entry) return;

  // Remove descendants first
  if (hasChildren(entry.node)) {
    entry.node.children.forEach((child) => {
      removeNodeAndDescendantsFromIndex(index, child.id);
    });
  }

  delete index[nodeId];
}

/**
 * Add a node and all descendants to the index.
 */
function addNodeAndDescendantsToIndex(
  index: NodeIndex,
  node: DocumentNode,
  parentId: NodeId | null,
  parentPath: NodeId[]
): void {
  const path = parentId ? [...parentPath, parentId] : parentPath;

  index[node.id] = { node, parentId, path };

  if (hasChildren(node)) {
    node.children.forEach((child) => {
      addNodeAndDescendantsToIndex(index, child, node.id, path);
    });
  }
}

/**
 * Add a quote to the quote index.
 */
function addQuoteToIndex(index: QuoteIndex, quote: QuoteBlockNode): QuoteIndex {
  const ref = quote.metadata.reference.normalizedReference;
  const book = quote.metadata.reference.book;

  return {
    byReference: {
      ...index.byReference,
      [ref]: [...(index.byReference[ref] ?? []), quote.id],
    },
    byBook: {
      ...index.byBook,
      [book]: [...(index.byBook[book] ?? []), quote.id],
    },
    all: [...index.all, quote.id],
  };
}

/**
 * Remove a quote from the quote index.
 */
function removeQuoteFromIndex(index: QuoteIndex, quote: QuoteBlockNode): QuoteIndex {
  const ref = quote.metadata.reference.normalizedReference;
  const book = quote.metadata.reference.book;

  return {
    byReference: {
      ...index.byReference,
      [ref]: (index.byReference[ref] ?? []).filter((id) => id !== quote.id),
    },
    byBook: {
      ...index.byBook,
      [book]: (index.byBook[book] ?? []).filter((id) => id !== quote.id),
    },
    all: index.all.filter((id) => id !== quote.id),
  };
}

/**
 * Rebuild the quote index from scratch by traversing the tree.
 */
function rebuildQuoteIndex(root: DocumentRootNode): QuoteIndex {
  const newIndex: QuoteIndex = {
    byReference: {},
    byBook: {},
    all: [],
  };

  const traverse = (node: DocumentNode): void => {
    if (isQuoteBlockNode(node)) {
      const ref = node.metadata.reference.normalizedReference;
      const book = node.metadata.reference.book;

      if (!newIndex.byReference[ref]) {
        newIndex.byReference[ref] = [];
      }
      newIndex.byReference[ref].push(node.id);

      if (!newIndex.byBook[book]) {
        newIndex.byBook[book] = [];
      }
      newIndex.byBook[book].push(node.id);

      newIndex.all.push(node.id);
    }

    if (hasChildren(node)) {
      node.children.forEach(traverse);
    }
  };

  traverse(root);
  return newIndex;
}
