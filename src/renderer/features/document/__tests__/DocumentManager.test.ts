/**
 * DocumentManager Tests
 *
 * Comprehensive tests for the DocumentManager class covering:
 * - Initialization with DocumentState
 * - Legacy body fallback
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
  QuoteBlockNode,
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
 * Create a test QuoteBlockNode.
 */
function createQuoteBlockNode(
  id: string,
  children: (TextNode | InterjectionNode)[],
  reference: string,
  book: string,
  confidence: number = 0.85
): QuoteBlockNode {
  return {
    id,
    type: 'quote_block',
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
  const quote1 = createQuoteBlockNode(
    'quote-0001',
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
    children: [para1, quote1, para2],
  };

  // Build node index
  const nodeIndex: DocumentState['nodeIndex'] = {
    'doc-root': { node: root, parentId: null, path: [] },
    'para-0001': { node: para1, parentId: 'doc-root', path: ['doc-root'] },
    'text-0001': { node: textNode1, parentId: 'para-0001', path: ['doc-root', 'para-0001'] },
    'quote-0001': { node: quote1, parentId: 'doc-root', path: ['doc-root'] },
    'text-0002': { node: textNode2, parentId: 'quote-0001', path: ['doc-root', 'quote-0001'] },
    'interj-0001': {
      node: interjection1,
      parentId: 'quote-0001',
      path: ['doc-root', 'quote-0001'],
    },
    'para-0002': { node: para2, parentId: 'doc-root', path: ['doc-root'] },
    'text-0003': { node: textNode3, parentId: 'para-0002', path: ['doc-root', 'para-0002'] },
  };

  // Build quote index
  const quoteIndex: DocumentState['quoteIndex'] = {
    byReference: { 'Matthew 5:3': ['quote-0001'] },
    byBook: { Matthew: ['quote-0001'] },
    all: ['quote-0001'],
  };

  return {
    version: 1,
    root,
    eventLog: [],
    undoStack: [],
    redoStack: [],
    nodeIndex,
    quoteIndex,
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
      expect(manager.getIsLegacy()).toBe(false);
    });

    it('should create manager with legacy body', () => {
      const body = 'First paragraph.\n\nSecond paragraph.';
      const manager = new DocumentManager(null, body);

      expect(manager.getIsLegacy()).toBe(true);
      expect(manager.getState().root.children.length).toBe(2);
    });

    it('should create empty manager when no input provided', () => {
      const manager = new DocumentManager(null);

      expect(manager.getIsLegacy()).toBe(false);
      expect(manager.getState().root.children.length).toBe(0);
    });

    it('should prioritize DocumentState over legacy body', () => {
      const state = createTestDocumentState();
      const manager = new DocumentManager(state, 'This should be ignored');

      expect(manager.getIsLegacy()).toBe(false);
      expect(manager.getTitle()).toBe('Test Sermon');
    });
  });

  describe('createDocumentManager factory', () => {
    it('should handle null input', () => {
      const manager = createDocumentManager(null);
      expect(manager.getState().root.children.length).toBe(0);
    });

    it('should use documentState when available', () => {
      const state = createTestDocumentState();
      const manager = createDocumentManager({ documentState: state, body: 'ignored' });

      expect(manager.getTitle()).toBe('Test Sermon');
    });

    it('should fall back to body when documentState is missing', () => {
      const manager = createDocumentManager({ body: 'Test body.\n\nSecond paragraph.' });

      expect(manager.getIsLegacy()).toBe(true);
      expect(manager.getParagraphs().length).toBe(2);
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

  describe('quote lookups', () => {
    let manager: DocumentManager;

    beforeEach(() => {
      manager = new DocumentManager(createTestDocumentState());
    });

    it('should get all quotes', () => {
      const quotes = manager.getAllQuotes();
      expect(quotes.length).toBe(1);
      expect(quotes[0]!.id).toBe('quote-0001');
    });

    it('should get quote by ID', () => {
      const quote = manager.getQuoteById('quote-0001');
      expect(quote).toBeDefined();
      expect(quote?.metadata.reference.normalizedReference).toBe('Matthew 5:3');
    });

    it('should return undefined for non-quote node ID', () => {
      const quote = manager.getQuoteById('para-0001');
      expect(quote).toBeUndefined();
    });

    it('should get quotes by reference', () => {
      const quotes = manager.getQuotesByReference('Matthew 5:3');
      expect(quotes.length).toBe(1);
      expect(quotes[0]!.id).toBe('quote-0001');
    });

    it('should return empty array for unknown reference', () => {
      const quotes = manager.getQuotesByReference('John 3:16');
      expect(quotes.length).toBe(0);
    });

    it('should get quotes by book', () => {
      const quotes = manager.getQuotesByBook('Matthew');
      expect(quotes.length).toBe(1);
    });

    it('should get quote metadata', () => {
      const metadata = manager.getQuoteMetadata('quote-0001');
      expect(metadata).toBeDefined();
      expect(metadata?.reference.book).toBe('Matthew');
      expect(metadata?.detection.confidence).toBe(0.92);
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

      const quotes = manager.getNodesByType('quote_block');
      expect(quotes.length).toBe(1);

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
      expect(visited).toContain('quote-0001');
      expect(visited).toContain('text-0002');
      expect(visited).toContain('interj-0001');
      expect(visited).toContain('para-0002');
      expect(visited).toContain('text-0003');
    });

    it('should allow early exit from traversal', () => {
      const visited: string[] = [];
      manager.traverse((node): void | false => {
        visited.push(node.id);
        if (node.type === 'quote_block') return false;
      });

      expect(visited).toContain('doc-root');
      expect(visited).toContain('para-0001');
      expect(visited).toContain('quote-0001');
      // Should not include quote children or subsequent nodes
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

    it('should get quote text including children', () => {
      const text = manager.getNodeText('quote-0001');
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
      expect(stats.quoteCount).toBe(1);
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

  describe('legacy conversion', () => {
    it('should convert simple body to document state', () => {
      const body = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const manager = new DocumentManager(null, body);

      const paragraphs = manager.getParagraphs();
      expect(paragraphs.length).toBe(3);

      const text = manager.extractText();
      expect(text).toContain('First paragraph.');
      expect(text).toContain('Second paragraph.');
      expect(text).toContain('Third paragraph.');
    });

    it('should handle empty body', () => {
      const manager = new DocumentManager(null, '');
      expect(manager.getParagraphs().length).toBe(0);
    });

    it('should handle body with only whitespace', () => {
      const manager = new DocumentManager(null, '   \n\n   ');
      expect(manager.getParagraphs().length).toBe(0);
    });

    it('should handle single paragraph', () => {
      const manager = new DocumentManager(null, 'Single paragraph only.');
      expect(manager.getParagraphs().length).toBe(1);
      expect(manager.getWordCount()).toBe(3);
    });
  });
});
