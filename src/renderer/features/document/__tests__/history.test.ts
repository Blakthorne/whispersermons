/**
 * Phase D: History Integration Tests
 *
 * Tests for:
 * - Creating history items with document state
 * - Restoring document state from history
 * - Migrating legacy history items
 * - Storage size estimation
 * - Event log pruning
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createHistoryItemWithState,
  updateHistoryItemState,
  restoreFromHistoryItem,
  hasDocumentState,
  hasNewFormatState,
  migrateHistoryItem,
  estimateStorageSize,
  pruneEventLog,
  eventLogSize,
  type HistoryItemWithState,
} from '../history/documentHistory';
import type { DocumentState, DocumentEvent, DocumentRootNode, ParagraphNode, TextNode, NodeId } from '../../../../shared/documentModel';
import type { HistoryItem, SermonDocument } from '../../../../shared/types';

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

function createDocumentRootNode(
  children: ParagraphNode[],
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
  
  // Build simple index
  nodeIndex[root.id] = { node: root, parentId: null, path: [] };
  for (const child of root.children) {
    nodeIndex[child.id] = { node: child, parentId: root.id, path: [root.id] };
    if ('children' in child) {
      for (const textNode of child.children) {
        nodeIndex[textNode.id] = { node: textNode, parentId: child.id, path: [root.id, child.id] };
      }
    }
  }

  return {
    version: 1,
    root,
    eventLog: [],
    undoStack: [],
    redoStack: [],
    nodeIndex,
    passageIndex: { byReference: {}, byBook: {}, all: [] },
    extracted: { references: [], tags: [] },
    lastModified: now,
    createdAt: now,
  };
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestDocumentState(): DocumentState {
  const textNode = createTextNode('text-1', 'Test content');
  const paragraphNode = createParagraphNode('para-1', [textNode]);
  const rootNode = createDocumentRootNode([paragraphNode], { title: 'Test' });
  return createDocumentState(rootNode);
}

function createTestHistoryItem(): Omit<HistoryItem, 'id'> {
  return {
    date: new Date().toISOString(),
    fileName: 'audio.mp3',
    filePath: '/test/audio.mp3',
    model: 'base',
    language: 'en',
    duration: 120,
    preview: 'Test transcription...',
    fullText: 'Test transcription text',
  };
}

function createSermonDocumentWithState(state: DocumentState): SermonDocument {
  return {
    references: [],
    tags: [],
    body: 'Test body',
    rawTranscript: 'Test transcript',
    documentState: state,
  };
}

function createFullHistoryItem(): HistoryItem {
  return {
    id: 'hist-123',
    ...createTestHistoryItem(),
  };
}

// Note: createLegacyHistoryItem removed - legacy HTML items no longer supported

function createTestEvent(version: number): DocumentEvent {
  const textNode = createTextNode(`text-${version}`, 'Test');
  const paragraph = createParagraphNode(`node-${version}`, [textNode]);
  return {
    id: `evt-${version}`,
    type: 'node_created',
    timestamp: new Date().toISOString(),
    resultingVersion: version,
    source: 'system',
    node: paragraph,
    parentId: 'root-1',
    index: 0,
  } as DocumentEvent;
}

// ============================================================================
// CREATE HISTORY ITEM TESTS
// ============================================================================

describe('createHistoryItemWithState', () => {
  it('should create history item with serialized document state', () => {
    const baseItem = createTestHistoryItem();
    const state = createTestDocumentState();
    const result = createHistoryItemWithState(baseItem, state);

    expect(result.documentStateJson).toBeDefined();
    expect(typeof result.documentStateJson).toBe('string');
    expect(result.date).toBe(baseItem.date);
    expect(result.filePath).toBe(baseItem.filePath);
  });

  it('should handle null document state', () => {
    const baseItem = createTestHistoryItem();
    const result = createHistoryItemWithState(baseItem, null);

    expect(result.documentStateJson).toBeUndefined();
    expect(result.date).toBe(baseItem.date);
  });

  it('should respect includeEventLog option', () => {
    const baseItem = createTestHistoryItem();
    const state = createTestDocumentState();
    state.eventLog = [createTestEvent(1), createTestEvent(2)];

    const withEvents = createHistoryItemWithState(baseItem, state, { includeEventLog: true });
    const withoutEvents = createHistoryItemWithState(baseItem, state, { includeEventLog: false });

    // Parse to check
    const parsedWith = JSON.parse(withEvents.documentStateJson!);
    const parsedWithout = JSON.parse(withoutEvents.documentStateJson!);

    expect(parsedWith.eventLog.length).toBe(2);
    expect(parsedWithout.eventLog.length).toBe(0);
  });

  it('should respect maxEvents option', () => {
    const baseItem = createTestHistoryItem();
    const state = createTestDocumentState();
    state.eventLog = [createTestEvent(1), createTestEvent(2), createTestEvent(3)];

    const result = createHistoryItemWithState(baseItem, state, { maxEvents: 2 });
    const parsed = JSON.parse(result.documentStateJson!);

    expect(parsed.eventLog.length).toBe(2);
    // Should keep most recent events
    expect(parsed.eventLog[0].resultingVersion).toBe(2);
    expect(parsed.eventLog[1].resultingVersion).toBe(3);
  });
});

// ============================================================================
// UPDATE HISTORY ITEM TESTS
// ============================================================================

describe('updateHistoryItemState', () => {
  it('should update existing item with new document state', () => {
    const item = createFullHistoryItem();
    const state = createTestDocumentState();
    const result = updateHistoryItemState(item, state);

    expect(result.documentStateJson).toBeDefined();
    expect(result.id).toBe(item.id);
    expect(result.date).toBe(item.date);
  });

  // Note: documentHtml backward compatibility tests removed (AST-only architecture)

  it('should respect options when updating', () => {
    const item = createFullHistoryItem();
    const state = createTestDocumentState();
    state.eventLog = [createTestEvent(1), createTestEvent(2), createTestEvent(3)];

    const result = updateHistoryItemState(item, state, { maxEvents: 1 });
    const parsed = JSON.parse(result.documentStateJson!);

    expect(parsed.eventLog.length).toBe(1);
  });
});

// ============================================================================
// RESTORE FROM HISTORY TESTS
// ============================================================================

describe('restoreFromHistoryItem', () => {
  it('should restore from documentStateJson', () => {
    const state = createTestDocumentState();
    const baseItem = createTestHistoryItem();
    const historyItem = createHistoryItemWithState(baseItem, state);
    const fullItem: HistoryItem = { id: 'hist-1', ...historyItem };

    const result = restoreFromHistoryItem(fullItem as HistoryItemWithState);

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
    expect(result.isLegacy).toBe(false);
    expect(result.state?.root.title).toBe('Test');
  });

  it('should restore from sermonDocument.documentState', () => {
    const state = createTestDocumentState();
    const item: HistoryItem = {
      ...createFullHistoryItem(),
      sermonDocument: createSermonDocumentWithState(state),
    };

    const result = restoreFromHistoryItem(item);

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
    expect(result.isLegacy).toBe(false);
  });

  // Note: Legacy HTML fallback tests removed (AST-only architecture)

  it('should return error when no document data available', () => {
    const item = createFullHistoryItem();
    // No documentStateJson or sermonDocument.documentState
    const result = restoreFromHistoryItem(item);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Note: isLegacy is now always false since legacy support removed
    expect(result.isLegacy).toBe(false);
  });

  it('should handle corrupted documentStateJson', () => {
    const item: HistoryItemWithState = {
      ...createFullHistoryItem(),
      documentStateJson: 'invalid json{',
    };
    const result = restoreFromHistoryItem(item);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Parse error');
  });
});

// ============================================================================
// HAS DOCUMENT STATE TESTS
// ============================================================================

describe('hasDocumentState', () => {
  it('should return true for documentStateJson', () => {
    const state = createTestDocumentState();
    const baseItem = createTestHistoryItem();
    const historyItem = createHistoryItemWithState(baseItem, state);
    const fullItem: HistoryItem = { id: 'hist-1', ...historyItem };

    expect(hasDocumentState(fullItem as HistoryItemWithState)).toBe(true);
  });

  it('should return true for sermonDocument.documentState', () => {
    const state = createTestDocumentState();
    const item: HistoryItem = {
      ...createFullHistoryItem(),
      sermonDocument: createSermonDocumentWithState(state),
    };

    expect(hasDocumentState(item)).toBe(true);
  });

  // Note: Legacy HTML test removed (AST-only architecture - documentHtml no longer supported)

  it('should return false when no document data', () => {
    const item = createFullHistoryItem();
    expect(hasDocumentState(item)).toBe(false);
  });
});

// ============================================================================
// HAS NEW FORMAT STATE TESTS
// ============================================================================

describe('hasNewFormatState', () => {
  it('should return true for documentStateJson', () => {
    const state = createTestDocumentState();
    const baseItem = createTestHistoryItem();
    const historyItem = createHistoryItemWithState(baseItem, state);
    const fullItem: HistoryItem = { id: 'hist-1', ...historyItem };

    expect(hasNewFormatState(fullItem as HistoryItemWithState)).toBe(true);
  });

  it('should return true for sermonDocument.documentState', () => {
    const state = createTestDocumentState();
    const item: HistoryItem = {
      ...createFullHistoryItem(),
      sermonDocument: createSermonDocumentWithState(state),
    };

    expect(hasNewFormatState(item)).toBe(true);
  });

  // Note: Legacy HTML test removed (AST-only architecture - documentHtml no longer supported)

  it('should return false when no document data', () => {
    const item = createFullHistoryItem();
    expect(hasNewFormatState(item)).toBe(false);
  });
});

// ============================================================================
// MIGRATE HISTORY ITEM TESTS
// ============================================================================

describe('migrateHistoryItem', () => {
  it('should return existing item if already has new format', () => {
    const state = createTestDocumentState();
    const baseItem = createTestHistoryItem();
    const historyItem = createHistoryItemWithState(baseItem, state);
    const fullItem: HistoryItem = { id: 'hist-1', ...historyItem };

    const mockConverter = vi.fn();
    const result = migrateHistoryItem(fullItem, mockConverter);

    expect(result).toBeDefined();
    expect(mockConverter).not.toHaveBeenCalled();
  });

  // Note: Legacy HTML conversion tests removed (AST-only architecture)
  // migrateHistoryItem now returns null for items without DocumentState

  it('should return null if no DocumentState available', () => {
    const item = createFullHistoryItem();
    const mockConverter = vi.fn();

    const result = migrateHistoryItem(item, mockConverter);

    expect(result).toBeNull();
    expect(mockConverter).not.toHaveBeenCalled();
  });
});

// ============================================================================
// STORAGE SIZE UTILITIES TESTS
// ============================================================================

describe('estimateStorageSize', () => {
  it('should estimate storage size in bytes', () => {
    const state = createTestDocumentState();
    const baseItem = createTestHistoryItem();
    const historyItem = createHistoryItemWithState(baseItem, state);
    const fullItem: HistoryItemWithState = { id: 'hist-1', ...historyItem };

    const size = estimateStorageSize(fullItem);

    expect(size).toBeGreaterThan(0);
    // Should be roughly 2x the JSON string length (UTF-16)
    const jsonLength = JSON.stringify(fullItem).length;
    expect(size).toBe(jsonLength * 2);
  });

  it('should increase with larger document state', () => {
    const smallState = createTestDocumentState();
    const baseItem = createTestHistoryItem();

    // Create larger state with more events
    const largeState = createTestDocumentState();
    for (let i = 1; i <= 100; i++) {
      largeState.eventLog.push(createTestEvent(i));
    }

    const smallItem = createHistoryItemWithState(baseItem, smallState);
    const largeItem = createHistoryItemWithState(baseItem, largeState);

    const smallSize = estimateStorageSize({ id: 'small', ...smallItem });
    const largeSize = estimateStorageSize({ id: 'large', ...largeItem });

    expect(largeSize).toBeGreaterThan(smallSize);
  });
});

describe('pruneEventLog', () => {
  it('should prune events to max count', () => {
    const state = createTestDocumentState();
    state.eventLog = [];
    for (let i = 1; i <= 10; i++) {
      state.eventLog.push(createTestEvent(i));
    }

    const pruned = pruneEventLog(state, 5);

    expect(pruned.eventLog.length).toBe(5);
    // Should keep most recent
    expect(pruned.eventLog[0]!.resultingVersion).toBe(6);
    expect(pruned.eventLog[4]!.resultingVersion).toBe(10);
  });

  it('should clear undo/redo stacks when pruning', () => {
    const state = createTestDocumentState();
    state.eventLog = [];
    for (let i = 1; i <= 10; i++) {
      state.eventLog.push(createTestEvent(i));
    }
    state.undoStack = ['evt-1', 'evt-2'];
    state.redoStack = ['evt-3'];

    const pruned = pruneEventLog(state, 5);

    expect(pruned.undoStack).toEqual([]);
    expect(pruned.redoStack).toEqual([]);
  });

  it('should return original state if under limit', () => {
    const state = createTestDocumentState();
    state.eventLog = [createTestEvent(1), createTestEvent(2)];
    state.undoStack = ['evt-1'];

    const pruned = pruneEventLog(state, 10);

    expect(pruned.eventLog.length).toBe(2);
    expect(pruned.undoStack).toEqual(['evt-1']); // Preserved
  });

  it('should not mutate original state', () => {
    const state = createTestDocumentState();
    state.eventLog = [];
    for (let i = 1; i <= 10; i++) {
      state.eventLog.push(createTestEvent(i));
    }

    const pruned = pruneEventLog(state, 5);

    expect(state.eventLog.length).toBe(10); // Original unchanged
    expect(pruned.eventLog.length).toBe(5);
    expect(pruned).not.toBe(state);
  });
});

describe('eventLogSize', () => {
  it('should calculate event log size in bytes', () => {
    const events = [createTestEvent(1), createTestEvent(2)];
    const size = eventLogSize(events);

    expect(size).toBeGreaterThan(0);
    // Should be roughly 2x JSON string length
    const jsonLength = JSON.stringify(events).length;
    expect(size).toBe(jsonLength * 2);
  });

  it('should return 4 for empty event log', () => {
    const size = eventLogSize([]);
    // "[]" = 2 chars * 2 bytes = 4 bytes
    expect(size).toBe(4);
  });

  it('should scale with event count', () => {
    const small = [createTestEvent(1)];
    const large = [];
    for (let i = 1; i <= 100; i++) {
      large.push(createTestEvent(i));
    }

    const smallSize = eventLogSize(small);
    const largeSize = eventLogSize(large);

    expect(largeSize).toBeGreaterThan(smallSize * 50); // Not exactly 100x due to array overhead
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('History Integration', () => {
  it('should complete full save/restore cycle', () => {
    // Create document state
    const originalState = createTestDocumentState();
    originalState.eventLog = [createTestEvent(1), createTestEvent(2)];

    // Save to history
    const baseItem = createTestHistoryItem();
    const historyItem = createHistoryItemWithState(baseItem, originalState);
    const savedItem: HistoryItemWithState = { id: 'hist-test', ...historyItem };

    // Restore from history
    const result = restoreFromHistoryItem(savedItem);

    expect(result.success).toBe(true);
    expect(result.state?.root.title).toBe(originalState.root.title);
    expect(result.state?.version).toBe(originalState.version);
    expect(result.state?.eventLog.length).toBe(2);
  });

  it('should handle update and restore cycle', () => {
    // Initial save
    const state1 = createTestDocumentState();
    const item: HistoryItem = {
      id: 'hist-update',
      ...createTestHistoryItem(),
    };
    const saved1 = updateHistoryItemState(item, state1);

    // Update with new state
    const state2 = createTestDocumentState();
    state2.root.title = 'Updated Title';
    const saved2 = updateHistoryItemState(saved1, state2);

    // Restore should get updated state
    const result = restoreFromHistoryItem(saved2);

    expect(result.success).toBe(true);
    expect(result.state?.root.title).toBe('Updated Title');
  });

  it('should gracefully handle missing data', () => {
    const emptyItem: HistoryItem = {
      id: 'hist-empty',
      date: new Date().toISOString(),
      fileName: 'test.mp3',
      filePath: '/test.mp3',
      preview: '',
      fullText: '',
      duration: 0,
      model: 'base',
      language: 'en',
    };

    expect(hasDocumentState(emptyItem)).toBe(false);
    expect(hasNewFormatState(emptyItem)).toBe(false);

    const result = restoreFromHistoryItem(emptyItem);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
