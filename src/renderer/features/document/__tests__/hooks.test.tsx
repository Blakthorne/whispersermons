/**
 * Document Hooks Tests
 *
 * Tests for useDocument, usePassages, and useNode hooks.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DocumentProvider } from '../DocumentContext';
import { useDocument } from '../hooks/useDocument';
import { usePassages } from '../hooks/usePassages';
import { useNode, useNodeTraversal } from '../hooks/useNode';
import type {
  DocumentState,
  DocumentRootNode,
  ParagraphNode,
  TextNode,
  PassageNode,
} from '../../../../shared/documentModel';
import type { SermonDocument } from '../../../types';

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTextNode(id: string, content: string): TextNode {
  return {
    id,
    type: 'text',
    version: 1,
    updatedAt: new Date().toISOString(),
    content,
  };
}

function createParagraphNode(id: string, children: TextNode[]): ParagraphNode {
  return {
    id,
    type: 'paragraph',
    version: 1,
    updatedAt: new Date().toISOString(),
    children,
  };
}

function createPassageNode(id: string, text: string, reference: string, book: string): PassageNode {
  const textNode = createTextNode(`${id}-text`, text);
  return {
    id,
    type: 'passage',
    version: 1,
    updatedAt: new Date().toISOString(),
    metadata: {
      reference: {
        book,
        chapter: 1,
        verseStart: 1,
        verseEnd: null,
        originalText: reference,
        normalizedReference: reference,
      },
      detection: {
        confidence: 0.85,
        confidenceLevel: 'high',
        translation: 'KJV',
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

function createTestDocumentState(): DocumentState {
  const now = new Date().toISOString();

  const textNode1 = createTextNode('text-1', 'Hello world.');
  const textNode2 = createTextNode('text-2', 'Second paragraph.');
  const para1 = createParagraphNode('para-1', [textNode1]);
  const para2 = createParagraphNode('para-2', [textNode2]);
  const quote1 = createPassageNode('passage-1', 'For God so loved the world.', 'John 3:16', 'John');
  const quote2 = createPassageNode(
    'passage-2',
    'In the beginning was the Word.',
    'John 1:1',
    'John'
  );

  const root: DocumentRootNode = {
    id: 'doc-root',
    type: 'document',
    version: 1,
    updatedAt: now,
    title: 'Test Document',
    biblePassage: 'John 3:16',
    speaker: 'Pastor John',
    children: [para1, quote1, para2, quote2],
  };

  return {
    version: 1,
    root,
    eventLog: [],
    undoStack: [],
    redoStack: [],
    nodeIndex: {
      'doc-root': { node: root, parentId: null, path: [] },
      'para-1': { node: para1, parentId: 'doc-root', path: ['doc-root'] },
      'text-1': { node: textNode1, parentId: 'para-1', path: ['doc-root', 'para-1'] },
      'passage-1': { node: quote1, parentId: 'doc-root', path: ['doc-root'] },
      'passage-1-text': {
        node: quote1.children[0]!,
        parentId: 'passage-1',
        path: ['doc-root', 'passage-1'],
      },
      'para-2': { node: para2, parentId: 'doc-root', path: ['doc-root'] },
      'text-2': { node: textNode2, parentId: 'para-2', path: ['doc-root', 'para-2'] },
      'passage-2': { node: quote2, parentId: 'doc-root', path: ['doc-root'] },
      'passage-2-text': {
        node: quote2.children[0]!,
        parentId: 'passage-2',
        path: ['doc-root', 'passage-2'],
      },
    },
    passageIndex: {
      byReference: { 'John 3:16': ['passage-1'], 'John 1:1': ['passage-2'] },
      byBook: { John: ['passage-1', 'passage-2'] },
      all: ['passage-1', 'passage-2'],
    },
    extracted: {
      references: ['John 3:16', 'John 1:1'],
      tags: ['gospel', 'love'],
    },
    lastModified: now,
    createdAt: now,
  };
}

function createTestSermonDocument(): SermonDocument {
  return {
    title: 'Test Document',
    biblePassage: 'John 3:16',
    speaker: 'Pastor John',
    references: ['John 3:16', 'John 1:1'],
    tags: ['gospel', 'love'],
    body: 'Hello world.\n\nSecond paragraph.',
    rawTranscript: 'Hello world. Second paragraph.',
    documentState: createTestDocumentState(),
  };
}

// Wrapper for provider
const createWrapper = (sermonDocument: SermonDocument | null) => {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DocumentProvider sermonDocument={sermonDocument}>{children}</DocumentProvider>;
  };
};

// ============================================================================
// useDocument TESTS
// ============================================================================

describe('useDocument', () => {
  describe('with document loaded', () => {
    it('should return hasDocument as true', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.hasDocument).toBe(true);
    });

    it('should return title', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.title).toBe('Test Document');
    });

    it('should return biblePassage', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.biblePassage).toBe('John 3:16');
    });

    it('should return speaker', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.speaker).toBe('Pastor John');
    });

    it('should return paragraphs', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.paragraphs.length).toBe(2);
    });

    it('should return references', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.references).toContain('John 3:16');
    });

    it('should return tags', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.tags).toContain('gospel');
    });

    it('should return statistics', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.statistics).toBeDefined();
      expect(result.current.statistics?.passageCount).toBe(2);
      expect(result.current.statistics?.paragraphCount).toBe(2);
    });

    it('should provide getNodeById function', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      const node = result.current.getNodeById('para-1');
      expect(node).toBeDefined();
      expect(node?.type).toBe('paragraph');
    });

    it('should provide extractText function', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      const text = result.current.extractText();
      expect(text).toContain('Hello world');
    });
  });

  describe('without document loaded', () => {
    it('should return hasDocument as false', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(null),
      });

      expect(result.current.hasDocument).toBe(false);
    });

    it('should return null for manager', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(null),
      });

      expect(result.current.manager).toBeNull();
    });

    it('should return empty arrays', () => {
      const { result } = renderHook(() => useDocument(), {
        wrapper: createWrapper(null),
      });

      expect(result.current.paragraphs).toEqual([]);
      expect(result.current.references).toEqual([]);
    });
  });
});

// ============================================================================
// usePassages TESTS
// ============================================================================

describe('usePassages', () => {
  describe('with passages', () => {
    it('should return hasPassages as true', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.hasPassages).toBe(true);
    });

    it('should return correct passageCount', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.passageCount).toBe(2);
    });

    it('should return enriched quotes', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.enrichedPassages.length).toBe(2);
      expect(result.current.enrichedPassages[0]!.reference).toBe('John 3:16');
      expect(result.current.enrichedPassages[0]!.book).toBe('John');
      expect(result.current.enrichedPassages[0]!.index).toBe(0);
    });

    it('should return book summary', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.bookSummary).toEqual([{ book: 'John', count: 2 }]);
    });

    it('should get quote by ID', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      const passage = result.current.getPassageById('passage-1');
      expect(passage).toBeDefined();
      expect(passage?.metadata.reference?.normalizedReference).toBe('John 3:16');
    });

    it('should get passages by reference', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      const passages = result.current.getPassagesByReference('John 3:16');
      expect(passages.length).toBe(1);
    });

    it('should get passages by book', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      const passages = result.current.getPassagesByBook('John');
      expect(passages.length).toBe(2);
    });

    it('should filter passages by confidence', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      const filtered = result.current.filterPassages({ minConfidence: 0.8 });
      expect(filtered.length).toBe(2);

      const highFiltered = result.current.filterPassages({ minConfidence: 0.9 });
      expect(highFiltered.length).toBe(0);
    });
  });

  describe('without passages', () => {
    it('should return hasPassages as false', () => {
      const { result } = renderHook(() => usePassages(), {
        wrapper: createWrapper(null),
      });

      expect(result.current.hasPassages).toBe(false);
      expect(result.current.passageCount).toBe(0);
    });
  });
});

// ============================================================================
// useNode TESTS
// ============================================================================

describe('useNode', () => {
  describe('with valid node ID', () => {
    it('should return node', () => {
      const { result } = renderHook(() => useNode('para-1'), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.exists).toBe(true);
      expect(result.current.node?.id).toBe('para-1');
    });

    it('should return node type flags', () => {
      const { result } = renderHook(() => useNode('para-1'), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.isParagraph).toBe(true);
      expect(result.current.isText).toBe(false);
      expect(result.current.isPassageBlock).toBe(false);
    });

    it('should return parent info', () => {
      const { result } = renderHook(() => useNode('text-1'), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.parentId).toBe('para-1');
      expect(result.current.parent?.id).toBe('para-1');
    });

    it('should return path', () => {
      const { result } = renderHook(() => useNode('text-1'), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.path).toEqual(['doc-root', 'para-1']);
    });

    it('should return text content', () => {
      const { result } = renderHook(() => useNode('text-1'), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.text).toBe('Hello world.');
    });
  });

  describe('with invalid node ID', () => {
    it('should return exists as false', () => {
      const { result } = renderHook(() => useNode('non-existent'), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.exists).toBe(false);
      expect(result.current.node).toBeNull();
    });
  });

  describe('with null node ID', () => {
    it('should return exists as false', () => {
      const { result } = renderHook(() => useNode(null), {
        wrapper: createWrapper(createTestSermonDocument()),
      });

      expect(result.current.exists).toBe(false);
    });
  });
});

// ============================================================================
// useNodeTraversal TESTS
// ============================================================================

describe('useNodeTraversal', () => {
  it('should find nodes by type', () => {
    const { result } = renderHook(() => useNodeTraversal(), {
      wrapper: createWrapper(createTestSermonDocument()),
    });

    const paragraphs = result.current.findByType('paragraph');
    expect(paragraphs.length).toBe(2);
  });

  it('should find nodes by predicate', () => {
    const { result } = renderHook(() => useNodeTraversal(), {
      wrapper: createWrapper(createTestSermonDocument()),
    });

    const passageBlocks = result.current.findByPredicate((node) => node.type === 'passage');
    expect(passageBlocks.length).toBe(2);
  });

  it('should get all nodes', () => {
    const { result } = renderHook(() => useNodeTraversal(), {
      wrapper: createWrapper(createTestSermonDocument()),
    });

    const allNodes = result.current.getAllNodes();
    expect(allNodes.length).toBeGreaterThan(0);
  });

  it('should traverse with callback', () => {
    const { result } = renderHook(() => useNodeTraversal(), {
      wrapper: createWrapper(createTestSermonDocument()),
    });

    const visited: string[] = [];
    result.current.traverse((node) => {
      visited.push(node.id);
    });

    expect(visited).toContain('doc-root');
    expect(visited).toContain('para-1');
    expect(visited).toContain('passage-1');
  });
});
