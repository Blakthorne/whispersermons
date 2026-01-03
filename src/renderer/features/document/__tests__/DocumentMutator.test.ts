/**
 * DocumentMutator Tests
 *
 * Tests for the high-level mutation API that wraps the event system.
 * These tests verify that mutations are correctly applied and that
 * undo/redo functionality works properly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentMutator, createDocumentMutator } from '../DocumentMutator';
import type {
  DocumentState,
  DocumentRootNode,
  ParagraphNode,
  TextNode,
  PassageNode,
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
    content: 'Hello, world!',
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
 * Create a state with a passage for testing passage operations.
 */
function createStateWithPassage(): DocumentState {
  const passageText: TextNode = {
    id: 'passage-text-1',
    type: 'text',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    content: 'For God so loved the world...',
  };

  const passage: PassageNode = {
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

  const paragraph: ParagraphNode = {
    id: 'para-1',
    type: 'paragraph',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    children: [
      {
        id: 'text-1',
        type: 'text',
        version: 1,
        updatedAt: '2024-01-01T00:00:00.000Z',
        content: 'Regular paragraph.',
      },
    ],
  };

  const root: DocumentRootNode = {
    id: 'root-1',
    type: 'document',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    title: 'Test Document',
    biblePassage: 'John 3',
    children: [paragraph, passage],
  };

  return {
    root,
    version: 1,
    nodeIndex: {
      'root-1': { node: root, parentId: null, path: [] },
      'para-1': { node: paragraph, parentId: 'root-1', path: ['root-1'] },
      'text-1': { node: paragraph.children[0]!, parentId: 'para-1', path: ['root-1', 'para-1'] },
      'passage-1': { node: passage, parentId: 'root-1', path: ['root-1'] },
      'passage-text-1': { node: passageText, parentId: 'passage-1', path: ['root-1', 'passage-1'] },
    },
    passageIndex: {
      byReference: { 'John 3:16': ['passage-1'] },
      byBook: { 'John': ['passage-1'] },
      all: ['passage-1'],
    },
    extracted: {
      references: ['John 3:16'],
      tags: [],
    },
    eventLog: [],
    undoStack: [],
    redoStack: [],
    lastModified: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

// ============================================================================
// MUTATOR CREATION
// ============================================================================

describe('DocumentMutator - Creation', () => {
  it('should create mutator from state', () => {
    const state = createTestState();
    const mutator = new DocumentMutator(state);

    expect(mutator.getState()).toBe(state);
  });

  it('should create mutator via factory function', () => {
    const state = createTestState();
    const mutator = createDocumentMutator(state);

    expect(mutator.getState()).toBe(state);
  });

  it('should provide read access to root', () => {
    const state = createTestState();
    const mutator = new DocumentMutator(state);

    expect(mutator.getRoot().id).toBe('root-1');
    expect(mutator.getRoot().title).toBe('Test Document');
  });

  it('should provide version access', () => {
    const state = createTestState();
    const mutator = new DocumentMutator(state);

    expect(mutator.getVersion()).toBe(1);
  });
});

// ============================================================================
// TEXT MUTATIONS
// ============================================================================

describe('DocumentMutator - Text Mutations', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createTestState());
  });

  describe('updateText', () => {
    it('should update text content', () => {
      const result = mutator.updateText('text-1', 'New content!');

      expect(result.success).toBe(true);
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('New content!');
    });

    it('should return error for non-existent node', () => {
      const result = mutator.updateText('non-existent', 'text');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for non-text node', () => {
      const result = mutator.updateText('para-1', 'text');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should increment version after update', () => {
      const versionBefore = mutator.getVersion();
      mutator.updateText('text-1', 'New');
      expect(mutator.getVersion()).toBe(versionBefore + 1);
    });
  });

  describe('insertText', () => {
    it('should insert text at offset', () => {
      const result = mutator.insertText('text-1', 7, 'beautiful ');

      expect(result.success).toBe(true);
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('Hello, beautiful world!');
    });

    it('should insert at beginning', () => {
      mutator.insertText('text-1', 0, 'Start: ');
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('Start: Hello, world!');
    });

    it('should insert at end', () => {
      mutator.insertText('text-1', 13, ' End.');
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('Hello, world! End.');
    });
  });

  describe('deleteText', () => {
    it('should delete text at offset', () => {
      const result = mutator.deleteText('text-1', 5, 7);

      expect(result.success).toBe(true);
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('Hello!');
    });

    it('should delete from beginning', () => {
      mutator.deleteText('text-1', 0, 7);
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('world!');
    });

    it('should delete to end', () => {
      mutator.deleteText('text-1', 5, 8);
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('Hello');
    });
  });
});

// ============================================================================
// NODE MUTATIONS
// ============================================================================

describe('DocumentMutator - Node Mutations', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createTestState());
  });

  describe('createParagraph', () => {
    it('should create new paragraph', () => {
      const result = mutator.createParagraph('New paragraph content', 'root-1', 1);

      expect(result.success).toBe(true);
      expect(mutator.getRoot().children.length).toBe(2);
    });

    it('should insert at correct index', () => {
      mutator.createParagraph('First', 'root-1', 0);
      
      expect(mutator.getRoot().children.length).toBe(2);
      // New paragraph should be first
      const firstChild = mutator.getRoot().children[0] as ParagraphNode;
      const textChild = firstChild.children[0] as TextNode;
      expect(textChild.content).toBe('First');
    });
  });

  describe('deleteNode', () => {
    it('should delete paragraph', () => {
      const result = mutator.deleteNode('para-1');

      expect(result.success).toBe(true);
      expect(mutator.getRoot().children.length).toBe(0);
    });

    it('should not allow deleting root', () => {
      const result = mutator.deleteNode('root-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete root');
    });

    it('should return error for non-existent node', () => {
      const result = mutator.deleteNode('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});

// ============================================================================
// PASSAGE MUTATIONS
// ============================================================================

describe('DocumentMutator - Passage Mutations', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createStateWithPassage());
  });

  describe('verifyPassage', () => {
    it('should verify a passage', () => {
      const result = mutator.verifyPassage('passage-1', true, 'Verified by pastor');

      expect(result.success).toBe(true);
      const passage = mutator.getNodeById('passage-1') as PassageNode;
      expect(passage.metadata.userVerified).toBe(true);
    });

    it('should unverify a passage', () => {
      // First verify
      mutator.verifyPassage('passage-1', true);
      
      // Then unverify
      const result = mutator.verifyPassage('passage-1', false);

      expect(result.success).toBe(true);
      const passage = mutator.getNodeById('passage-1') as PassageNode;
      expect(passage.metadata.userVerified).toBe(false);
    });

    it('should return error for non-existent passage', () => {
      const result = mutator.verifyPassage('non-existent', true);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('updatePassageMetadata', () => {
    it('should update passage metadata', () => {
      const result = mutator.updatePassageMetadata('passage-1', {
        userVerified: true,
      });

      expect(result.success).toBe(true);
      const passage = mutator.getNodeById('passage-1') as PassageNode;
      expect(passage.metadata.userVerified).toBe(true);
    });
  });

  describe('removePassage', () => {
    it('should remove passage and insert replacement', () => {
      const result = mutator.removePassage('passage-1');

      expect(result.success).toBe(true);
      expect(mutator.getNodeById('passage-1')).toBeUndefined();
    });
  });

  describe('createPassage', () => {
    it('should create new passage', () => {
      const result = mutator.createPassage({
        reference: 'Romans 8:28',
        book: 'Romans',
        chapter: 8,
        verseStart: 28,
        content: 'And we know that all things work together...',
        parentId: 'root-1',
        index: 0,
      });

      expect(result.success).toBe(true);
      // Should have a new passage in the tree
      const rootChildren = mutator.getRoot().children;
      const newPassage = rootChildren.find(c => c.type === 'passage' && c.id !== 'passage-1');
      expect(newPassage).toBeDefined();
    });
  });
});

// ============================================================================
// INTERJECTION MUTATIONS
// ============================================================================

describe('DocumentMutator - Interjection Mutations', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createStateWithPassage());
  });

  describe('addInterjection', () => {
    it('should add interjection to passage', () => {
      const result = mutator.addInterjection('passage-1', '[emphasis]', 1);

      expect(result.success).toBe(true);
      const passage = mutator.getNodeById('passage-1') as PassageNode;
      expect(passage.children.length).toBe(2); // Original text + interjection
    });

    it('should return error for non-passage node', () => {
      const result = mutator.addInterjection('para-1', '[emphasis]', 0);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('removeInterjection', () => {
    it('should remove interjection from passage', () => {
      // First add an interjection
      mutator.addInterjection('passage-1', '[emphasis]', 1);
      const passage = mutator.getNodeById('passage-1') as PassageNode;
      const interjectionId = passage.children.find(c => c.type === 'interjection')?.id;

      // Then remove it
      const result = mutator.removeInterjection('passage-1', interjectionId!);

      expect(result.success).toBe(true);
      const updatedPassage = mutator.getNodeById('passage-1') as PassageNode;
      expect(updatedPassage.children.filter(c => c.type === 'interjection').length).toBe(0);
    });
  });
});

// ============================================================================
// PARAGRAPH MUTATIONS
// ============================================================================

describe('DocumentMutator - Paragraph Mutations', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createTestState());
  });

  describe('splitParagraph', () => {
    it('should split paragraph at offset', () => {
      const result = mutator.splitParagraph('para-1', 7);

      expect(result.success).toBe(true);
      // Original paragraph should be replaced with two new ones
      expect(mutator.getNodeById('para-1')).toBeUndefined();
      expect(mutator.getRoot().children.length).toBe(2);
    });
  });

  describe('mergeParagraphs', () => {
    it('should merge two paragraphs', () => {
      // First create a second paragraph
      mutator.createParagraph(' Second paragraph.', 'root-1', 1);
      
      const secondPara = mutator.getRoot().children[1] as ParagraphNode;
      const result = mutator.mergeParagraphs('para-1', secondPara.id);

      expect(result.success).toBe(true);
      // Should have only one paragraph now
      expect(mutator.getRoot().children.filter(c => c.type === 'paragraph').length).toBe(1);
    });
  });
});

// ============================================================================
// DOCUMENT METADATA
// ============================================================================

describe('DocumentMutator - Document Metadata', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createTestState());
  });

  describe('updateTitle', () => {
    it('should update document title', () => {
      const result = mutator.updateTitle('New Document Title');

      expect(result.success).toBe(true);
      expect(mutator.getRoot().title).toBe('New Document Title');
    });
  });

  describe('updateBiblePassage', () => {
    it('should update Bible passage', () => {
      const result = mutator.updateBiblePassage('Romans 8:28');

      expect(result.success).toBe(true);
      expect(mutator.getRoot().biblePassage).toBe('Romans 8:28');
    });
  });
});

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

describe('DocumentMutator - Batch Operations', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createTestState());
  });

  it('should apply multiple mutations in batch', () => {
    const result = mutator.batch('Multiple edits', (m) => {
      m.updateText('text-1', 'Updated text');
      m.updateTitle('New Title');
    });

    expect(result.success).toBe(true);
    const textNode = mutator.getNodeById('text-1') as TextNode;
    expect(textNode.content).toBe('Updated text');
    expect(mutator.getRoot().title).toBe('New Title');
  });

  it('should record batch as single event', () => {
    mutator.batch('Edit batch', (m) => {
      m.updateText('text-1', 'A');
      m.updateText('text-1', 'B');
      m.updateText('text-1', 'C');
    });

    // Single batch event in the log
    const batchEvents = mutator.getState().eventLog.filter(e => e.type === 'batch');
    expect(batchEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// UNDO/REDO
// ============================================================================

describe('DocumentMutator - Undo/Redo', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createTestState());
  });

  describe('canUndo/canRedo', () => {
    it('should start with nothing to undo', () => {
      expect(mutator.canUndo()).toBe(false);
    });

    it('should start with nothing to redo', () => {
      expect(mutator.canRedo()).toBe(false);
    });

    it('should be able to undo after mutation', () => {
      mutator.updateText('text-1', 'New content');
      expect(mutator.canUndo()).toBe(true);
    });
  });

  describe('undo', () => {
    it('should undo text change', () => {
      const originalContent = (mutator.getNodeById('text-1') as TextNode).content;
      mutator.updateText('text-1', 'Modified');
      
      const result = mutator.undo();

      expect(result.success).toBe(true);
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe(originalContent);
    });

    it('should return error when nothing to undo', () => {
      const result = mutator.undo();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Nothing to undo');
    });

    it('should enable redo after undo', () => {
      mutator.updateText('text-1', 'Modified');
      mutator.undo();

      expect(mutator.canRedo()).toBe(true);
    });
  });

  describe('redo', () => {
    it('should redo undone change', () => {
      mutator.updateText('text-1', 'Modified');
      mutator.undo();
      
      const result = mutator.redo();

      expect(result.success).toBe(true);
      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe('Modified');
    });

    it('should return error when nothing to redo', () => {
      const result = mutator.redo();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Nothing to redo');
    });
  });

  describe('undo/redo interaction', () => {
    it('should clear redo stack on new mutation', () => {
      mutator.updateText('text-1', 'First');
      mutator.undo();
      expect(mutator.canRedo()).toBe(true);

      mutator.updateText('text-1', 'Second');
      expect(mutator.canRedo()).toBe(false);
    });

    it('should support multiple undo/redo cycles', () => {
      const original = (mutator.getNodeById('text-1') as TextNode).content;
      
      mutator.updateText('text-1', 'Change 1');
      mutator.updateText('text-1', 'Change 2');
      mutator.updateText('text-1', 'Change 3');

      // Undo all changes
      mutator.undo();
      mutator.undo();
      mutator.undo();

      const textNode = mutator.getNodeById('text-1') as TextNode;
      expect(textNode.content).toBe(original);

      // Redo all changes
      mutator.redo();
      mutator.redo();
      mutator.redo();

      const finalNode = mutator.getNodeById('text-1') as TextNode;
      expect(finalNode.content).toBe('Change 3');
    });
  });
});

// ============================================================================
// SUBSCRIPTION
// ============================================================================

describe('DocumentMutator - Subscription', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createTestState());
  });

  it('should notify subscribers on mutation', () => {
    const callback = vi.fn();
    mutator.subscribe(callback);

    mutator.updateText('text-1', 'New content');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ version: expect.any(Number) }),
      expect.objectContaining({ type: 'text_changed' })
    );
  });

  it('should allow unsubscribing', () => {
    const callback = vi.fn();
    const unsubscribe = mutator.subscribe(callback);

    unsubscribe();
    mutator.updateText('text-1', 'New content');

    expect(callback).not.toHaveBeenCalled();
  });

  it('should support multiple subscribers', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    
    mutator.subscribe(callback1);
    mutator.subscribe(callback2);

    mutator.updateText('text-1', 'New content');

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// STATISTICS
// ============================================================================

describe('DocumentMutator - Statistics', () => {
  let mutator: DocumentMutator;

  beforeEach(() => {
    mutator = new DocumentMutator(createStateWithPassage());
  });

  it('should provide document statistics', () => {
    const stats = mutator.getStatistics();

    expect(stats).toBeDefined();
    expect(stats.passageCount).toBe(1);
    expect(stats.verifiedPassageCount).toBe(0);
    expect(stats.paragraphCount).toBeGreaterThanOrEqual(1);
  });

  it('should update statistics after mutations', () => {
    mutator.verifyPassage('passage-1', true);
    const stats = mutator.getStatistics();

    expect(stats.verifiedPassageCount).toBe(1);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('DocumentMutator - Integration', () => {
  it('should handle complex editing workflow', () => {
    const mutator = new DocumentMutator(createTestState());

    // Create multiple paragraphs
    mutator.createParagraph('Second paragraph', 'root-1', 1);
    mutator.createParagraph('Third paragraph', 'root-1', 2);
    expect(mutator.getRoot().children.length).toBe(3);

    // Edit content
    mutator.updateText('text-1', 'Updated first paragraph');

    // Create a passage
    mutator.createPassage({
      reference: 'John 3:16',
      book: 'John',
      chapter: 3,
      verseStart: 16,
      content: 'For God so loved the world...',
      parentId: 'root-1',
      index: 1,
    });

    // Verify passage exists
    const passages = mutator.getRoot().children.filter(c => c.type === 'passage');
    expect(passages.length).toBe(1);

    // Verify the passage
    mutator.verifyPassage(passages[0]!.id, true, 'Checked by pastor');
    const verifiedPassage = mutator.getNodeById(passages[0]!.id) as PassageNode;
    expect(verifiedPassage.metadata.userVerified).toBe(true);

    // Undo the verification
    mutator.undo();
    const unverifiedPassage = mutator.getNodeById(passages[0]!.id) as PassageNode;
    expect(unverifiedPassage.metadata.userVerified).toBe(false);

    // Redo
    mutator.redo();
    const reVerifiedPassage = mutator.getNodeById(passages[0]!.id) as PassageNode;
    expect(reVerifiedPassage.metadata.userVerified).toBe(true);
  });

  it('should maintain consistency after many operations', () => {
    const mutator = new DocumentMutator(createTestState());

    // Perform many operations
    for (let i = 0; i < 50; i++) {
      mutator.updateText('text-1', `Content version ${i}`);
    }

    // Verify state is consistent
    const state = mutator.getState();
    expect(state.version).toBe(51);
    expect(state.eventLog.length).toBe(50);
    
    const textNode = mutator.getNodeById('text-1') as TextNode;
    expect(textNode.content).toBe('Content version 49');

    // Verify node index is consistent
    expect(state.nodeIndex['text-1']!.node).toBe(textNode);
  });
});
