/**
 * Phase D: Serialization Tests
 *
 * Tests for:
 * - Full state serialization/deserialization
 * - Compact state serialization/deserialization
 * - Index rebuilding
 * - Validation
 * - Event serialization
 */

import { describe, it, expect } from 'vitest';
import {
  serializeDocumentState,
  deserializeDocumentState,
  compactSerialize,
  compactDeserialize,
  validateDocumentState,
  buildNodeIndex,
  buildQuoteIndex,
  buildExtracted,
} from '../serialization/stateSerializer';
import {
  serializeEvent,
  deserializeEvent,
  serializeEventLog,
  deserializeEventLog,
  extractEventIds,
  filterEventsByType,
  getLatestVersion,
} from '../serialization/eventSerializer';
import type { DocumentState, DocumentEvent, NodeCreatedEvent, EventId, DocumentRootNode, ParagraphNode, TextNode, QuoteBlockNode, NodeId } from '../../../../shared/documentModel';

// ============================================================================
// TEST HELPER FUNCTIONS (Local Definitions)
// ============================================================================

function createTextNode(id: string, content: string): TextNode {
  return {
    id: id as NodeId,
    type: 'text',
    version: 1,
    updatedAt: new Date().toISOString(),
    content,
  };
}

function createParagraphNode(id: string, children: TextNode[]): ParagraphNode {
  return {
    id: id as NodeId,
    type: 'paragraph',
    version: 1,
    updatedAt: new Date().toISOString(),
    children,
  };
}

function createQuoteBlockNode(
  id: string,
  text: string,
  reference: string,
  book: string,
  confidence: number = 0.95
): QuoteBlockNode {
  const textNode = createTextNode(`${id}-text`, text);
  return {
    id: id as NodeId,
    type: 'quote_block',
    version: 1,
    updatedAt: new Date().toISOString(),
    metadata: {
      reference: {
        book,
        chapter: 3,
        verseStart: 16,
        verseEnd: null,
        originalText: reference,
        normalizedReference: reference,
      },
      detection: {
        confidence,
        confidenceLevel: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        translation: 'ESV',
        translationAutoDetected: true,
        verseText: text,
        isPartialMatch: false,
      },
      interjections: [],
      userVerified: false,
    },
    children: [textNode],
  };
}

function createDocumentRootNode(
  children: (ParagraphNode | QuoteBlockNode)[],
  options: { title?: string; biblePassage?: string } = {}
): DocumentRootNode {
  return {
    id: 'root-1' as NodeId,
    type: 'document',
    version: 1,
    updatedAt: new Date().toISOString(),
    title: options.title,
    biblePassage: options.biblePassage,
    children,
  };
}

function createDocumentState(root: DocumentRootNode): DocumentState {
  const now = new Date().toISOString();
  const nodeIndex: DocumentState['nodeIndex'] = {};
  const quoteIndex: DocumentState['quoteIndex'] = { byReference: {}, byBook: {}, all: [] };

  // Build indexes
  function indexNode(node: DocumentRootNode | ParagraphNode | QuoteBlockNode | TextNode, parentId: NodeId | null, path: NodeId[]) {
    nodeIndex[node.id] = { node, parentId, path };

    if (node.type === 'quote_block') {
      const quote = node as QuoteBlockNode;
      const ref = quote.metadata.reference.normalizedReference;
      const book = quote.metadata.reference.book;

      if (!quoteIndex.byReference[ref]) {
        quoteIndex.byReference[ref] = [];
      }
      quoteIndex.byReference[ref].push(quote.id);

      if (!quoteIndex.byBook[book]) {
        quoteIndex.byBook[book] = [];
      }
      quoteIndex.byBook[book].push(quote.id);

      quoteIndex.all.push(quote.id);
    }

    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach((child) => {
        indexNode(child as DocumentRootNode | ParagraphNode | QuoteBlockNode | TextNode, node.id, [...path, node.id]);
      });
    }
  }

  indexNode(root, null, []);

  return {
    version: 1,
    root,
    eventLog: [],
    undoStack: [],
    redoStack: [],
    nodeIndex,
    quoteIndex,
    extracted: { references: quoteIndex.all.length > 0 ? ['John 3:16'] : [], tags: [] },
    lastModified: now,
    createdAt: now,
  };
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestDocumentState(): DocumentState {
  // Create a simple document with one paragraph and one quote
  const textNode = createTextNode('text-1', 'Hello, world!');
  const paragraphNode = createParagraphNode('para-1', [textNode]);
  const quoteNode = createQuoteBlockNode(
    'quote-1',
    'For God so loved the world...',
    'John 3:16',
    'John',
    0.95
  );
  const rootNode = createDocumentRootNode([paragraphNode, quoteNode], {
    title: 'Test Document',
    biblePassage: 'John 3:16',
  });

  return createDocumentState(rootNode);
}

function createTestEvent(): NodeCreatedEvent {
  const textNode: TextNode = {
    id: 'node-test-1' as NodeId,
    type: 'text',
    version: 1,
    updatedAt: new Date().toISOString(),
    content: 'Test content',
  };
  return {
    id: 'evt-test-1' as EventId,
    type: 'node_created',
    timestamp: new Date().toISOString(),
    resultingVersion: 1,
    source: 'system',
    node: textNode,
    parentId: 'node-root' as NodeId,
    index: 0,
  };
}

// ============================================================================
// FULL SERIALIZATION TESTS
// ============================================================================

describe('Full State Serialization', () => {
  it('should serialize and deserialize document state', () => {
    const state = createTestDocumentState();
    const json = serializeDocumentState(state);
    const result = deserializeDocumentState(json);

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
    expect(result.state?.version).toBe(state.version);
    expect(result.state?.root.type).toBe('document');
    expect(result.state?.root.children.length).toBe(state.root.children.length);
  });

  it('should support pretty printing', () => {
    const state = createTestDocumentState();
    const compact = serializeDocumentState(state);
    const pretty = serializeDocumentState(state, { pretty: true });

    expect(pretty.length).toBeGreaterThan(compact.length);
    expect(pretty).toContain('\n');
    expect(pretty).toContain('  ');
  });

  it('should handle excludeEventLog option', () => {
    const state = createTestDocumentState();
    state.eventLog = [createTestEvent()];

    const withEvents = serializeDocumentState(state);
    const withoutEvents = serializeDocumentState(state, { includeEventLog: false });

    const parsedWith = JSON.parse(withEvents);
    const parsedWithout = JSON.parse(withoutEvents);

    expect(parsedWith.state.eventLog.length).toBe(1);
    expect(parsedWithout.state.eventLog.length).toBe(0);
  });

  it('should handle maxEvents option', () => {
    const state = createTestDocumentState();
    state.eventLog = [
      { ...createTestEvent(), id: 'evt-1', resultingVersion: 1 },
      { ...createTestEvent(), id: 'evt-2', resultingVersion: 2 },
      { ...createTestEvent(), id: 'evt-3', resultingVersion: 3 },
    ];

    const limited = serializeDocumentState(state, { maxEvents: 2 });
    const parsed = JSON.parse(limited);

    expect(parsed.state.eventLog.length).toBe(2);
    expect(parsed.state.eventLog[0].id).toBe('evt-2'); // Keeps most recent
    expect(parsed.state.eventLog[1].id).toBe('evt-3');
  });

  it('should handle null/empty input', () => {
    const nullResult = deserializeDocumentState(null);
    expect(nullResult.success).toBe(false);
    expect(nullResult.error).toBe('No data provided');

    const emptyResult = deserializeDocumentState('');
    expect(emptyResult.success).toBe(false);
  });

  it('should handle invalid JSON', () => {
    const result = deserializeDocumentState('not valid json{');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Parse error');
  });

  it('should preserve schema version', () => {
    const state = createTestDocumentState();
    const json = serializeDocumentState(state);
    const parsed = JSON.parse(json);

    expect(parsed.schemaVersion).toBe(1);
  });
});

// ============================================================================
// COMPACT SERIALIZATION TESTS
// ============================================================================

describe('Compact State Serialization', () => {
  it('should serialize and deserialize with index rebuilding', () => {
    const state = createTestDocumentState();
    const json = compactSerialize(state);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
    expect(result.state?.root.id).toBe(state.root.id);

    // Verify indexes were rebuilt
    expect(Object.keys(result.state?.nodeIndex || {}).length).toBeGreaterThan(0);
    expect(result.state?.quoteIndex.all.length).toBeGreaterThan(0);
  });

  it('should produce smaller output than full serialization', () => {
    const state = createTestDocumentState();
    const full = serializeDocumentState(state);
    const compact = compactSerialize(state);

    // Compact should be smaller (no indexes)
    expect(compact.length).toBeLessThan(full.length);
  });

  it('should rebuild nodeIndex correctly', () => {
    const state = createTestDocumentState();
    const json = compactSerialize(state);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);
    const nodeIndex = result.state?.nodeIndex || {};

    // Should contain root and all children
    expect(nodeIndex[state.root.id]).toBeDefined();
    expect(nodeIndex[state.root.id]!.parentId).toBeNull();
    expect(nodeIndex[state.root.id]!.path).toEqual([]);

    // Should contain child nodes with correct parent
    for (const child of state.root.children) {
      expect(nodeIndex[child.id]).toBeDefined();
      expect(nodeIndex[child.id]!.parentId).toBe(state.root.id);
      expect(nodeIndex[child.id]!.path).toContain(state.root.id);
    }
  });

  it('should rebuild quoteIndex correctly', () => {
    const state = createTestDocumentState();
    const json = compactSerialize(state);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);
    const quoteIndex = result.state?.quoteIndex;

    expect(quoteIndex?.all.length).toBe(1);
    expect(quoteIndex?.byBook['John']).toBeDefined();
    expect(quoteIndex?.byBook['John']!.length).toBe(1);
    expect(quoteIndex?.byReference['John 3:16']).toBeDefined();
    expect(quoteIndex?.byReference['John 3:16']!.length).toBe(1);
  });

  it('should rebuild extracted references correctly', () => {
    const state = createTestDocumentState();
    const json = compactSerialize(state);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);
    const extracted = result.state?.extracted;

    expect(extracted?.references).toContain('John 3:16');
  });

  it('should preserve timestamps', () => {
    const state = createTestDocumentState();
    const json = compactSerialize(state);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);
    expect(result.state?.lastModified).toBe(state.lastModified);
    expect(result.state?.createdAt).toBe(state.createdAt);
  });

  it('should handle empty document', () => {
    const rootNode = createDocumentRootNode([], {});
    const state = createDocumentState(rootNode);
    const json = compactSerialize(state);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);
    expect(result.state?.root.children.length).toBe(0);
    expect(result.state?.quoteIndex.all.length).toBe(0);
  });
});

// ============================================================================
// INDEX REBUILDING TESTS
// ============================================================================

describe('Index Building', () => {
  describe('buildNodeIndex', () => {
    it('should index all nodes with correct paths', () => {
      const state = createTestDocumentState();
      const index = buildNodeIndex(state.root);

      // Root should be indexed
      expect(index[state.root.id]).toBeDefined();
      expect(index[state.root.id]!.parentId).toBeNull();
      expect(index[state.root.id]!.path).toEqual([]);

      // Count total nodes
      const nodeCount = Object.keys(index).length;
      expect(nodeCount).toBeGreaterThan(1);
    });

    it('should track parent relationships', () => {
      const state = createTestDocumentState();
      const index = buildNodeIndex(state.root);

      for (const child of state.root.children) {
        expect(index[child.id]!.parentId).toBe(state.root.id);
      }
    });

    it('should build correct paths', () => {
      const state = createTestDocumentState();
      const index = buildNodeIndex(state.root);

      // Root path is empty
      expect(index[state.root.id]!.path).toEqual([]);

      // Children of root have path containing root
      for (const child of state.root.children) {
        expect(index[child.id]!.path).toEqual([state.root.id]);
      }
    });
  });

  describe('buildQuoteIndex', () => {
    it('should index quotes by reference', () => {
      const state = createTestDocumentState();
      const nodeIndex = buildNodeIndex(state.root);
      const quoteIndex = buildQuoteIndex(state.root, nodeIndex);

      expect(quoteIndex.byReference['John 3:16']).toBeDefined();
      expect(quoteIndex.byReference['John 3:16']!.length).toBe(1);
    });

    it('should index quotes by book', () => {
      const state = createTestDocumentState();
      const nodeIndex = buildNodeIndex(state.root);
      const quoteIndex = buildQuoteIndex(state.root, nodeIndex);

      expect(quoteIndex.byBook['John']).toBeDefined();
      expect(quoteIndex.byBook['John']!.length).toBe(1);
    });

    it('should maintain all quotes list', () => {
      const state = createTestDocumentState();
      const nodeIndex = buildNodeIndex(state.root);
      const quoteIndex = buildQuoteIndex(state.root, nodeIndex);

      expect(quoteIndex.all.length).toBe(1);
    });

    it('should handle empty document', () => {
      const rootNode = createDocumentRootNode([], {});
      const nodeIndex = buildNodeIndex(rootNode);
      const quoteIndex = buildQuoteIndex(rootNode, nodeIndex);

      expect(quoteIndex.all.length).toBe(0);
      expect(Object.keys(quoteIndex.byReference).length).toBe(0);
      expect(Object.keys(quoteIndex.byBook).length).toBe(0);
    });
  });

  describe('buildExtracted', () => {
    it('should extract unique references', () => {
      const state = createTestDocumentState();
      const nodeIndex = buildNodeIndex(state.root);
      const extracted = buildExtracted(state.root, nodeIndex);

      expect(extracted.references).toContain('John 3:16');
      expect(extracted.references.length).toBe(1);
    });

    it('should return empty arrays for empty document', () => {
      const rootNode = createDocumentRootNode([], {});
      const nodeIndex = buildNodeIndex(rootNode);
      const extracted = buildExtracted(rootNode, nodeIndex);

      expect(extracted.references).toEqual([]);
      expect(extracted.tags).toEqual([]);
    });
  });
});

// ============================================================================
// VALIDATION TESTS
// ============================================================================

describe('Validation', () => {
  it('should validate correct state', () => {
    const state = createTestDocumentState();
    const result = validateDocumentState(state);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('should reject non-object input', () => {
    const result = validateDocumentState(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('State must be an object');
  });

  it('should require version field', () => {
    const state = { root: { type: 'document', id: 'root-1' } };
    const result = validateDocumentState(state);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('should require root field', () => {
    const state = { version: 1 };
    const result = validateDocumentState(state);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('root'))).toBe(true);
  });

  it('should validate root type', () => {
    const state = { version: 1, root: { type: 'paragraph', id: 'p-1' } };
    const result = validateDocumentState(state);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Root type'))).toBe(true);
  });

  it('should warn about missing indexes', () => {
    const state = {
      version: 1,
      root: { type: 'document', id: 'root-1', children: [] },
    };
    const result = validateDocumentState(state);

    expect(result.warnings.some((w) => w.includes('nodeIndex'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('quoteIndex'))).toBe(true);
  });
});

// ============================================================================
// EVENT SERIALIZATION TESTS
// ============================================================================

describe('Event Serialization', () => {
  describe('serializeEvent / deserializeEvent', () => {
    it('should serialize and deserialize single event', () => {
      const event = createTestEvent();
      const json = serializeEvent(event);
      const result = deserializeEvent(json);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(event.id);
      expect(result?.type).toBe(event.type);
    });

    it('should return null for invalid event', () => {
      const result = deserializeEvent('{"invalid": "data"}');
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const result = deserializeEvent('not json');
      expect(result).toBeNull();
    });
  });

  describe('serializeEventLog / deserializeEventLog', () => {
    it('should serialize and deserialize event array', () => {
      const events = [
        { ...createTestEvent(), id: 'evt-1' },
        { ...createTestEvent(), id: 'evt-2' },
      ];
      const json = serializeEventLog(events);
      const result = deserializeEventLog(json);

      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe('evt-1');
      expect(result[1]!.id).toBe('evt-2');
    });

    it('should filter invalid events from array', () => {
      const json = JSON.stringify([
        createTestEvent(),
        { invalid: 'data' },
        { ...createTestEvent(), id: 'evt-2' },
      ]);
      const result = deserializeEventLog(json);

      expect(result.length).toBe(2);
    });

    it('should return empty array for invalid JSON', () => {
      const result = deserializeEventLog('not json');
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array', () => {
      const result = deserializeEventLog('{"not": "array"}');
      expect(result).toEqual([]);
    });
  });

  describe('extractEventIds', () => {
    it('should extract all event IDs', () => {
      const events = [
        { ...createTestEvent(), id: 'evt-1' } as DocumentEvent,
        { ...createTestEvent(), id: 'evt-2' } as DocumentEvent,
      ];
      const ids = extractEventIds(events);

      expect(ids).toEqual(['evt-1', 'evt-2']);
    });
  });

  describe('filterEventsByType', () => {
    it('should filter events by type', () => {
      const textChangedEvent: DocumentEvent = {
        id: 'evt-2' as EventId,
        type: 'text_changed',
        timestamp: new Date().toISOString(),
        resultingVersion: 2,
        source: 'user',
        nodeId: 'node-1' as NodeId,
        previousContent: 'old',
        newContent: 'new',
        offset: 0,
        deleteCount: 3,
        insertedText: 'new',
      };
      const events: DocumentEvent[] = [
        { ...createTestEvent(), id: 'evt-1' as EventId } as DocumentEvent,
        textChangedEvent,
      ];

      const nodeCreated = filterEventsByType(events, 'node_created');
      expect(nodeCreated.length).toBe(1);
      expect(nodeCreated[0]!.id).toBe('evt-1');
    });
  });

  describe('getLatestVersion', () => {
    it('should return highest version number', () => {
      const events: DocumentEvent[] = [
        { ...createTestEvent(), resultingVersion: 1 } as DocumentEvent,
        { ...createTestEvent(), resultingVersion: 5 } as DocumentEvent,
        { ...createTestEvent(), resultingVersion: 3 } as DocumentEvent,
      ];
      const version = getLatestVersion(events);

      expect(version).toBe(5);
    });

    it('should return 0 for empty array', () => {
      const version = getLatestVersion([]);
      expect(version).toBe(0);
    });
  });
});

// ============================================================================
// ROUND-TRIP TESTS
// ============================================================================

describe('Serialization Round-Trips', () => {
  it('should preserve data through full round-trip', () => {
    const original = createTestDocumentState();
    const json = serializeDocumentState(original);
    const result = deserializeDocumentState(json);

    expect(result.success).toBe(true);
    expect(result.state?.version).toBe(original.version);
    expect(result.state?.root.title).toBe(original.root.title);
    expect(result.state?.root.biblePassage).toBe(original.root.biblePassage);
    expect(result.state?.root.children.length).toBe(original.root.children.length);
  });

  it('should preserve data through compact round-trip', () => {
    const original = createTestDocumentState();
    const json = compactSerialize(original);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);
    expect(result.state?.version).toBe(original.version);
    expect(result.state?.root.title).toBe(original.root.title);
    expect(result.state?.root.biblePassage).toBe(original.root.biblePassage);
    expect(result.state?.root.children.length).toBe(original.root.children.length);
  });

  it('should preserve quote metadata through round-trip', () => {
    const original = createTestDocumentState();
    const json = compactSerialize(original);
    const result = compactDeserialize(json);

    expect(result.success).toBe(true);

    // Find the quote node
    const quoteId = result.state?.quoteIndex.all[0];
    expect(quoteId).toBeDefined();

    const quoteEntry = result.state?.nodeIndex[quoteId!];
    expect(quoteEntry).toBeDefined();

    const quoteNode = quoteEntry?.node;
    expect(quoteNode?.type).toBe('quote_block');
    if (quoteNode?.type === 'quote_block') {
      expect(quoteNode.metadata.reference.book).toBe('John');
      expect(quoteNode.metadata.reference.normalizedReference).toBe('John 3:16');
      expect(quoteNode.metadata.detection?.confidence).toBe(0.95);
    }
  });

  it('should handle multiple serialization cycles', () => {
    let state = createTestDocumentState();

    for (let i = 0; i < 3; i++) {
      const json = compactSerialize(state);
      const result = compactDeserialize(json);
      expect(result.success).toBe(true);
      state = result.state!;
    }

    expect(state.root.title).toBe('Test Document');
    expect(state.quoteIndex.all.length).toBe(1);
  });
});
