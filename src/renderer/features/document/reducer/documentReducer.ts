/**
 * Document Reducer - Pure function for applying events to DocumentState.
 *
 * This module provides the core state transition logic for the event-sourced
 * document model. Each event type has a corresponding handler that produces
 * a new immutable DocumentState.
 *
 * Key responsibilities:
 * - Apply events to produce new state
 * - Maintain node and passage indexes
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
  PassageNode,
  NodeId,
  NodeIndex,
  PassageIndex,
  DocumentEvent,
  NodeCreatedEvent,
  NodeDeletedEvent,
  NodeMovedEvent,
  TextChangedEvent,
  ContentReplacedEvent,
  PassageCreatedEvent,
  PassageRemovedEvent,
  PassageMetadataUpdatedEvent,
  PassageVerifiedEvent,
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
  isPassageNode,
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

      case 'passage_created':
        newState = applyPassageCreated(state, event);
        break;

      case 'passage_removed':
        newState = applyPassageRemoved(state, event);
        break;

      case 'passage_metadata_updated':
        newState = applyPassageMetadataUpdated(state, event);
        break;

      case 'passage_verified':
        newState = applyPassageVerified(state, event);
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

  // Update passage index if it's a passage
  const newPassageIndex = isPassageNode(node)
    ? addPassageToIndex(state.passageIndex, node)
    : state.passageIndex;

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    passageIndex: newPassageIndex,
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

  // Update passage index if it was a passage
  const deletedNode = state.nodeIndex[nodeId]?.node;
  const newPassageIndex =
    deletedNode && isPassageNode(deletedNode)
      ? removePassageFromIndex(state.passageIndex, deletedNode)
      : state.passageIndex;

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    passageIndex: newPassageIndex,
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

  // Rebuild passage index
  const newPassageIndex = rebuildPassageIndex(newRoot);

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    passageIndex: newPassageIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyPassageCreated(state: DocumentState, event: PassageCreatedEvent): DocumentState {
  const { passage, parentId, index } = event;

  // Insert passage into tree
  const newRoot = insertNodeInTree(state.root, passage, parentId, index);

  // Update node index (including all descendants)
  const newNodeIndex = { ...state.nodeIndex };
  const parentPath = parentId ? state.nodeIndex[parentId]?.path ?? [] : [];
  addNodeAndDescendantsToIndex(newNodeIndex, passage, parentId, parentPath);

  // Update passage index
  const newPassageIndex = addPassageToIndex(state.passageIndex, passage);

  // Update extracted references
  const ref = passage.metadata.reference?.normalizedReference;
  const newExtracted = {
    ...state.extracted,
    references: ref ? [...new Set([...state.extracted.references, ref])] : state.extracted.references,
  };

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    passageIndex: newPassageIndex,
    extracted: newExtracted,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyPassageRemoved(state: DocumentState, event: PassageRemovedEvent): DocumentState {
  const { passageId, replacementNodes } = event;

  const passageEntry = state.nodeIndex[passageId];
  if (!passageEntry || passageEntry.node.type !== 'passage') {
    throw new Error(`Passage not found: ${passageId}`);
  }

  const parentId = passageEntry.parentId;
  if (!parentId) {
    throw new Error('Passage has no parent');
  }

  // Find the passage's index in parent before removing
  // We need to look at the actual tree, not the nodeIndex entry (which may be stale)
  let passageIndex = -1;
  const findPassageIndex = (node: DocumentNode): boolean => {
    if (node.id === parentId && hasChildren(node)) {
      passageIndex = node.children.findIndex((c) => c.id === passageId);
      return true;
    }
    if (hasChildren(node)) {
      return node.children.some(findPassageIndex);
    }
    return false;
  };
  findPassageIndex(state.root);

  // Remove passage from tree
  let newRoot = removeNodeFromTree(state.root, passageId, parentId);

  // Insert replacement nodes at the passage's position
  if (passageIndex >= 0) {
    replacementNodes.forEach((node, i) => {
      newRoot = insertNodeInTree(newRoot, node, parentId, passageIndex + i);
    });
  }

  // Update node index
  const newNodeIndex = { ...state.nodeIndex };
  removeNodeAndDescendantsFromIndex(newNodeIndex, passageId);

  // Add replacement nodes to index
  const parentPath = state.nodeIndex[parentId]?.path ?? [];
  replacementNodes.forEach((node) => {
    addNodeAndDescendantsToIndex(newNodeIndex, node, parentId, [...parentPath, parentId]);
  });
  replacementNodes.forEach((node) => {
    addNodeAndDescendantsToIndex(newNodeIndex, node, parentId, [...parentPath, parentId]);
  });

  // Update passage index
  const newPassageIndex = removePassageFromIndex(state.passageIndex, passageEntry.node as PassageNode);

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    passageIndex: newPassageIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyPassageMetadataUpdated(state: DocumentState, event: PassageMetadataUpdatedEvent): DocumentState {
  const { passageId, newMetadata } = event;

  const passageEntry = state.nodeIndex[passageId];
  if (!passageEntry || passageEntry.node.type !== 'passage') {
    throw new Error(`Passage not found: ${passageId}`);
  }

  const passage = passageEntry.node as PassageNode;
  const updatedPassage: PassageNode = {
    ...passage,
    metadata: newMetadata,
    version: passage.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, passageId, updatedPassage);

  // Update index
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[passageId] = { ...passageEntry, node: updatedPassage };

  // Rebuild passage index if reference changed
  const newPassageIndex = rebuildPassageIndex(newRoot);

  return {
    ...state,
    version: event.resultingVersion,
    root: newRoot,
    eventLog: [...state.eventLog, event],
    nodeIndex: newNodeIndex,
    passageIndex: newPassageIndex,
    lastModified: event.timestamp,
    redoStack: [],
  };
}

function applyPassageVerified(state: DocumentState, event: PassageVerifiedEvent): DocumentState {
  const { passageId, verified, notes } = event;

  const passageEntry = state.nodeIndex[passageId];
  if (!passageEntry || passageEntry.node.type !== 'passage') {
    throw new Error(`Passage not found: ${passageId}`);
  }

  const passage = passageEntry.node as PassageNode;
  const updatedPassage: PassageNode = {
    ...passage,
    metadata: {
      ...passage.metadata,
      userVerified: verified,
      userNotes: notes ?? passage.metadata.userNotes,
    },
    version: passage.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, passageId, updatedPassage);

  // Update index
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[passageId] = { ...passageEntry, node: updatedPassage };

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
  const { passageId, interjection, index } = event;

  const passageEntry = state.nodeIndex[passageId];
  if (!passageEntry || passageEntry.node.type !== 'passage') {
    throw new Error(`Passage not found: ${passageId}`);
  }

  const passage = passageEntry.node as PassageNode;
  const newChildren = [...passage.children];
  newChildren.splice(index, 0, interjection);

  const updatedPassage: PassageNode = {
    ...passage,
    children: newChildren,
    version: passage.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, passageId, updatedPassage);

  // Update indexes
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[passageId] = { ...passageEntry, node: updatedPassage };
  newNodeIndex[interjection.id] = {
    node: interjection,
    parentId: passageId,
    path: [...passageEntry.path, passageId],
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
  const { passageId, interjectionId } = event;

  const passageEntry = state.nodeIndex[passageId];
  if (!passageEntry || passageEntry.node.type !== 'passage') {
    throw new Error(`Passage not found: ${passageId}`);
  }

  const passage = passageEntry.node as PassageNode;
  const newChildren = passage.children.filter((c) => c.id !== interjectionId);

  const updatedPassage: PassageNode = {
    ...passage,
    children: newChildren,
    version: passage.version + 1,
    updatedAt: event.timestamp,
  };

  // Update tree
  const newRoot = updateNodeInTree(state.root, passageId, updatedPassage);

  // Update indexes
  const newNodeIndex = { ...state.nodeIndex };
  newNodeIndex[passageId] = { ...passageEntry, node: updatedPassage };
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
  const { newTitle, newBiblePassage, newSpeaker, newTags } = event;

  const updatedRoot: DocumentRootNode = {
    ...state.root,
    title: newTitle !== undefined ? newTitle : state.root.title,
    biblePassage: newBiblePassage !== undefined ? newBiblePassage : state.root.biblePassage,
    speaker: newSpeaker !== undefined ? newSpeaker : state.root.speaker,
    tags: newTags !== undefined ? newTags : state.root.tags,
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
    'passage_created',
    'passage_removed',
    'passage_metadata_updated',
    'passage_verified',
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
 * Add a passage to the passage index.
 */
function addPassageToIndex(index: PassageIndex, passage: PassageNode): PassageIndex {
  const ref = passage.metadata.reference?.normalizedReference ?? 'Unknown';
  const book = passage.metadata.reference?.book ?? 'Unknown';

  return {
    byReference: {
      ...index.byReference,
      [ref]: [...(index.byReference[ref] ?? []), passage.id],
    },
    byBook: {
      ...index.byBook,
      [book]: [...(index.byBook[book] ?? []), passage.id],
    },
    all: [...index.all, passage.id],
  };
}

/**
 * Remove a passage from the passage index.
 */
function removePassageFromIndex(index: PassageIndex, passage: PassageNode): PassageIndex {
  const ref = passage.metadata.reference?.normalizedReference ?? 'Unknown';
  const book = passage.metadata.reference?.book ?? 'Unknown';

  return {
    byReference: {
      ...index.byReference,
      [ref]: (index.byReference[ref] ?? []).filter((id) => id !== passage.id),
    },
    byBook: {
      ...index.byBook,
      [book]: (index.byBook[book] ?? []).filter((id) => id !== passage.id),
    },
    all: index.all.filter((id) => id !== passage.id),
  };
}

/**
 * Rebuild the passage index from scratch by traversing the tree.
 */
function rebuildPassageIndex(root: DocumentRootNode): PassageIndex {
  const newIndex: PassageIndex = {
    byReference: {},
    byBook: {},
    all: [],
  };

  const traverse = (node: DocumentNode): void => {
    if (isPassageNode(node)) {
      const ref = node.metadata.reference?.normalizedReference ?? 'Unknown';
      const book = node.metadata.reference?.book ?? 'Unknown';

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
