/**
 * DocumentMutator - Mutable document state manager with event sourcing.
 *
 * This class extends DocumentManager with mutation methods. It:
 * - Generates events for all mutations
 * - Applies events through the reducer
 * - Maintains the current state
 * - Provides undo/redo functionality
 *
 * The DocumentMutator is the primary interface for making changes to documents.
 * All mutations go through the event system for proper tracking and undo.
 */

import type {
  DocumentState,
  DocumentNode,
  DocumentRootNode,
  ParagraphNode,
  TextNode,
  QuoteBlockNode,
  InterjectionNode,
  NodeId,
  QuoteMetadata,
  DocumentEvent,
  UndoEvent,
} from '../../../shared/documentModel';

import { hasChildren, isTextNode } from '../../../shared/documentModel';

import { DocumentManager, type DocumentStatistics } from './DocumentManager';

import {
  createNodeId,
  createTimestamp,
  createNodeCreatedEvent,
  createNodeDeletedEvent,
  createTextChangedEvent,
  createQuoteCreatedEvent,
  createQuoteRemovedEvent,
  createQuoteMetadataUpdatedEvent,
  createQuoteVerifiedEvent,
  createInterjectionAddedEvent,
  createInterjectionRemovedEvent,
  createParagraphSplitEvent,
  createParagraphMergedEvent,
  createDocumentMetadataUpdatedEvent,
  createBatchEvent,
  createUndoEvent,
  createRedoEvent,
  generateInverseEvents,
  createTextNode,
  createParagraphNode,
  type EventSource,
} from './events';

import { applyEvent } from './reducer';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from a mutation operation.
 */
export interface MutationResult {
  /** Whether the mutation was successful */
  success: boolean;
  /** The applied event(s) */
  events: DocumentEvent[];
  /** Error message if not successful */
  error?: string;
  /** The new state after mutation */
  state: DocumentState;
}

/**
 * Options for creating a quote.
 */
export interface CreateQuoteOptions {
  /** The reference text (e.g., "John 3:16") */
  reference: string;
  /** Book name */
  book: string;
  /** Chapter number */
  chapter: number;
  /** Start verse */
  verseStart: number;
  /** End verse (optional) */
  verseEnd?: number;
  /** The quote text content */
  content: string;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Translation */
  translation?: string;
  /** Parent node ID to insert into */
  parentId: NodeId;
  /** Index in parent */
  index: number;
  /** Node IDs being replaced by this quote */
  replacedNodeIds?: NodeId[];
}

/**
 * Callback for state changes.
 */
export type StateChangeCallback = (state: DocumentState, event: DocumentEvent) => void;

// ============================================================================
// DOCUMENT MUTATOR CLASS
// ============================================================================

/**
 * DocumentMutator - Provides mutation methods for DocumentState.
 */
export class DocumentMutator {
  private state: DocumentState;
  private callbacks: StateChangeCallback[] = [];

  /**
   * Create a new DocumentMutator.
   */
  constructor(initialState: DocumentState) {
    this.state = initialState;
  }

  // ============================================================================
  // STATE ACCESS (delegated to internal manager)
  // ============================================================================

  /**
   * Get the current DocumentState.
   */
  getState(): DocumentState {
    return this.state;
  }

  /**
   * Get a DocumentManager for read operations on current state.
   */
  getManager(): DocumentManager {
    return new DocumentManager(this.state);
  }

  /**
   * Get a node by ID.
   */
  getNodeById(nodeId: NodeId): DocumentNode | undefined {
    return this.state.nodeIndex[nodeId]?.node;
  }

  /**
   * Get the document root.
   */
  getRoot(): DocumentRootNode {
    return this.state.root;
  }

  /**
   * Get document version.
   */
  getVersion(): number {
    return this.state.version;
  }

  /**
   * Get document statistics.
   */
  getStatistics(): DocumentStatistics {
    return this.getManager().getStatistics();
  }

  // ============================================================================
  // SUBSCRIPTION
  // ============================================================================

  /**
   * Subscribe to state changes.
   */
  subscribe(callback: StateChangeCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Notify subscribers of state change.
   */
  private notifySubscribers(event: DocumentEvent): void {
    this.callbacks.forEach((cb) => cb(this.state, event));
  }

  // ============================================================================
  // INTERNAL: EVENT APPLICATION
  // ============================================================================

  /**
   * Apply an event and update state.
   */
  private applyAndNotify(event: DocumentEvent): MutationResult {
    const result = applyEvent(this.state, event);

    if (result.success) {
      this.state = result.state;
      this.notifySubscribers(event);
    }

    return {
      success: result.success,
      events: result.success ? [event] : [],
      error: result.error,
      state: this.state,
    };
  }

  // ============================================================================
  // TEXT MUTATIONS
  // ============================================================================

  /**
   * Update text content of a text node.
   */
  updateText(
    nodeId: NodeId,
    newContent: string,
    source: EventSource = 'user'
  ): MutationResult {
    const nodeEntry = this.state.nodeIndex[nodeId];
    if (!nodeEntry || nodeEntry.node.type !== 'text') {
      return {
        success: false,
        events: [],
        error: `Text node not found: ${nodeId}`,
        state: this.state,
      };
    }

    const textNode = nodeEntry.node as TextNode;
    const previousContent = textNode.content;

    // Calculate diff (simplified - could be more sophisticated)
    const event = createTextChangedEvent(
      nodeId,
      previousContent,
      newContent,
      0,
      previousContent.length,
      newContent,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Insert text at a specific position in a text node.
   */
  insertText(
    nodeId: NodeId,
    offset: number,
    text: string,
    source: EventSource = 'user'
  ): MutationResult {
    const nodeEntry = this.state.nodeIndex[nodeId];
    if (!nodeEntry || nodeEntry.node.type !== 'text') {
      return {
        success: false,
        events: [],
        error: `Text node not found: ${nodeId}`,
        state: this.state,
      };
    }

    const textNode = nodeEntry.node as TextNode;
    const previousContent = textNode.content;
    const newContent = previousContent.slice(0, offset) + text + previousContent.slice(offset);

    const event = createTextChangedEvent(
      nodeId,
      previousContent,
      newContent,
      offset,
      0,
      text,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Delete text from a text node.
   */
  deleteText(
    nodeId: NodeId,
    offset: number,
    length: number,
    source: EventSource = 'user'
  ): MutationResult {
    const nodeEntry = this.state.nodeIndex[nodeId];
    if (!nodeEntry || nodeEntry.node.type !== 'text') {
      return {
        success: false,
        events: [],
        error: `Text node not found: ${nodeId}`,
        state: this.state,
      };
    }

    const textNode = nodeEntry.node as TextNode;
    const previousContent = textNode.content;
    const newContent = previousContent.slice(0, offset) + previousContent.slice(offset + length);

    const event = createTextChangedEvent(
      nodeId,
      previousContent,
      newContent,
      offset,
      length,
      '',
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  // ============================================================================
  // NODE MUTATIONS
  // ============================================================================

  /**
   * Create and insert a new paragraph.
   */
  createParagraph(
    content: string,
    parentId: NodeId,
    index: number,
    source: EventSource = 'user'
  ): MutationResult {
    const textNode = createTextNode(content);
    const paragraph = createParagraphNode([textNode]);

    const event = createNodeCreatedEvent(
      paragraph,
      parentId,
      index,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Delete a node.
   */
  deleteNode(nodeId: NodeId, source: EventSource = 'user'): MutationResult {
    const nodeEntry = this.state.nodeIndex[nodeId];
    if (!nodeEntry) {
      return {
        success: false,
        events: [],
        error: `Node not found: ${nodeId}`,
        state: this.state,
      };
    }

    if (!nodeEntry.parentId) {
      return {
        success: false,
        events: [],
        error: 'Cannot delete root node',
        state: this.state,
      };
    }

    // Find index in parent
    const parentEntry = this.state.nodeIndex[nodeEntry.parentId];
    if (!parentEntry || !hasChildren(parentEntry.node)) {
      return {
        success: false,
        events: [],
        error: 'Parent not found or has no children',
        state: this.state,
      };
    }

    const index = parentEntry.node.children.findIndex((c) => c.id === nodeId);

    const event = createNodeDeletedEvent(
      nodeId,
      nodeEntry.node,
      nodeEntry.parentId,
      index,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  // ============================================================================
  // QUOTE MUTATIONS
  // ============================================================================

  /**
   * Create a new quote block.
   */
  createQuote(options: CreateQuoteOptions, source: EventSource = 'user'): MutationResult {
    const {
      reference,
      book,
      chapter,
      verseStart,
      verseEnd,
      content,
      confidence = 0.85,
      translation = 'KJV',
      parentId,
      index,
      replacedNodeIds = [],
    } = options;

    const now = createTimestamp();
    const quoteId = createNodeId();
    const textNodeId = createNodeId();

    const textNode: TextNode = {
      id: textNodeId,
      type: 'text',
      version: 1,
      updatedAt: now,
      content,
    };

    const quote: QuoteBlockNode = {
      id: quoteId,
      type: 'quote_block',
      version: 1,
      updatedAt: now,
      metadata: {
        reference: {
          book,
          chapter,
          verseStart,
          verseEnd: verseEnd ?? null,
          originalText: reference,
          normalizedReference: reference,
        },
        detection: {
          confidence,
          confidenceLevel: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
          translation,
          translationAutoDetected: false,
          verseText: content,
          isPartialMatch: false,
        },
        interjections: [],
        userVerified: false,
      },
      children: [textNode],
    };

    const event = createQuoteCreatedEvent(
      quote,
      parentId,
      index,
      replacedNodeIds,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Remove a quote block.
   */
  removeQuote(quoteId: NodeId, source: EventSource = 'user'): MutationResult {
    const quoteEntry = this.state.nodeIndex[quoteId];
    if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
      return {
        success: false,
        events: [],
        error: `Quote not found: ${quoteId}`,
        state: this.state,
      };
    }

    const quote = quoteEntry.node as QuoteBlockNode;

    // Convert quote content back to regular paragraphs
    const replacementNodes: DocumentNode[] = quote.children
      .filter(isTextNode)
      .map((textNode) => createParagraphNode([{ ...textNode, id: createNodeId() }]));

    const event = createQuoteRemovedEvent(
      quoteId,
      quote,
      replacementNodes,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Update quote metadata.
   */
  updateQuoteMetadata(
    quoteId: NodeId,
    updates: Partial<QuoteMetadata>,
    source: EventSource = 'user'
  ): MutationResult {
    const quoteEntry = this.state.nodeIndex[quoteId];
    if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
      return {
        success: false,
        events: [],
        error: `Quote not found: ${quoteId}`,
        state: this.state,
      };
    }

    const quote = quoteEntry.node as QuoteBlockNode;
    const previousMetadata = quote.metadata;

    const newMetadata: QuoteMetadata = {
      ...previousMetadata,
      ...updates,
      reference: updates.reference
        ? { ...previousMetadata.reference, ...updates.reference }
        : previousMetadata.reference,
      detection: updates.detection
        ? { ...previousMetadata.detection, ...updates.detection }
        : previousMetadata.detection,
    };

    const changedFields = (Object.keys(updates) as (keyof QuoteMetadata)[]).filter(
      (key) => updates[key] !== undefined
    );

    const event = createQuoteMetadataUpdatedEvent(
      quoteId,
      previousMetadata,
      newMetadata,
      changedFields,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Verify or unverify a quote.
   */
  verifyQuote(
    quoteId: NodeId,
    verified: boolean,
    notes?: string,
    source: EventSource = 'user'
  ): MutationResult {
    const quoteEntry = this.state.nodeIndex[quoteId];
    if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
      return {
        success: false,
        events: [],
        error: `Quote not found: ${quoteId}`,
        state: this.state,
      };
    }

    const event = createQuoteVerifiedEvent(
      quoteId,
      verified,
      notes,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  // ============================================================================
  // INTERJECTION MUTATIONS
  // ============================================================================

  /**
   * Add an interjection to a quote.
   */
  addInterjection(
    quoteId: NodeId,
    content: string,
    index: number,
    source: EventSource = 'user'
  ): MutationResult {
    const quoteEntry = this.state.nodeIndex[quoteId];
    if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
      return {
        success: false,
        events: [],
        error: `Quote not found: ${quoteId}`,
        state: this.state,
      };
    }

    const interjectionId = createNodeId();
    const interjection: InterjectionNode = {
      id: interjectionId,
      type: 'interjection',
      version: 1,
      updatedAt: createTimestamp(),
      content,
      metadataId: interjectionId,
    };

    const event = createInterjectionAddedEvent(
      quoteId,
      interjection,
      index,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Remove an interjection from a quote.
   */
  removeInterjection(
    quoteId: NodeId,
    interjectionId: NodeId,
    source: EventSource = 'user'
  ): MutationResult {
    const quoteEntry = this.state.nodeIndex[quoteId];
    if (!quoteEntry || quoteEntry.node.type !== 'quote_block') {
      return {
        success: false,
        events: [],
        error: `Quote not found: ${quoteId}`,
        state: this.state,
      };
    }

    const quote = quoteEntry.node as QuoteBlockNode;
    const interjectionIndex = quote.children.findIndex((c) => c.id === interjectionId);

    if (interjectionIndex === -1) {
      return {
        success: false,
        events: [],
        error: `Interjection not found: ${interjectionId}`,
        state: this.state,
      };
    }

    const interjection = quote.children[interjectionIndex] as InterjectionNode;

    const event = createInterjectionRemovedEvent(
      quoteId,
      interjectionId,
      interjection,
      interjectionIndex,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  // ============================================================================
  // PARAGRAPH MUTATIONS
  // ============================================================================

  /**
   * Split a paragraph at a character offset.
   */
  splitParagraph(
    paragraphId: NodeId,
    offset: number,
    source: EventSource = 'user'
  ): MutationResult {
    const paraEntry = this.state.nodeIndex[paragraphId];
    if (!paraEntry || paraEntry.node.type !== 'paragraph') {
      return {
        success: false,
        events: [],
        error: `Paragraph not found: ${paragraphId}`,
        state: this.state,
      };
    }

    const originalPara = paraEntry.node as ParagraphNode;

    // Simple split: assumes single text child for now
    const textContent = this.extractParagraphText(originalPara);
    const firstContent = textContent.slice(0, offset);
    const secondContent = textContent.slice(offset);

    const firstPara: ParagraphNode = {
      id: createNodeId(),
      type: 'paragraph',
      version: 1,
      updatedAt: createTimestamp(),
      children: [createTextNode(firstContent)],
    };

    const secondPara: ParagraphNode = {
      id: createNodeId(),
      type: 'paragraph',
      version: 1,
      updatedAt: createTimestamp(),
      children: [createTextNode(secondContent)],
    };

    const event = createParagraphSplitEvent(
      paragraphId,
      originalPara,
      firstPara,
      secondPara,
      offset,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Merge two paragraphs.
   */
  mergeParagraphs(
    targetParagraphId: NodeId,
    mergedParagraphId: NodeId,
    source: EventSource = 'user'
  ): MutationResult {
    const targetEntry = this.state.nodeIndex[targetParagraphId];
    const mergedEntry = this.state.nodeIndex[mergedParagraphId];

    if (!targetEntry || targetEntry.node.type !== 'paragraph') {
      return {
        success: false,
        events: [],
        error: `Target paragraph not found: ${targetParagraphId}`,
        state: this.state,
      };
    }

    if (!mergedEntry || mergedEntry.node.type !== 'paragraph') {
      return {
        success: false,
        events: [],
        error: `Merged paragraph not found: ${mergedParagraphId}`,
        state: this.state,
      };
    }

    const event = createParagraphMergedEvent(
      targetParagraphId,
      mergedParagraphId,
      mergedEntry.node as ParagraphNode,
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  // ============================================================================
  // DOCUMENT METADATA
  // ============================================================================

  /**
   * Update document title.
   */
  updateTitle(newTitle: string, source: EventSource = 'user'): MutationResult {
    const event = createDocumentMetadataUpdatedEvent(
      {
        previousTitle: this.state.root.title,
        newTitle,
      },
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  /**
   * Update document Bible passage.
   */
  updateBiblePassage(newBiblePassage: string, source: EventSource = 'user'): MutationResult {
    const event = createDocumentMetadataUpdatedEvent(
      {
        previousBiblePassage: this.state.root.biblePassage,
        newBiblePassage,
      },
      this.state.version + 1,
      source
    );

    return this.applyAndNotify(event);
  }

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  /**
   * Apply multiple mutations as a batch (atomic operation).
   */
  batch(
    description: string,
    mutations: (mutator: DocumentMutator) => void,
    source: EventSource = 'user'
  ): MutationResult {
    // Create a temporary mutator to collect events
    const tempMutator = new DocumentMutator(this.state);
    const collectedEvents: DocumentEvent[] = [];

    // Capture events from the temp mutator
    tempMutator.subscribe((_, event) => {
      collectedEvents.push(event);
    });

    // Run the mutations
    mutations(tempMutator);

    if (collectedEvents.length === 0) {
      return {
        success: true,
        events: [],
        state: this.state,
      };
    }

    // Create batch event
    const batchEvent = createBatchEvent(
      collectedEvents,
      description,
      this.state.version + collectedEvents.length,
      source
    );

    return this.applyAndNotify(batchEvent);
  }

  // ============================================================================
  // UNDO/REDO
  // ============================================================================

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    return this.state.undoStack.length > 0;
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    return this.state.redoStack.length > 0;
  }

  /**
   * Undo the last operation.
   */
  undo(): MutationResult {
    if (!this.canUndo()) {
      return {
        success: false,
        events: [],
        error: 'Nothing to undo',
        state: this.state,
      };
    }

    const lastEventId = this.state.undoStack[this.state.undoStack.length - 1]!;
    const lastEvent = this.state.eventLog.find((e) => e.id === lastEventId);

    if (!lastEvent) {
      return {
        success: false,
        events: [],
        error: 'Event not found in log',
        state: this.state,
      };
    }

    // Generate inverse events
    const inverseEvents = generateInverseEvents(lastEvent, this.state.version);

    const undoEvent = createUndoEvent(
      lastEventId,
      inverseEvents,
      this.state.version + 1,
      'user'
    );

    return this.applyAndNotify(undoEvent);
  }

  /**
   * Redo the last undone operation.
   */
  redo(): MutationResult {
    if (!this.canRedo()) {
      return {
        success: false,
        events: [],
        error: 'Nothing to redo',
        state: this.state,
      };
    }

    const lastUndoEventId = this.state.redoStack[this.state.redoStack.length - 1]!;
    const lastUndoEvent = this.state.eventLog.find((e) => e.id === lastUndoEventId) as UndoEvent | undefined;

    if (!lastUndoEvent || lastUndoEvent.type !== 'undo') {
      return {
        success: false,
        events: [],
        error: 'Undo event not found',
        state: this.state,
      };
    }

    // Find the original event that was undone
    const originalEvent = this.state.eventLog.find((e) => e.id === lastUndoEvent.undoneEventId);

    if (!originalEvent) {
      return {
        success: false,
        events: [],
        error: 'Original event not found',
        state: this.state,
      };
    }

    const redoEvent = createRedoEvent(
      lastUndoEventId,
      [originalEvent],
      this.state.version + 1,
      'user'
    );

    return this.applyAndNotify(redoEvent);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Extract text content from a paragraph.
   */
  private extractParagraphText(para: ParagraphNode): string {
    return para.children
      .filter(isTextNode)
      .map((t) => t.content)
      .join('');
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a DocumentMutator from a DocumentState.
 */
export function createDocumentMutator(state: DocumentState): DocumentMutator {
  return new DocumentMutator(state);
}

export default DocumentMutator;
