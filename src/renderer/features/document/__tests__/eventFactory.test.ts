/**
 * Event Factory Tests
 *
 * Tests for the event factory functions that create properly typed
 * DocumentEvents for the event-sourced document model.
 */

import { describe, it, expect } from 'vitest';
import {
  createEventId,
  createNodeId,
  createTimestamp,
  createNodeCreatedEvent,
  createNodeDeletedEvent,
  createNodeMovedEvent,
  createTextChangedEvent,
  createContentReplacedEvent,
  createPassageCreatedEvent,
  createPassageRemovedEvent,
  createPassageMetadataUpdatedEvent,
  createPassageVerifiedEvent,
  createInterjectionAddedEvent,
  createInterjectionRemovedEvent,
  createNodesJoinedEvent,
  createNodeSplitEvent,
  createParagraphMergedEvent,
  createParagraphSplitEvent,
  createDocumentCreatedEvent,
  createDocumentMetadataUpdatedEvent,
  createBatchEvent,
  createUndoEvent,
  createRedoEvent,
  generateInverseEvents,
  createTextNode,
  createParagraphNode,
} from '../events';
import type {
  ParagraphNode,
  TextNode,
  PassageNode,
  InterjectionNode,
  DocumentRootNode,
} from '../../../../shared/documentModel';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a sample text node for testing.
 */
function sampleTextNode(content = 'Hello, world!'): TextNode {
  return {
    id: 'text-1',
    type: 'text',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    content,
  };
}

/**
 * Create a sample paragraph node for testing.
 */
function sampleParagraphNode(content = 'Hello, world!'): ParagraphNode {
  return {
    id: 'para-1',
    type: 'paragraph',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    children: [sampleTextNode(content)],
  };
}

/**
 * Create a sample passage node for testing.
 */
function samplePassageNode(): PassageNode {
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
    children: [sampleTextNode('For God so loved the world...')],
  };
}

/**
 * Create a sample interjection node.
 */
function sampleInterjectionNode(): InterjectionNode {
  return {
    id: 'interj-1',
    type: 'interjection',
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    content: '[speaker emphasis]',
    metadataId: 'interj-meta-1',
  };
}

// ============================================================================
// ID AND TIMESTAMP GENERATORS
// ============================================================================

describe('ID and Timestamp Generators', () => {
  describe('createEventId', () => {
    it('should generate unique event IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(createEventId());
      }
      expect(ids.size).toBe(100);
    });

    it('should start with "evt-" prefix', () => {
      const id = createEventId();
      expect(id).toMatch(/^evt-/);
    });

    it('should have valid UUID format after prefix', () => {
      const id = createEventId();
      const uuidPart = id.substring(4);
      expect(uuidPart).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('createNodeId', () => {
    it('should generate unique node IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(createNodeId());
      }
      expect(ids.size).toBe(100);
    });

    it('should start with "node-" prefix', () => {
      const id = createNodeId();
      expect(id).toMatch(/^node-/);
    });
  });

  describe('createTimestamp', () => {
    it('should return ISO 8601 format', () => {
      const timestamp = createTimestamp();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return current time (approximately)', () => {
      const before = Date.now();
      const timestamp = createTimestamp();
      const after = Date.now();
      const timestampMs = new Date(timestamp).getTime();
      expect(timestampMs).toBeGreaterThanOrEqual(before);
      expect(timestampMs).toBeLessThanOrEqual(after);
    });
  });
});

// ============================================================================
// NODE LIFECYCLE EVENTS
// ============================================================================

describe('Node Lifecycle Events', () => {
  describe('createNodeCreatedEvent', () => {
    it('should create a node_created event with correct structure', () => {
      const para = sampleParagraphNode();
      const event = createNodeCreatedEvent(para, 'root-1', 0, 2, 'user');

      expect(event.type).toBe('node_created');
      expect(event.node).toBe(para);
      expect(event.parentId).toBe('root-1');
      expect(event.index).toBe(0);
      expect(event.resultingVersion).toBe(2);
      expect(event.source).toBe('user');
      expect(event.id).toMatch(/^evt-/);
      expect(event.timestamp).toMatch(/^\d{4}-/);
    });

    it('should allow null parentId for root-level insertions', () => {
      const para = sampleParagraphNode();
      const event = createNodeCreatedEvent(para, null, 0, 1, 'system');

      expect(event.parentId).toBeNull();
    });
  });

  describe('createNodeDeletedEvent', () => {
    it('should create a node_deleted event with correct structure', () => {
      const para = sampleParagraphNode();
      const event = createNodeDeletedEvent('para-1', para, 'root-1', 0, 3, 'user');

      expect(event.type).toBe('node_deleted');
      expect(event.nodeId).toBe('para-1');
      expect(event.deletedNode).toBe(para);
      expect(event.parentId).toBe('root-1');
      expect(event.previousIndex).toBe(0);
      expect(event.resultingVersion).toBe(3);
      expect(event.source).toBe('user');
    });
  });

  describe('createNodeMovedEvent', () => {
    it('should create a node_moved event with correct structure', () => {
      const event = createNodeMovedEvent(
        'para-1',
        'old-parent',
        2,
        'new-parent',
        5,
        4,
        'user'
      );

      expect(event.type).toBe('node_moved');
      expect(event.nodeId).toBe('para-1');
      expect(event.fromParentId).toBe('old-parent');
      expect(event.toParentId).toBe('new-parent');
      expect(event.fromIndex).toBe(2);
      expect(event.toIndex).toBe(5);
      expect(event.resultingVersion).toBe(4);
    });
  });
});

// ============================================================================
// TEXT EVENTS
// ============================================================================

describe('Text Events', () => {
  describe('createTextChangedEvent', () => {
    it('should create a text_changed event for content update', () => {
      const event = createTextChangedEvent(
        'text-1',
        'Hello',
        'Hello, world!',
        5,
        0,
        ', world!',
        2,
        'user'
      );

      expect(event.type).toBe('text_changed');
      expect(event.nodeId).toBe('text-1');
      expect(event.previousContent).toBe('Hello');
      expect(event.newContent).toBe('Hello, world!');
      expect(event.offset).toBe(5);
      expect(event.deleteCount).toBe(0);
      expect(event.insertedText).toBe(', world!');
      expect(event.resultingVersion).toBe(2);
    });

    it('should create a text_changed event for deletion', () => {
      const event = createTextChangedEvent(
        'text-1',
        'Hello, world!',
        'Hello!',
        5,
        7,
        '',
        3,
        'user'
      );

      expect(event.previousContent).toBe('Hello, world!');
      expect(event.newContent).toBe('Hello!');
      expect(event.offset).toBe(5);
      expect(event.deleteCount).toBe(7);
      expect(event.insertedText).toBe('');
    });
  });

  describe('createContentReplacedEvent', () => {
    it('should create a content_replaced event', () => {
      const para = sampleParagraphNode('Old text');
      const newContent = [sampleTextNode('New text')];
      const event = createContentReplacedEvent(
        'para-1',
        para.children,
        newContent,
        5,
        'user'
      );

      expect(event.type).toBe('content_replaced');
      expect(event.nodeId).toBe('para-1');
      expect(event.previousChildren).toBe(para.children);
      expect(event.newChildren).toBe(newContent);
      expect(event.resultingVersion).toBe(5);
    });
  });
});

// ============================================================================
// PASSAGE EVENTS
// ============================================================================

describe('Passage Events', () => {
  describe('createPassageCreatedEvent', () => {
    it('should create a passage_created event', () => {
      const passage = samplePassageNode();
      const event = createPassageCreatedEvent(
        passage,
        'root-1',
        0,
        ['para-old-1'],
        5,
        'system'
      );

      expect(event.type).toBe('passage_created');
      expect(event.passage).toBe(passage);
      expect(event.parentId).toBe('root-1');
      expect(event.index).toBe(0);
      expect(event.replacedNodeIds).toEqual(['para-old-1']);
      expect(event.resultingVersion).toBe(5);
      expect(event.source).toBe('system');
    });

    it('should allow empty replacedNodeIds', () => {
      const passage = samplePassageNode();
      const event = createPassageCreatedEvent(passage, 'root-1', 0, [], 1, 'user');

      expect(event.replacedNodeIds).toEqual([]);
    });
  });

  describe('createPassageRemovedEvent', () => {
    it('should create a passage_removed event with replacements', () => {
      const passage = samplePassageNode();
      const replacements = [sampleParagraphNode('For God so loved the world...')];
      const event = createPassageRemovedEvent('passage-1', passage, replacements, 6, 'user');

      expect(event.type).toBe('passage_removed');
      expect(event.passageId).toBe('passage-1');
      expect(event.removedPassage).toBe(passage);
      expect(event.replacementNodes).toBe(replacements);
      expect(event.resultingVersion).toBe(6);
    });
  });

  describe('createPassageMetadataUpdatedEvent', () => {
    it('should create a passage_metadata_updated event', () => {
      const passage = samplePassageNode();
      const previousMeta = passage.metadata;
      const newMeta = {
        ...previousMeta,
        userVerified: true,
      };
      const event = createPassageMetadataUpdatedEvent(
        'passage-1',
        previousMeta,
        newMeta,
        ['userVerified'],
        7,
        'user'
      );

      expect(event.type).toBe('passage_metadata_updated');
      expect(event.passageId).toBe('passage-1');
      expect(event.previousMetadata).toBe(previousMeta);
      expect(event.newMetadata).toBe(newMeta);
      expect(event.changedFields).toEqual(['userVerified']);
    });
  });

  describe('createPassageVerifiedEvent', () => {
    it('should create a passage_verified event', () => {
      const event = createPassageVerifiedEvent(
        'passage-1',
        true,
        'Verified by pastor',
        8,
        'user'
      );

      expect(event.type).toBe('passage_verified');
      expect(event.passageId).toBe('passage-1');
      expect(event.verified).toBe(true);
      expect(event.notes).toBe('Verified by pastor');
      expect(event.resultingVersion).toBe(8);
    });

    it('should allow undefined notes', () => {
      const event = createPassageVerifiedEvent('passage-1', false, undefined, 9, 'user');

      expect(event.verified).toBe(false);
      expect(event.notes).toBeUndefined();
    });
  });
});

// ============================================================================
// INTERJECTION EVENTS
// ============================================================================

describe('Interjection Events', () => {
  describe('createInterjectionAddedEvent', () => {
    it('should create an interjection_added event', () => {
      const interj = sampleInterjectionNode();
      const event = createInterjectionAddedEvent('passage-1', interj, 1, 10, 'user');

      expect(event.type).toBe('interjection_added');
      expect(event.passageId).toBe('passage-1');
      expect(event.interjection).toBe(interj);
      expect(event.index).toBe(1);
      expect(event.resultingVersion).toBe(10);
    });
  });

  describe('createInterjectionRemovedEvent', () => {
    it('should create an interjection_removed event', () => {
      const interj = sampleInterjectionNode();
      const event = createInterjectionRemovedEvent(
        'passage-1',
        'interj-1',
        interj,
        1,
        11,
        'user'
      );

      expect(event.type).toBe('interjection_removed');
      expect(event.passageId).toBe('passage-1');
      expect(event.interjectionId).toBe('interj-1');
      expect(event.removedInterjection).toBe(interj);
      expect(event.previousIndex).toBe(1);
      expect(event.resultingVersion).toBe(11);
    });
  });
});

// ============================================================================
// STRUCTURE EVENTS
// ============================================================================

describe('Structure Events', () => {
  describe('createNodesJoinedEvent', () => {
    it('should create a nodes_joined event', () => {
      const para1 = sampleParagraphNode('First');
      const para2 = sampleParagraphNode('Second');
      const result = sampleParagraphNode('FirstSecond');
      const event = createNodesJoinedEvent(
        ['para-1', 'para-2'],
        result,
        [para1, para2],
        12,
        'user'
      );

      expect(event.type).toBe('nodes_joined');
      expect(event.sourceNodeIds).toEqual(['para-1', 'para-2']);
      expect(event.resultNode).toBe(result);
      expect(event.sourceNodes).toEqual([para1, para2]);
      expect(event.resultingVersion).toBe(12);
    });
  });

  describe('createNodeSplitEvent', () => {
    it('should create a node_split event', () => {
      const original = sampleParagraphNode('HelloWorld');
      const first = sampleParagraphNode('Hello');
      const second = sampleParagraphNode('World');
      const event = createNodeSplitEvent(
        'para-1',
        original,
        [first, second],
        5,
        13,
        'user'
      );

      expect(event.type).toBe('node_split');
      expect(event.originalNodeId).toBe('para-1');
      expect(event.originalNode).toBe(original);
      expect(event.resultNodes).toEqual([first, second]);
      expect(event.splitOffset).toBe(5);
      expect(event.resultingVersion).toBe(13);
    });
  });

  describe('createParagraphMergedEvent', () => {
    it('should create a paragraph_merged event', () => {
      const merged = sampleParagraphNode('Second content');
      const event = createParagraphMergedEvent(
        'para-1',
        'para-2',
        merged,
        14,
        'user'
      );

      expect(event.type).toBe('paragraph_merged');
      expect(event.targetParagraphId).toBe('para-1');
      expect(event.mergedParagraphId).toBe('para-2');
      expect(event.mergedParagraph).toBe(merged);
      expect(event.resultingVersion).toBe(14);
    });
  });

  describe('createParagraphSplitEvent', () => {
    it('should create a paragraph_split event', () => {
      const original = sampleParagraphNode('Hello World');
      const first = sampleParagraphNode('Hello');
      const second = sampleParagraphNode(' World');
      const event = createParagraphSplitEvent(
        'para-1',
        original,
        first,
        second,
        5,
        15,
        'user'
      );

      expect(event.type).toBe('paragraph_split');
      expect(event.originalParagraphId).toBe('para-1');
      expect(event.originalParagraph).toBe(original);
      expect(event.firstParagraph).toBe(first);
      expect(event.secondParagraph).toBe(second);
      expect(event.splitOffset).toBe(5);
      expect(event.resultingVersion).toBe(15);
    });
  });
});

// ============================================================================
// DOCUMENT EVENTS
// ============================================================================

describe('Document Events', () => {
  describe('createDocumentCreatedEvent', () => {
    it('should create a document_created event', () => {
      const root: DocumentRootNode = {
        id: 'root-1',
        type: 'document',
        version: 1,
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: 'My Sermon',
        biblePassage: 'John 3',
        children: [],
      };
      const event = createDocumentCreatedEvent(root, 'transcription', 1, 'system');

      expect(event.type).toBe('document_created');
      expect(event.document).toBe(root);
      expect(event.creationSource).toBe('transcription');
      expect(event.resultingVersion).toBe(1);
      expect(event.source).toBe('system');
    });
  });

  describe('createDocumentMetadataUpdatedEvent', () => {
    it('should create event with title change', () => {
      const event = createDocumentMetadataUpdatedEvent(
        { previousTitle: 'Old Title', newTitle: 'New Title' },
        16,
        'user'
      );

      expect(event.type).toBe('document_metadata_updated');
      expect(event.previousTitle).toBe('Old Title');
      expect(event.newTitle).toBe('New Title');
      expect(event.resultingVersion).toBe(16);
    });

    it('should create event with Bible passage change', () => {
      const event = createDocumentMetadataUpdatedEvent(
        { previousBiblePassage: 'John 3', newBiblePassage: 'Romans 8' },
        17,
        'user'
      );

      expect(event.previousBiblePassage).toBe('John 3');
      expect(event.newBiblePassage).toBe('Romans 8');
    });

    it('should create event with multiple changes', () => {
      const event = createDocumentMetadataUpdatedEvent(
        { 
          previousTitle: 'Old Title', 
          newTitle: 'New Title',
          previousBiblePassage: 'John 3', 
          newBiblePassage: 'Romans 8',
        },
        18,
        'user'
      );

      expect(event.previousTitle).toBe('Old Title');
      expect(event.newTitle).toBe('New Title');
      expect(event.previousBiblePassage).toBe('John 3');
      expect(event.newBiblePassage).toBe('Romans 8');
    });
  });
});

// ============================================================================
// BATCH AND UNDO/REDO EVENTS
// ============================================================================

describe('Batch and Undo/Redo Events', () => {
  describe('createBatchEvent', () => {
    it('should create a batch event containing multiple events', () => {
      const textEvent = createTextChangedEvent(
        'text-1', 'a', 'ab', 1, 0, 'b', 2, 'user'
      );
      const para = sampleParagraphNode();
      const createEvent = createNodeCreatedEvent(para, 'root-1', 0, 3, 'user');
      
      const batchEvent = createBatchEvent(
        [textEvent, createEvent],
        'Combined edit',
        4,
        'user'
      );

      expect(batchEvent.type).toBe('batch');
      expect(batchEvent.events).toHaveLength(2);
      expect(batchEvent.events[0]).toBe(textEvent);
      expect(batchEvent.events[1]).toBe(createEvent);
      expect(batchEvent.description).toBe('Combined edit');
      expect(batchEvent.resultingVersion).toBe(4);
    });
  });

  describe('createUndoEvent', () => {
    it('should create an undo event', () => {
      const inverseEvent = createTextChangedEvent(
        'text-1', 'ab', 'a', 1, 1, '', 5, 'user'
      );
      const undoEvent = createUndoEvent(
        'evt-original',
        [inverseEvent],
        6,
        'user'
      );

      expect(undoEvent.type).toBe('undo');
      expect(undoEvent.undoneEventId).toBe('evt-original');
      expect(undoEvent.inverseEvents).toHaveLength(1);
      expect(undoEvent.inverseEvents[0]).toBe(inverseEvent);
      expect(undoEvent.resultingVersion).toBe(6);
    });
  });

  describe('createRedoEvent', () => {
    it('should create a redo event', () => {
      const originalEvent = createTextChangedEvent(
        'text-1', 'a', 'ab', 1, 0, 'b', 2, 'user'
      );
      const redoEvent = createRedoEvent(
        'evt-undo',
        [originalEvent],
        7,
        'user'
      );

      expect(redoEvent.type).toBe('redo');
      expect(redoEvent.redoneUndoEventId).toBe('evt-undo');
      expect(redoEvent.reappliedEvents).toHaveLength(1);
      expect(redoEvent.reappliedEvents[0]).toBe(originalEvent);
      expect(redoEvent.resultingVersion).toBe(7);
    });
  });
});

// ============================================================================
// INVERSE EVENT GENERATION
// ============================================================================

describe('generateInverseEvents', () => {
  it('should generate inverse for text_changed event', () => {
    const event = createTextChangedEvent(
      'text-1',
      'Hello',
      'Hello, world!',
      5,
      0,
      ', world!',
      2,
      'user'
    );
    const inverses = generateInverseEvents(event, 3);

    expect(inverses).toHaveLength(1);
    expect(inverses[0]!.type).toBe('text_changed');
    const inverse = inverses[0]! as ReturnType<typeof createTextChangedEvent>;
    expect(inverse.previousContent).toBe('Hello, world!');
    expect(inverse.newContent).toBe('Hello');
    expect(inverse.resultingVersion).toBe(4); // currentVersion + 1
  });

  it('should generate inverse for node_created event', () => {
    const para = sampleParagraphNode();
    const event = createNodeCreatedEvent(para, 'root-1', 0, 2, 'user');
    const inverses = generateInverseEvents(event, 3);

    expect(inverses).toHaveLength(1);
    expect(inverses[0]!.type).toBe('node_deleted');
  });

  it('should generate inverse for node_deleted event', () => {
    const para = sampleParagraphNode();
    const event = createNodeDeletedEvent('para-1', para, 'root-1', 0, 3, 'user');
    const inverses = generateInverseEvents(event, 4);

    expect(inverses).toHaveLength(1);
    expect(inverses[0]!.type).toBe('node_created');
  });

  it('should generate inverse for passage_created event', () => {
    const passage = samplePassageNode();
    const event = createPassageCreatedEvent(passage, 'root-1', 0, [], 2, 'system');
    const inverses = generateInverseEvents(event, 3);

    expect(inverses).toHaveLength(1);
    expect(inverses[0]!.type).toBe('passage_removed');
  });

  it('should generate inverse for passage_verified event', () => {
    const event = createPassageVerifiedEvent('passage-1', true, 'Verified', 5, 'user');
    const inverses = generateInverseEvents(event, 6);

    expect(inverses).toHaveLength(1);
    expect(inverses[0]!.type).toBe('passage_verified');
    const inverse = inverses[0]! as ReturnType<typeof createPassageVerifiedEvent>;
    expect(inverse.verified).toBe(false);
  });

  it('should generate inverse for batch event', () => {
    const textEvent = createTextChangedEvent(
      'text-1', 'a', 'ab', 1, 0, 'b', 2, 'user'
    );
    const batchEvent = createBatchEvent([textEvent], 'Edit', 3, 'user');
    const inverses = generateInverseEvents(batchEvent, 4);

    // Batch inverse returns individual inverse events (not wrapped in a batch)
    expect(inverses).toHaveLength(1);
    expect(inverses[0]!.type).toBe('text_changed');
    // The inverse reverses the original text_changed
    const inverse = inverses[0]! as ReturnType<typeof createTextChangedEvent>;
    expect(inverse.previousContent).toBe('ab');
    expect(inverse.newContent).toBe('a');
  });

  it('should return empty array for document_created (no undo)', () => {
    const root: DocumentRootNode = {
      id: 'root-1',
      type: 'document',
      version: 1,
      updatedAt: '2024-01-01T00:00:00.000Z',
      title: 'My Sermon',
      biblePassage: 'John 3',
      children: [],
    };
    const event = createDocumentCreatedEvent(root, 'transcription', 1, 'system');
    const inverses = generateInverseEvents(event, 2);

    expect(inverses).toHaveLength(0);
  });
});

// ============================================================================
// NODE HELPERS
// ============================================================================

describe('Node Helpers', () => {
  describe('createTextNode', () => {
    it('should create a text node with content', () => {
      const node = createTextNode('Hello, world!');

      expect(node.type).toBe('text');
      expect(node.content).toBe('Hello, world!');
      expect(node.version).toBe(1);
      expect(node.id).toMatch(/^node-/);
      expect(node.updatedAt).toMatch(/^\d{4}-/);
    });

    it('should create unique IDs for each node', () => {
      const node1 = createTextNode('First');
      const node2 = createTextNode('Second');

      expect(node1.id).not.toBe(node2.id);
    });
  });

  describe('createParagraphNode', () => {
    it('should create a paragraph with child nodes', () => {
      const textNode = createTextNode('Hello');
      const para = createParagraphNode([textNode]);

      expect(para.type).toBe('paragraph');
      expect(para.children).toHaveLength(1);
      expect(para.children[0]).toBe(textNode);
      expect(para.version).toBe(1);
    });

    it('should create paragraph with empty children', () => {
      const para = createParagraphNode([]);

      expect(para.type).toBe('paragraph');
      expect(para.children).toHaveLength(0);
    });
  });
});
