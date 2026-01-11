/**
 * Events module - Event factory and utilities for document mutations.
 */

export {
  // UUID generation
  createEventId,
  createNodeId,
  createTimestamp,
  // Node lifecycle events
  createNodeCreatedEvent,
  createNodeDeletedEvent,
  createNodeMovedEvent,
  // Content events
  createTextChangedEvent,
  createContentReplacedEvent,
  // Passage-specific events (Bible passages)
  createPassageCreatedEvent,
  createPassageRemovedEvent,
  createPassageMetadataUpdatedEvent,
  createPassageVerifiedEvent,
  createInterjectionAddedEvent,
  createInterjectionRemovedEvent,
  createInterjectionBoundaryChangedEvent,
  createPassageBoundaryChangedEvent,
  createParagraphsMergedForPassageEvent,
  // Structure events
  createNodesJoinedEvent,
  createNodeSplitEvent,
  createParagraphMergedEvent,
  createParagraphSplitEvent,
  // Document-level events
  createDocumentCreatedEvent,
  createDocumentMetadataUpdatedEvent,
  // Batch/Undo events
  createBatchEvent,
  createUndoEvent,
  createRedoEvent,
  // Inverse event generation
  generateInverseEvents,
  // Node helpers
  createTextNode,
  createParagraphNode,
  // Document state helpers
  createDocumentRootNode,
  createDocumentState,
} from './eventFactory';

export type { EventSource } from './eventFactory';
