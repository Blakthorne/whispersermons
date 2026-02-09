/**
 * DocumentManager Tests
 *
 * Comprehensive tests for the DocumentManager class covering:
 * - Initialization with DocumentState
 * - Node lookups
 * - Quote operations
 * - Tree traversal
 * - Statistics calculation
 * - Text extraction
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentManager, createDocumentManager } from '../DocumentManager';
import type {
  DocumentState,
  DocumentRootNode,
  ParagraphNode,
  TextNode,
  PassageNode,
  InterjectionNode,
} from '../../../../shared/documentModel';

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create a test TextNode.
 */
function createTextNode(id: string, content: string): TextNode {
  return {
    id,
    type: 'text',
    version: 1,
    updatedAt: new Date().toISOString(),
    content,
  };
}

/**
 * Create a test ParagraphNode.
 */
function createParagraphNode(id: string, children: (TextNode | InterjectionNode)[]): ParagraphNode {
  return {
    id,
    type: 'paragraph',
    version: 1,
    updatedAt: new Date().toISOString(),
    children,
  };
}

/**
 * Create a test InterjectionNode.
 */
function createInterjectionNode(id: string, content: string, metadataId: string): InterjectionNode {
  return {
    id,
    type: 'interjection',
    version: 1,
    updatedAt: new Date().toISOString(),
    content,
    metadataId,
  };
}

/**
 * Create a test PassageNode.
 */
function createPassageNode(
  id: string,
  children: (TextNode | InterjectionNode)[],
  reference: string,
  book: string,
  confidence: number = 0.85
): PassageNode {
  return {
    id,
    type: 'passage',
    version: 1,
    updatedAt: new Date().toISOString(),
    metadata: {
      reference: {
        book,
        chapter: 5,
        verseStart: 3,
        verseEnd: null,
        originalText: reference,
        normalizedReference: reference,
      },
      detection: {
        confidence,
        confidenceLevel: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        translation: 'KJV',
        translationAutoDetected: true,
        verseText: children.map((c) => (c.type === 'text' ? c.content : '')).join(''),
        isPartialMatch: false,
      },
      interjections: [],
      userVerified: false,
    },
    children,
  };
}

/**
 * Create a complete test DocumentState.
 */
function createTestDocumentState(): DocumentState {
  const now = new Date().toISOString();

  // Create nodes
  const textNode1 = createTextNode('text-0001', 'Hello, this is a test paragraph.');
  const textNode2 = createTextNode('text-0002', 'Blessed are the poor in spirit.');
  const textNode3 = createTextNode('text-0003', 'Another paragraph after the quote.');
  const interjection1 = createInterjectionNode('interj-0001', 'amen', 'meta-0001');

  const para1 = createParagraphNode('para-0001', [textNode1]);
  const passage1 = createPassageNode(
    'passage-0001',
    [textNode2, interjection1],
    'Matthew 5:3',
    'Matthew',
    0.92
  );
  const para2 = createParagraphNode('para-0002', [textNode3]);

  const root: DocumentRootNode = {
    id: 'doc-root',
    type: 'document',
    version: 1,
    updatedAt: now,
    title: 'Test Sermon',
    biblePassage: 'Matthew 5:1-12',
    children: [para1, passage1, para2],
  };

  // Build node index
  const nodeIndex: DocumentState['nodeIndex'] = {
    'doc-root': { node: root, parentId: null, path: [] },
    'para-0001': { node: para1, parentId: 'doc-root', path: ['doc-root'] },
    'text-0001': { node: textNode1, parentId: 'para-0001', path: ['doc-root', 'para-0001'] },
    'passage-0001': { node: passage1, parentId: 'doc-root', path: ['doc-root'] },
    'text-0002': { node: textNode2, parentId: 'passage-0001', path: ['doc-root', 'passage-0001'] },
    'interj-0001': {
      node: interjection1,
      parentId: 'passage-0001',
      path: ['doc-root', 'passage-0001'],
    },
    'para-0002': { node: para2, parentId: 'doc-root', path: ['doc-root'] },
    'text-0003': { node: textNode3, parentId: 'para-0002', path: ['doc-root', 'para-0002'] },
  };

  // Build passage index
  const passageIndex: DocumentState['passageIndex'] = {
    byReference: { 'Matthew 5:3': ['passage-0001'] },
    byBook: { Matthew: ['passage-0001'] },
    all: ['passage-0001'],
  };

  return {
    version: 1,
    root,
    eventLog: [],
    undoStack: [],
    redoStack: [],
    nodeIndex,
    passageIndex,
    extracted: {
      references: ['Matthew 5:3'],
      tags: ['sermon', 'beatitudes'],
    },
    lastModified: now,
    createdAt: now,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('DocumentManager', () => {
  describe('initialization', () => {
    it('should create manager with DocumentState', () => {
      const state = createTestDocumentState();
      const manager = new DocumentManager(state);

      expect(manager.getState()).toBe(state);
    });

    it('should create empty manager when no input provided', () => {
      const manager = new DocumentManager(null);

      expect(manager.getState().root.children.length).toBe(0);
    });
  });

  describe('createDocumentManager factory', () => {
    it('should handle null input', () => {
      const manager = createDocumentManager(null);
      expect(manager.getState().root.children.length).toBe(0);
    });

    it('should use documentState when available', () => {
      const state = createTestDocumentState();
      const manager = createDocumentManager({ documentState: state });

      expect(manager.getTitle()).toBe('Test Sermon');
    });

    it('should create empty manager when no documentState provided', () => {
      const manager = createDocumentManager({});

      // Without documentState, creates empty document
      expect(manager.getState().root.children.length).toBe(0);
    });
  });

  describe('basic accessors', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should return root node', () => {
      const root = manager.getRoot();
      expect(root.type).toBe('document');
      expect(root.id).toBe('doc-root');
    });

    it('should return title', () => {
      expect(manager.getTitle()).toBe('Test Sermon');
    });

    it('should return Bible passage', () => {
      expect(manager.getBiblePassage()).toBe('Matthew 5:1-12');
    });

    it('should return version', () => {
      expect(manager.getVersion()).toBe(1);
    });
  });

  describe('node lookups', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should get node by ID', () => {
      const node = manager.getNodeById('para-0001');
      expect(node).toBeDefined();
      expect(node?.type).toBe('paragraph');
    });

    it('should return undefined for non-existent ID', () => {
      const node = manager.getNodeById('non-existent');
      expect(node).toBeUndefined();
    });

    it('should get node with path info', () => {
      const nodeWithPath = manager.getNodeWithPath('text-0001');
      expect(nodeWithPath).toBeDefined();
      expect(nodeWithPath?.node.id).toBe('text-0001');
      expect(nodeWithPath?.path).toEqual(['doc-root', 'para-0001']);
      expect(nodeWithPath?.parentId).toBe('para-0001');
    });

    it('should get parent node', () => {
      const parent = manager.getParent('text-0001');
      expect(parent).toBeDefined();
      expect(parent?.id).toBe('para-0001');
    });

    it('should return undefined for root parent', () => {
      const parent = manager.getParent('doc-root');
      expect(parent).toBeUndefined();
    });

    it('should get siblings', () => {
      const siblings = manager.getSiblings('text-0002');
      expect(siblings.length).toBe(2);
      expect(siblings[0]!.id).toBe('text-0002');
      expect(siblings[1]!.id).toBe('interj-0001');
    });
  });

  describe('passage lookups', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should get all passages', () => {
      const passages = manager.getAllPassages();
      expect(passages.length).toBe(1);
      expect(passages[0]!.id).toBe('passage-0001');
    });

    it('should get passage by ID', () => {
      const passage = manager.getPassageById('passage-0001');
      expect(passage).toBeDefined();
      expect(passage?.metadata.reference?.normalizedReference).toBe('Matthew 5:3');
    });

    it('should return undefined for non-passage node ID', () => {
      const passage = manager.getPassageById('para-0001');
      expect(passage).toBeUndefined();
    });

    it('should get passages by reference', () => {
      const passages = manager.getPassagesByReference('Matthew 5:3');
      expect(passages.length).toBe(1);
      expect(passages[0]!.id).toBe('passage-0001');
    });

    it('should return empty array for unknown reference', () => {
      const passages = manager.getPassagesByReference('John 3:16');
      expect(passages.length).toBe(0);
    });

    it('should get passages by book', () => {
      const passages = manager.getPassagesByBook('Matthew');
      expect(passages.length).toBe(1);
    });

    it('should get passage metadata', () => {
      const metadata = manager.getPassageMetadata('passage-0001');
      expect(metadata).toBeDefined();
      expect(metadata?.reference?.book).toBe('Matthew');
      expect(metadata?.detection?.confidence).toBe(0.92);
    });
  });

  describe('tree traversal', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should get nodes by type', () => {
      const paragraphs = manager.getNodesByType('paragraph');
      expect(paragraphs.length).toBe(2);

      const texts = manager.getNodesByType('text');
      expect(texts.length).toBe(3);

      const passages = manager.getNodesByType('passage');
      expect(passages.length).toBe(1);

      const interjections = manager.getNodesByType('interjection');
      expect(interjections.length).toBe(1);
    });

    it('should get paragraphs convenience method', () => {
      const paragraphs = manager.getParagraphs();
      expect(paragraphs.length).toBe(2);
    });

    it('should get text nodes convenience method', () => {
      const textNodes = manager.getTextNodes();
      expect(textNodes.length).toBe(3);
    });

    it('should get interjections convenience method', () => {
      const interjections = manager.getInterjections();
      expect(interjections.length).toBe(1);
      expect(interjections[0]!.content).toBe('amen');
    });

    it('should traverse all nodes', () => {
      const visited: string[] = [];
      manager.traverse((node) => {
        visited.push(node.id);
      });

      expect(visited).toContain('doc-root');
      expect(visited).toContain('para-0001');
      expect(visited).toContain('text-0001');
      expect(visited).toContain('passage-0001');
      expect(visited).toContain('text-0002');
      expect(visited).toContain('interj-0001');
      expect(visited).toContain('para-0002');
      expect(visited).toContain('text-0003');
    });

    it('should allow early exit from traversal', () => {
      const visited: string[] = [];
      manager.traverse((node): void | false => {
        visited.push(node.id);
        if (node.type === 'passage') return false;
      });

      expect(visited).toContain('doc-root');
      expect(visited).toContain('para-0001');
      expect(visited).toContain('passage-0001');
      // Should not include passage children or subsequent nodes
      expect(visited).not.toContain('text-0002');
    });

    it('should find nodes by predicate', () => {
      const result = manager.findNodes((node) => node.type === 'text');
      expect(result.length).toBe(3);
      expect(result[0]!.node.type).toBe('text');
    });
  });

  describe('text extraction', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should extract plain text', () => {
      const text = manager.extractText();
      expect(text).toContain('Hello, this is a test paragraph.');
      expect(text).toContain('Blessed are the poor in spirit.');
      expect(text).toContain('Another paragraph after the quote.');
    });

    it('should include interjections by default', () => {
      const text = manager.extractText();
      expect(text).toContain('[amen]');
    });

    it('should exclude interjections when option is false', () => {
      const text = manager.extractText({ includeInterjections: false });
      expect(text).not.toContain('[amen]');
      expect(text).not.toContain('amen');
    });

    it('should use custom paragraph separator', () => {
      const text = manager.extractText({ paragraphSeparator: '\n---\n' });
      expect(text).toContain('---');
    });

    it('should get node text', () => {
      const text = manager.getNodeText('para-0001');
      expect(text).toBe('Hello, this is a test paragraph.');
    });

    it('should get passage text including children', () => {
      const text = manager.getNodeText('passage-0001');
      expect(text).toContain('Blessed are the poor in spirit.');
      expect(text).toContain('amen');
    });
  });

  describe('statistics', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should calculate word count', () => {
      const wordCount = manager.getWordCount();
      // Count words in all text content
      expect(wordCount).toBeGreaterThan(0);
    });

    it('should return document statistics', () => {
      const stats = manager.getStatistics();
      expect(stats.paragraphCount).toBe(2);
      expect(stats.passageCount).toBe(1);
      expect(stats.interjectionCount).toBe(1);
      expect(stats.wordCount).toBeGreaterThan(0);
      expect(stats.characterCount).toBeGreaterThan(0);
    });

    it('should cache statistics', () => {
      const stats1 = manager.getStatistics();
      const stats2 = manager.getStatistics();
      expect(stats1).toBe(stats2);
    });
  });

  describe('backward compatibility', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should return extracted references', () => {
      const refs = manager.getReferences();
      expect(refs).toContain('Matthew 5:3');
    });

    it('should return extracted tags', () => {
      const tags = manager.getTags();
      expect(tags).toContain('sermon');
      expect(tags).toContain('beatitudes');
    });
  });

});
