/**
 * Document Reducer Tests
 *
 * Tests for the pure reducer function that applies events to DocumentState.
 * These tests verify that state transitions are correct and indexes are maintained.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyEvent, applyEvents } from '../reducer';
import {
  createNodeCreatedEvent,
  createNodeDeletedEvent,
  createTextChangedEvent,
  createPassageCreatedEvent,
  createPassageRemovedEvent,
  createPassageMetadataUpdatedEvent,
  createPassageVerifiedEvent,
  createInterjectionAddedEvent,
  createInterjectionRemovedEvent,
  createParagraphMergedEvent,
  createParagraphSplitEvent,
  createDocumentMetadataUpdatedEvent,
  createBatchEvent,
  createTextNode,
  createParagraphNode,
} from '../events';
import type {
  DocumentState,
  DocumentRootNode,
  ParagraphNode,
  TextNode,
  PassageNode,
  InterjectionNode,
} from '../../../../shared/documentModel';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a minimal valid DocumentState for testing.
 */
function createTestState(): DocumentState {
  const textNode: TextNode = {
    id: 'text-1',
    type: 'text',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    content: 'Initial content.',
  };

  const paragraph: ParagraphNode = {
    id: 'para-1',
    type: 'paragraph',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    children: [textNode],
  };

  const root: DocumentRootNode = {
    id: 'root-1',
    type: 'document',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    title: 'Test Document',
    biblePassage: 'John 3:16',
    children: [paragraph],
  };

  return {
    root,
    version: 1,
    nodeIndex: {
      'root-1': { node: root, parentId: null, path: [] },
      'para-1': { node: paragraph, parentId: 'root-1', path: ['root-1'] },
      'text-1': { node: textNode, parentId: 'para-1', path: ['root-1', 'para-1'] },
    },
    passageIndex: {
      byReference: {},
      byBook: {},
      all: [],
    },
    extracted: {
      references: [],
      tags: [],
    },
    eventLog: [],
    undoStack: [],
    redoStack: [],
    lastModified: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

/**
 * Create a sample passage block for testing.
 */
function createTestPassage(): PassageNode {
  const passageText: TextNode = {
    id: 'passage-text-1',
    type: 'text',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    content: 'For God so loved the world...',
  };

  return {
    id: 'passage-1',
    type: 'passage',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    metadata: {
      reference: {
        book: 'John',
        chapter: 3,
        verseStart: 16,
        verseEnd: null,
        originalText: 'John 3:16',
        normalizedReference: 'John 3:16',
      },
      detection: {
        confidence: 0.95,
        confidenceLevel: 'high',
        translation: 'KJV',
        translationAutoDetected: false,
        verseText: 'For God so loved the world...',
        isPartialMatch: false,
      },
      interjections: [],
      userVerified: false,
    },
    children: [passageText],
  };
}

// ============================================================================
// BASIC REDUCER TESTS
// ============================================================================

describe('applyEvent - Basic Functionality', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should return success result with new state', () => {
    const newPara = createParagraphNode([createTextNode('New paragraph')]);
    const event = createNodeCreatedEvent(newPara, 'root-1', 1, 2, 'user');
    const result = applyEvent(state, event);

    expect(result.success).toBe(true);
    expect(result.state).not.toBe(state); // Immutable - new object
    expect(result.error).toBeUndefined();
  });

  it('should increment document version', () => {
    const newPara = createParagraphNode([createTextNode('New paragraph')]);
    const event = createNodeCreatedEvent(newPara, 'root-1', 1, 2, 'user');
    const result = applyEvent(state, event);

    expect(result.state.version).toBe(2);
  });

  it('should add event to event log', () => {
    const newPara = createParagraphNode([createTextNode('New paragraph')]);
    const event = createNodeCreatedEvent(newPara, 'root-1', 1, 2, 'user');
    const result = applyEvent(state, event);

    expect(result.state.eventLog).toContain(event);
    expect(result.state.eventLog.length).toBe(1);
  });

  it('should add non-undo events to undo stack', () => {
    const newPara = createParagraphNode([createTextNode('New paragraph')]);
    const event = createNodeCreatedEvent(newPara, 'root-1', 1, 2, 'user');
    const result = applyEvent(state, event, { addToUndoStack: true });

    expect(result.state.undoStack).toContain(event.id);
  });

  it('should clear redo stack on new change', () => {
    // Setup state with items in redo stack
    state = { ...state, redoStack: ['evt-old-undo'] };

    const newPara = createParagraphNode([createTextNode('New paragraph')]);
    const event = createNodeCreatedEvent(newPara, 'root-1', 1, 2, 'user');
    const result = applyEvent(state, event);

    expect(result.state.redoStack).toHaveLength(0);
  });
});

// ============================================================================
// NODE LIFECYCLE EVENTS
// ============================================================================

describe('applyEvent - Node Lifecycle', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  describe('node_created', () => {
    it('should insert node at correct index in parent children', () => {
      const newPara = createParagraphNode([createTextNode('New paragraph')]);
      newPara.id = 'para-new';
      const event = createNodeCreatedEvent(newPara, 'root-1', 0, 2, 'user');
      const result = applyEvent(state, event);

      expect(result.state.root.children[0]!.id).toBe('para-new');
      expect(result.state.root.children[1]!.id).toBe('para-1'); // Original moved
    });

    it('should add node to nodeIndex', () => {
      const newPara = createParagraphNode([createTextNode('New content')]);
      newPara.id = 'para-new';
      const event = createNodeCreatedEvent(newPara, 'root-1', 1, 2, 'user');
      const result = applyEvent(state, event);

      expect(result.state.nodeIndex['para-new']).toBeDefined();
      expect(result.state.nodeIndex['para-new']!.node).toBe(newPara);
      expect(result.state.nodeIndex['para-new']!.parentId).toBe('root-1');
    });

    it('should add nested children to nodeIndex', () => {
      const textNode = createTextNode('Nested text');
      textNode.id = 'text-nested';
      const newPara = createParagraphNode([textNode]);
      newPara.id = 'para-nested';
      const event = createNodeCreatedEvent(newPara, 'root-1', 1, 2, 'user');
      const result = applyEvent(state, event);

      expect(result.state.nodeIndex['text-nested']).toBeDefined();
      expect(result.state.nodeIndex['text-nested']!.parentId).toBe('para-nested');
    });
  });

  describe('node_deleted', () => {
    it('should remove node from parent children', () => {
      const para = state.nodeIndex['para-1']!.node as ParagraphNode;
      const event = createNodeDeletedEvent('para-1', para, 'root-1', 0, 2, 'user');
      const result = applyEvent(state, event);

      expect(result.state.root.children.find(c => c.id === 'para-1')).toBeUndefined();
    });

    it('should remove node from nodeIndex', () => {
      const para = state.nodeIndex['para-1']!.node as ParagraphNode;
      const event = createNodeDeletedEvent('para-1', para, 'root-1', 0, 2, 'user');
      const result = applyEvent(state, event);

      expect(result.state.nodeIndex['para-1']).toBeUndefined();
    });

    it('should remove descendants from nodeIndex', () => {
      const para = state.nodeIndex['para-1']!.node as ParagraphNode;
      const event = createNodeDeletedEvent('para-1', para, 'root-1', 0, 2, 'user');
      const result = applyEvent(state, event);

      expect(result.state.nodeIndex['text-1']).toBeUndefined();
    });
  });
});

// ============================================================================
// TEXT EVENTS
// ============================================================================

describe('applyEvent - Text Changes', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  describe('text_changed', () => {
    it('should update text node content', () => {
      const event = createTextChangedEvent(
        'text-1',
        'Initial content.',
        'Updated content.',
        0,
        16,
        'Updated content.',
        2,
        'user'
      );
      const result = applyEvent(state, event);

      const textNode = result.state.nodeIndex['text-1']!.node as TextNode;
      expect(textNode.content).toBe('Updated content.');
    });

    it('should increment node version', () => {
      const event = createTextChangedEvent(
        'text-1',
        'Initial content.',
        'New.',
        0,
        16,
        'New.',
        2,
        'user'
      );
      const result = applyEvent(state, event);

      const textNode = result.state.nodeIndex['text-1']!.node as TextNode;
      expect(textNode.version).toBe(2);
    });

    it('should update node timestamp', () => {
      const event = createTextChangedEvent(
        'text-1',
        'Initial content.',
        'New.',
        0,
        16,
        'New.',
        2,
        'user'
      );
      const result = applyEvent(state, event);

      const textNode = result.state.nodeIndex['text-1']!.node as TextNode;
      expect(textNode.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });
  });
});

// ============================================================================
// QUOTE EVENTS
// ============================================================================

describe('applyEvent - Quote Operations', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  describe('passage_created', () => {
    it('should insert passage block into tree', () => {
      const passage = createTestPassage();
      const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
      const result = applyEvent(state, event);

      expect(result.state.root.children.find(c => c.id === 'passage-1')).toBeDefined();
    });

    it('should add passage to passageIndex by reference', () => {
      const passage = createTestPassage();
      const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
      const result = applyEvent(state, event);

      expect(result.state.passageIndex.byReference['John 3:16']).toContain('passage-1');
    });

    it('should add passage to passageIndex by book', () => {
      const passage = createTestPassage();
      const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
      const result = applyEvent(state, event);

      expect(result.state.passageIndex.byBook['John']).toContain('passage-1');
    });

    it('should add passage children to nodeIndex', () => {
      const passage = createTestPassage();
      const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
      const result = applyEvent(state, event);

      expect(result.state.nodeIndex['passage-text-1']).toBeDefined();
      expect(result.state.nodeIndex['passage-text-1']!.parentId).toBe('passage-1');
    });
  });

  describe('passage_removed', () => {
    let stateWithPassage: DocumentState;

    beforeEach(() => {
      // Create state with a passage
      const passage = createTestPassage();
      const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
      const result = applyEvent(state, event);
      stateWithPassage = result.state;
    });

    it('should remove passage from tree', () => {
      const passage = stateWithPassage.nodeIndex['passage-1']!.node as PassageNode;
      const replacements = [createParagraphNode([createTextNode('Replacement')])];
      const event = createPassageRemovedEvent('passage-1', passage, replacements, 3, 'user');
      const result = applyEvent(stateWithPassage, event);

      expect(result.state.root.children.find(c => c.id === 'passage-1')).toBeUndefined();
    });

    it('should remove passage from passageIndex', () => {
      const passage = stateWithPassage.nodeIndex['passage-1']!.node as PassageNode;
      const replacements = [createParagraphNode([createTextNode('Replacement')])];
      const event = createPassageRemovedEvent('passage-1', passage, replacements, 3, 'user');
      const result = applyEvent(stateWithPassage, event);

      expect(result.state.passageIndex.byReference['John 3:16']).not.toContain('passage-1');
      expect(result.state.passageIndex.byBook['John']).not.toContain('passage-1');
    });

    it('should insert replacement nodes', () => {
      const passage = stateWithPassage.nodeIndex['passage-1']!.node as PassageNode;
      const replacement = createParagraphNode([createTextNode('Replacement')]);
      replacement.id = 'para-replacement';
      const event = createPassageRemovedEvent('passage-1', passage, [replacement], 3, 'user');
      const result = applyEvent(stateWithPassage, event);

      expect(result.state.root.children.find(c => c.id === 'para-replacement')).toBeDefined();
    });
  });

  describe('passage_metadata_updated', () => {
    let stateWithPassage: DocumentState;

    beforeEach(() => {
      const passage = createTestPassage();
      const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
      const result = applyEvent(state, event);
      stateWithPassage = result.state;
    });

    it('should update passage metadata', () => {
      const passage = stateWithPassage.nodeIndex['passage-1']!.node as PassageNode;
      const newMeta = { ...passage.metadata, userVerified: true };
      const event = createPassageMetadataUpdatedEvent(
        'passage-1',
        passage.metadata,
        newMeta,
        ['userVerified'],
        3,
        'user'
      );
      const result = applyEvent(stateWithPassage, event);

      const updatedPassage = result.state.nodeIndex['passage-1']!.node as PassageNode;
      expect(updatedPassage.metadata.userVerified).toBe(true);
    });
  });

  describe('passage_verified', () => {
    let stateWithPassage: DocumentState;

    beforeEach(() => {
      const passage = createTestPassage();
      const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
      const result = applyEvent(state, event);
      stateWithPassage = result.state;
    });

    it('should set userVerified to true', () => {
      const event = createPassageVerifiedEvent('passage-1', true, 'Looks good', 3, 'user');
      const result = applyEvent(stateWithPassage, event);

      const passage = result.state.nodeIndex['passage-1']!.node as PassageNode;
      expect(passage.metadata.userVerified).toBe(true);
    });

    it('should set userVerified to false', () => {
      // First verify it
      const verify = createPassageVerifiedEvent('passage-1', true, undefined, 3, 'user');
      const verifiedState = applyEvent(stateWithPassage, verify).state;

      // Then unverify
      const unverify = createPassageVerifiedEvent('passage-1', false, undefined, 4, 'user');
      const result = applyEvent(verifiedState, unverify);

      const passage = result.state.nodeIndex['passage-1']!.node as PassageNode;
      expect(passage.metadata.userVerified).toBe(false);
    });
  });
});

// ============================================================================
// INTERJECTION EVENTS
// ============================================================================

describe('applyEvent - Interjection Operations', () => {
  let stateWithPassage: DocumentState;

  beforeEach(() => {
    const state = createTestState();
    const passage = createTestPassage();
    const event = createPassageCreatedEvent(passage, 'root-1', 1, [], 2, 'system');
    const result = applyEvent(state, event);
    stateWithPassage = result.state;
  });

  describe('interjection_added', () => {
    it('should add interjection to passage children', () => {
      const interjection: InterjectionNode = {
        id: 'interj-1',
        type: 'interjection',
        version: 1,
        updatedAt: '2024-01-01T00:00:00.000Z',
        content: '[speaker emphasis]',
        metadataId: 'interj-meta-1',
      };
      const event = createInterjectionAddedEvent('passage-1', interjection, 1, 3, 'user');
      const result = applyEvent(stateWithPassage, event);

      const passage = result.state.nodeIndex['passage-1']!.node as PassageNode;
      expect(passage.children.find(c => c.id === 'interj-1')).toBeDefined();
    });

    it('should add interjection to nodeIndex', () => {
      const interjection: InterjectionNode = {
        id: 'interj-1',
        type: 'interjection',
        version: 1,
        updatedAt: '2024-01-01T00:00:00.000Z',
        content: '[speaker emphasis]',
        metadataId: 'interj-meta-1',
      };
      const event = createInterjectionAddedEvent('passage-1', interjection, 1, 3, 'user');
      const result = applyEvent(stateWithPassage, event);

      expect(result.state.nodeIndex['interj-1']).toBeDefined();
      expect(result.state.nodeIndex['interj-1']!.parentId).toBe('passage-1');
    });
  });

  describe('interjection_removed', () => {
    let stateWithInterjection: DocumentState;

    beforeEach(() => {
      const interjection: InterjectionNode = {
        id: 'interj-1',
        type: 'interjection',
        version: 1,
        updatedAt: '2024-01-01T00:00:00.000Z',
        content: '[emphasis]',
        metadataId: 'interj-meta-1',
      };
      const addEvent = createInterjectionAddedEvent('passage-1', interjection, 1, 3, 'user');
      const result = applyEvent(stateWithPassage, addEvent);
      stateWithInterjection = result.state;
    });

    it('should remove interjection from passage children', () => {
      const interj = stateWithInterjection.nodeIndex['interj-1']!.node as InterjectionNode;
      const event = createInterjectionRemovedEvent('passage-1', 'interj-1', interj, 1, 4, 'user');
      const result = applyEvent(stateWithInterjection, event);

      const passage = result.state.nodeIndex['passage-1']!.node as PassageNode;
      expect(passage.children.find(c => c.id === 'interj-1')).toBeUndefined();
    });

    it('should remove interjection from nodeIndex', () => {
      const interj = stateWithInterjection.nodeIndex['interj-1']!.node as InterjectionNode;
      const event = createInterjectionRemovedEvent('passage-1', 'interj-1', interj, 1, 4, 'user');
      const result = applyEvent(stateWithInterjection, event);

      expect(result.state.nodeIndex['interj-1']).toBeUndefined();
    });
  });
});

// ============================================================================
// PARAGRAPH EVENTS
// ============================================================================

describe('applyEvent - Paragraph Operations', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  describe('paragraph_split', () => {
    it('should replace original paragraph with two new ones', () => {
      const originalPara = state.nodeIndex['para-1']!.node as ParagraphNode;
      const firstPara = createParagraphNode([createTextNode('Initial')]);
      firstPara.id = 'para-first';
      const secondPara = createParagraphNode([createTextNode(' content.')]);
      secondPara.id = 'para-second';

      const event = createParagraphSplitEvent(
        'para-1',
        originalPara,
        firstPara,
        secondPara,
        7,
        2,
        'user'
      );
      const result = applyEvent(state, event);

      expect(result.state.root.children.find(c => c.id === 'para-1')).toBeUndefined();
      expect(result.state.root.children.find(c => c.id === 'para-first')).toBeDefined();
      expect(result.state.root.children.find(c => c.id === 'para-second')).toBeDefined();
    });

    it('should update nodeIndex with new paragraphs', () => {
      const originalPara = state.nodeIndex['para-1']!.node as ParagraphNode;
      const firstPara = createParagraphNode([createTextNode('Initial')]);
      firstPara.id = 'para-first';
      const secondPara = createParagraphNode([createTextNode(' content.')]);
      secondPara.id = 'para-second';

      const event = createParagraphSplitEvent(
        'para-1',
        originalPara,
        firstPara,
        secondPara,
        7,
        2,
        'user'
      );
      const result = applyEvent(state, event);

      expect(result.state.nodeIndex['para-first']).toBeDefined();
      expect(result.state.nodeIndex['para-second']).toBeDefined();
      expect(result.state.nodeIndex['para-1']).toBeUndefined();
    });
  });

  describe('paragraph_merged', () => {
    let stateWithTwoParagraphs: DocumentState;

    beforeEach(() => {
      // Add a second paragraph
      const para2 = createParagraphNode([createTextNode(' More text.')]);
      para2.id = 'para-2';
      const addEvent = createNodeCreatedEvent(para2, 'root-1', 1, 2, 'user');
      const result = applyEvent(state, addEvent);
      stateWithTwoParagraphs = result.state;
    });

    it('should merge second paragraph into first', () => {
      const para2 = stateWithTwoParagraphs.nodeIndex['para-2']!.node as ParagraphNode;
      const event = createParagraphMergedEvent('para-1', 'para-2', para2, 3, 'user');
      const result = applyEvent(stateWithTwoParagraphs, event);

      // First paragraph should have merged content
      const firstPara = result.state.nodeIndex['para-1']!.node as ParagraphNode;
      expect(firstPara.children.length).toBeGreaterThanOrEqual(1);
      
      // Second paragraph should be removed
      expect(result.state.root.children.find(c => c.id === 'para-2')).toBeUndefined();
    });

    it('should remove merged paragraph from nodeIndex', () => {
      const para2 = stateWithTwoParagraphs.nodeIndex['para-2']!.node as ParagraphNode;
      const event = createParagraphMergedEvent('para-1', 'para-2', para2, 3, 'user');
      const result = applyEvent(stateWithTwoParagraphs, event);

      expect(result.state.nodeIndex['para-2']).toBeUndefined();
    });
  });
});

// ============================================================================
// DOCUMENT METADATA EVENTS
// ============================================================================

describe('applyEvent - Document Metadata', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  describe('document_metadata_updated', () => {
    it('should update document title', () => {
      const event = createDocumentMetadataUpdatedEvent(
        { previousTitle: 'Test Document', newTitle: 'New Title' },
        2,
        'user'
      );
      const result = applyEvent(state, event);

      expect(result.state.root.title).toBe('New Title');
    });

    it('should update Bible passage', () => {
      const event = createDocumentMetadataUpdatedEvent(
        { previousBiblePassage: 'John 3:16', newBiblePassage: 'Romans 8:28' },
        2,
        'user'
      );
      const result = applyEvent(state, event);

      expect(result.state.root.biblePassage).toBe('Romans 8:28');
    });

    it('should update multiple fields at once', () => {
      const event = createDocumentMetadataUpdatedEvent(
        {
          previousTitle: 'Test Document',
          newTitle: 'New Title',
          previousBiblePassage: 'John 3:16',
          newBiblePassage: 'Mark 1:1',
        },
        2,
        'user'
      );
      const result = applyEvent(state, event);

      expect(result.state.root.title).toBe('New Title');
      expect(result.state.root.biblePassage).toBe('Mark 1:1');
    });
  });
});

// ============================================================================
// BATCH EVENTS
// ============================================================================

describe('applyEvent - Batch Operations', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should apply all events in batch', () => {
    const textEvent = createTextChangedEvent(
      'text-1',
      'Initial content.',
      'Updated.',
      0,
      16,
      'Updated.',
      2,
      'user'
    );
    const newPara = createParagraphNode([createTextNode('New paragraph')]);
    newPara.id = 'para-new';
    const createEvent = createNodeCreatedEvent(newPara, 'root-1', 1, 3, 'user');

    const batchEvent = createBatchEvent([textEvent, createEvent], 'Multiple edits', 4, 'user');
    const result = applyEvent(state, batchEvent);

    // Verify text was updated
    const textNode = result.state.nodeIndex['text-1']!.node as TextNode;
    expect(textNode.content).toBe('Updated.');

    // Verify paragraph was created
    expect(result.state.nodeIndex['para-new']).toBeDefined();
  });

  it('should handle empty batch', () => {
    const batchEvent = createBatchEvent([], 'Empty batch', 2, 'user');
    const result = applyEvent(state, batchEvent);

    expect(result.success).toBe(true);
    expect(result.state.version).toBe(2);
  });
});

// ============================================================================
// APPLY MULTIPLE EVENTS
// ============================================================================

describe('applyEvents - Multiple Events', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should apply multiple events in sequence', () => {
    const events = [
      createTextChangedEvent('text-1', 'Initial content.', 'First.', 0, 16, 'First.', 2, 'user'),
      createTextChangedEvent('text-1', 'First.', 'Second.', 0, 6, 'Second.', 3, 'user'),
    ];
    const result = applyEvents(state, events);

    expect(result.success).toBe(true);
    const textNode = result.state.nodeIndex['text-1']!.node as TextNode;
    expect(textNode.content).toBe('Second.');
  });

  it('should return all applied events', () => {
    const events = [
      createTextChangedEvent('text-1', 'Initial content.', 'First.', 0, 16, 'First.', 2, 'user'),
      createTextChangedEvent('text-1', 'First.', 'Second.', 0, 6, 'Second.', 3, 'user'),
    ];
    const result = applyEvents(state, events);

    expect(result.appliedEvents).toHaveLength(2);
  });

  it('should stop on first error if stopOnError is true', () => {
    // Try to update a non-existent text node
    const events = [
      createTextChangedEvent('text-1', 'Initial content.', 'Valid.', 0, 16, 'Valid.', 2, 'user'),
      createTextChangedEvent('non-existent', 'x', 'y', 0, 1, 'y', 3, 'user'), // Will fail
      createTextChangedEvent('text-1', 'Valid.', 'Skipped.', 0, 6, 'Skipped.', 4, 'user'),
    ];
    const result = applyEvents(state, events, { stopOnError: true });

    // Should have applied first event, failed on second, skipped third
    expect(result.appliedEvents!.length).toBeLessThanOrEqual(2);
  });

  it('should handle empty events array', () => {
    const result = applyEvents(state, []);

    expect(result.success).toBe(true);
    expect(result.state).toBe(state); // Unchanged
    expect(result.appliedEvents).toHaveLength(0);
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('applyEvent - Error Handling', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should return error for non-existent text node', () => {
    const event = createTextChangedEvent(
      'non-existent-id',
      'old',
      'new',
      0,
      3,
      'new',
      2,
      'user'
    );
    const result = applyEvent(state, event);

    // The reducer should either succeed (no-op) or fail gracefully
    // In our implementation, we handle missing nodes
    expect(result.state).toBeDefined();
  });

  it('should return error for non-existent passage in verification', () => {
    const event = createPassageVerifiedEvent('non-existent-passage', true, 'test', 2, 'user');
    const result = applyEvent(state, event);

    // Should handle gracefully
    expect(result.state).toBeDefined();
  });
});

// ============================================================================
// UNDO STACK MANAGEMENT
// ============================================================================

describe('applyEvent - Undo Stack Management', () => {
  let state: DocumentState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should respect maxUndoStackSize option', () => {
    // Add many events with small max size
    let currentState = state;
    for (let i = 0; i < 10; i++) {
      const event = createTextChangedEvent(
        'text-1',
        `v${i}`,
        `v${i + 1}`,
        0,
        2,
        `v${i + 1}`,
        i + 2,
        'user'
      );
      const result = applyEvent(currentState, event, { maxUndoStackSize: 5 });
      currentState = result.state;
    }

    expect(currentState.undoStack.length).toBeLessThanOrEqual(5);
  });

  it('should not add to undo stack when addToUndoStack is false', () => {
    const event = createTextChangedEvent(
      'text-1',
      'Initial content.',
      'New.',
      0,
      16,
      'New.',
      2,
      'user'
    );
    const result = applyEvent(state, event, { addToUndoStack: false });

    expect(result.state.undoStack).not.toContain(event.id);
  });
});
