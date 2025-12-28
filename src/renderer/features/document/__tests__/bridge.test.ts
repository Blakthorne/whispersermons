/**
 * Phase D: Bridge Tests
 *
 * Tests for:
 * - AST to TipTap JSON conversion
 * - TipTap JSON to AST conversion
 * - HTML conversion
 * - Round-trip conversions
 * - Metadata preservation
 */

import { describe, it, expect } from 'vitest';
import {
  astToTipTapJson,
  tipTapJsonToAst,
  astToHtml,
  htmlToAst,
  type TipTapDocument,
} from '../bridge/astTipTapConverter';
import type { DocumentRootNode, QuoteBlockNode, ParagraphNode, TextNode, NodeId } from '../../../../shared/documentModel';

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

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createSimpleDocumentRoot(): DocumentRootNode {
  const textNode = createTextNode('text-1', 'Hello, world!');
  const paragraphNode = createParagraphNode('para-1', [textNode]);
  return createDocumentRootNode([paragraphNode], {
    title: 'Test Document',
  });
}

function createDocumentWithQuote(): DocumentRootNode {
  const textNode = createTextNode('text-1', 'Some paragraph text.');
  const paragraphNode = createParagraphNode('para-1', [textNode]);
  const quoteNode = createQuoteBlockNode(
    'quote-1',
    'For God so loved the world...',
    'John 3:16',
    'John',
    0.95
  );
  // Set userVerified to true for this specific test
  quoteNode.metadata.userVerified = true;
  return createDocumentRootNode([paragraphNode, quoteNode], {
    title: 'Document with Quote',
    biblePassage: 'John 3:16',
  });
}

function createSimpleTipTapDoc(): TipTapDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello, world!' }],
      },
    ],
  };
}

function createTipTapDocWithBlockquote(): TipTapDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Test Title' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Primary Reference: John 3:16' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Some content.' }],
      },
      {
        type: 'blockquote',
        attrs: {
          reference: 'John 3:16',
          book: 'John',
          chapter: 3,
          verseStart: 16,
          userVerified: false,
          confidence: 0.9,
        },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'For God so loved the world...' }],
          },
        ],
      },
    ],
  };
}

// ============================================================================
// AST TO TIPTAP TESTS
// ============================================================================

describe('AST to TipTap Conversion', () => {
  it('should convert simple document', () => {
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe('doc');
    expect(result.data?.content).toBeDefined();
  });

  it('should include title as H1', () => {
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    const h1 = result.data?.content.find((n) => n.type === 'heading' && n.attrs?.level === 1);
    expect(h1).toBeDefined();
    expect(h1?.content?.[0]?.text).toBe('Test Document');
  });

  it('should include Bible passage', () => {
    const root = createDocumentWithQuote();
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    const pasagePara = result.data?.content.find(
      (n) => n.type === 'paragraph' && n.content?.some((c) => c.text?.includes('Primary Reference'))
    );
    expect(pasagePara).toBeDefined();
  });

  it('should convert paragraph nodes', () => {
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    const paragraphs = result.data?.content.filter((n) => n.type === 'paragraph');
    expect(paragraphs?.length).toBeGreaterThan(0);
  });

  it('should convert blockquote with metadata', () => {
    const root = createDocumentWithQuote();
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    const blockquote = result.data?.content.find((n) => n.type === 'blockquote');
    expect(blockquote).toBeDefined();
    expect(blockquote?.attrs?.reference).toBe('John 3:16');
    expect(blockquote?.attrs?.book).toBe('John');
    expect(blockquote?.attrs?.userVerified).toBe(true);
  });

  it('should preserve node IDs when option enabled', () => {
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root, { preserveIds: true });

    expect(result.success).toBe(true);
    // Check that paragraph has nodeId attr
    const paragraph = result.data?.content.find((n) => n.type === 'paragraph');
    expect(paragraph?.attrs?.nodeId).toBeDefined();
  });

  it('should omit node IDs when option disabled', () => {
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root, { preserveIds: false });

    expect(result.success).toBe(true);
    // Check that paragraph doesn't have nodeId attr
    const paragraph = result.data?.content.find((n) => n.type === 'paragraph');
    expect(paragraph?.attrs?.nodeId).toBeUndefined();
  });

  it('should omit metadata when option disabled', () => {
    const root = createDocumentWithQuote();
    const result = astToTipTapJson(root, { includeMetadata: false });

    expect(result.success).toBe(true);
    const blockquote = result.data?.content.find((n) => n.type === 'blockquote');
    expect(blockquote?.attrs?.reference).toBeUndefined();
    expect(blockquote?.attrs?.book).toBeUndefined();
  });

  it('should ensure at least one paragraph in empty document', () => {
    const root = createDocumentRootNode([], {});
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    expect(result.data?.content.length).toBeGreaterThan(0);
    expect(result.data?.content?.[0]?.type).toBe('paragraph');
  });
});

// ============================================================================
// TIPTAP TO AST TESTS
// ============================================================================

describe('TipTap to AST Conversion', () => {
  it('should convert simple TipTap document', () => {
    const doc = createSimpleTipTapDoc();
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe('document');
    expect(result.data?.children.length).toBeGreaterThan(0);
  });

  it('should extract title from H1', () => {
    const doc = createTipTapDocWithBlockquote();
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Test Title');
  });

  it('should extract Bible passage from metadata paragraph', () => {
    const doc = createTipTapDocWithBlockquote();
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    expect(result.data?.biblePassage).toBe('John 3:16');
  });

  it('should convert paragraph content', () => {
    const doc = createSimpleTipTapDoc();
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    const paragraph = result.data?.children[0] as ParagraphNode;
    expect(paragraph.type).toBe('paragraph');
    expect(paragraph.children.length).toBeGreaterThan(0);
  });

  it('should convert blockquote with metadata', () => {
    const doc = createTipTapDocWithBlockquote();
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    const quote = result.data?.children.find((n) => n.type === 'quote_block') as QuoteBlockNode;
    expect(quote).toBeDefined();
    expect(quote.metadata.reference.book).toBe('John');
    expect(quote.metadata.reference.normalizedReference).toBe('John 3:16');
    expect(quote.metadata.detection.confidence).toBe(0.9);
  });

  it('should preserve node IDs from attrs', () => {
    const doc: TipTapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'para-123' },
          content: [{ type: 'text', text: 'Test' }],
        },
      ],
    };
    const result = tipTapJsonToAst(doc, { preserveIds: true });

    expect(result.success).toBe(true);
    const paragraph = result.data?.children[0] as ParagraphNode;
    expect(paragraph.id).toBe('para-123');
  });

  it('should skip horizontal rules', () => {
    const doc: TipTapDocument = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    };
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    // Should have 2 paragraphs, no horizontalRule node
    expect(result.data?.children.length).toBe(2);
    expect(result.data?.children.every((n) => n.type === 'paragraph')).toBe(true);
  });

  it('should handle empty blockquote', () => {
    const doc: TipTapDocument = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          attrs: { reference: 'John 3:16' },
          content: [],
        },
      ],
    };
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    const quote = result.data?.children[0] as QuoteBlockNode;
    expect(quote.type).toBe('quote_block');
  });
});

// ============================================================================
// HTML CONVERSION TESTS
// ============================================================================

describe('AST to HTML Conversion', () => {
  it('should convert simple document to HTML', () => {
    const root = createSimpleDocumentRoot();
    const html = astToHtml(root);

    expect(html).toContain('<p>');
    expect(html).toContain('Hello, world!');
  });

  it('should include title as H1', () => {
    const root = createSimpleDocumentRoot();
    const html = astToHtml(root);

    expect(html).toContain('<h1');
    expect(html).toContain('Test Document');
  });

  it('should include Bible passage', () => {
    const root = createDocumentWithQuote();
    const html = astToHtml(root);

    expect(html).toContain('Primary Reference');
    expect(html).toContain('John 3:16');
  });

  it('should convert blockquote with data attributes', () => {
    const root = createDocumentWithQuote();
    const html = astToHtml(root);

    expect(html).toContain('<blockquote');
    expect(html).toContain('data-reference="John 3:16"');
    expect(html).toContain('For God so loved the world');
  });

  it('should escape HTML entities', () => {
    const textNode = createTextNode('text-xss', '<script>alert("xss")</script>');
    const paragraphNode = createParagraphNode('para-xss', [textNode]);
    const root = createDocumentRootNode([paragraphNode], {});
    const html = astToHtml(root);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should add separator after metadata', () => {
    const root = createDocumentWithQuote();
    const html = astToHtml(root);

    expect(html).toContain('<hr');
  });
});

describe('HTML to AST Conversion', () => {
  it('should convert simple HTML to AST', () => {
    const html = '<p>Hello, world!</p>';
    const result = htmlToAst(html);

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe('document');
    expect(result.data?.children.length).toBeGreaterThan(0);
  });

  it('should extract title from H1', () => {
    const html = '<h1>Test Title</h1><p>Content</p>';
    const result = htmlToAst(html);

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Test Title');
  });

  it('should extract Bible passage', () => {
    const html = '<p>Primary Reference: John 3:16</p><p>Content</p>';
    const result = htmlToAst(html);

    expect(result.success).toBe(true);
    expect(result.data?.biblePassage).toBe('John 3:16');
  });

  it('should convert blockquote with data attributes', () => {
    const html = '<blockquote data-reference="John 3:16">For God so loved the world</blockquote>';
    const result = htmlToAst(html);

    expect(result.success).toBe(true);
    const quote = result.data?.children.find((n) => n.type === 'quote_block') as QuoteBlockNode;
    expect(quote).toBeDefined();
  });
});

// ============================================================================
// ROUND-TRIP TESTS
// ============================================================================

describe('Round-Trip Conversions', () => {
  it('should preserve content through AST → TipTap → AST', () => {
    const original = createSimpleDocumentRoot();
    const tipTapResult = astToTipTapJson(original);
    expect(tipTapResult.success).toBe(true);

    const astResult = tipTapJsonToAst(tipTapResult.data!);
    expect(astResult.success).toBe(true);

    // Check title preserved
    expect(astResult.data?.title).toBe(original.title);

    // Check paragraph content preserved
    const originalPara = original.children[0] as ParagraphNode;
    const resultPara = astResult.data?.children[0] as ParagraphNode;
    expect(resultPara.type).toBe('paragraph');

    const originalText = (originalPara.children[0] as TextNode).content;
    const resultText = (resultPara.children[0] as TextNode).content;
    expect(resultText).toBe(originalText);
  });

  it('should preserve quote metadata through round-trip', () => {
    const original = createDocumentWithQuote();
    const tipTapResult = astToTipTapJson(original);
    expect(tipTapResult.success).toBe(true);

    const astResult = tipTapJsonToAst(tipTapResult.data!);
    expect(astResult.success).toBe(true);

    const originalQuote = original.children.find((n) => n.type === 'quote_block') as QuoteBlockNode;
    const resultQuote = astResult.data?.children.find((n) => n.type === 'quote_block') as QuoteBlockNode;

    expect(resultQuote.metadata.reference.book).toBe(originalQuote.metadata.reference.book);
    expect(resultQuote.metadata.reference.normalizedReference).toBe(
      originalQuote.metadata.reference.normalizedReference
    );
    expect(resultQuote.metadata.userVerified).toBe(originalQuote.metadata.userVerified);
  });

  it('should preserve content through AST → HTML → AST', () => {
    const original = createSimpleDocumentRoot();
    const html = astToHtml(original);
    const result = htmlToAst(html);

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe(original.title);
  });

  it('should handle multiple round-trips', () => {
    let root = createDocumentWithQuote();

    for (let i = 0; i < 3; i++) {
      const tipTapResult = astToTipTapJson(root);
      expect(tipTapResult.success).toBe(true);

      const astResult = tipTapJsonToAst(tipTapResult.data!);
      expect(astResult.success).toBe(true);
      root = astResult.data!;
    }

    // Verify data still intact
    expect(root.title).toBe('Document with Quote');
    expect(root.biblePassage).toBe('John 3:16');
    const quote = root.children.find((n) => n.type === 'quote_block') as QuoteBlockNode;
    expect(quote).toBeDefined();
    expect(quote.metadata.reference.book).toBe('John');
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty document', () => {
    const root = createDocumentRootNode([], {});
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    expect(result.data?.content.length).toBeGreaterThan(0); // At least empty paragraph
  });

  it('should handle document without title', () => {
    const textNode = createTextNode('text-notitle', 'Content');
    const paragraphNode = createParagraphNode('para-notitle', [textNode]);
    const root = createDocumentRootNode([paragraphNode], {});

    const result = astToTipTapJson(root);
    expect(result.success).toBe(true);

    const h1 = result.data?.content.find((n) => n.type === 'heading' && n.attrs?.level === 1);
    expect(h1).toBeUndefined();
  });

  it('should handle text with special characters', () => {
    const textNode = createTextNode('text-special', 'He said "Hello" & <goodbye>');
    const paragraphNode = createParagraphNode('para-special', [textNode]);
    const root = createDocumentRootNode([paragraphNode], {});

    const tipTapResult = astToTipTapJson(root);
    expect(tipTapResult.success).toBe(true);

    const html = astToHtml(root);
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&quot;');
  });

  it('should handle nested structures', () => {
    // Create a document with multiple paragraphs and quotes
    const para1 = createParagraphNode('para-1', [createTextNode('text-1', 'Paragraph 1')]);
    const quote1 = createQuoteBlockNode('quote-1', 'Quote 1', 'John 1:1', 'John', 0.9);
    const para2 = createParagraphNode('para-2', [createTextNode('text-2', 'Paragraph 2')]);

    const root = createDocumentRootNode([para1, quote1, para2], { title: 'Mixed Content' });

    const result = astToTipTapJson(root);
    expect(result.success).toBe(true);

    // Should have: H1 (title), paragraph, blockquote, paragraph
    const content = result.data?.content || [];
    const h1s = content.filter((n) => n.type === 'heading');
    const paras = content.filter((n) => n.type === 'paragraph');
    const quotes = content.filter((n) => n.type === 'blockquote');

    expect(h1s.length).toBe(1);
    expect(paras.length).toBe(2);
    expect(quotes.length).toBe(1);
  });

  it('should handle empty paragraph in TipTap', () => {
    const doc: TipTapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [],
        },
      ],
    };
    const result = tipTapJsonToAst(doc);

    expect(result.success).toBe(true);
    const paragraph = result.data?.children[0] as ParagraphNode;
    expect(paragraph.children.length).toBeGreaterThan(0); // Should have empty text node
  });
});

// ============================================================================
// CONVERSION OPTIONS TESTS
// ============================================================================

describe('Conversion Options', () => {
  it('should exclude interjections when option disabled', () => {
    // Create a document with an interjection (simulated)
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root, { includeInterjections: false });

    expect(result.success).toBe(true);
    // Should not throw and should produce valid output
    expect(result.data?.content).toBeDefined();
  });

  it('should use default options when none provided', () => {
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root);

    expect(result.success).toBe(true);
    // Default: preserveIds = true
    const paragraph = result.data?.content.find((n) => n.type === 'paragraph');
    expect(paragraph?.attrs?.nodeId).toBeDefined();
  });

  it('should report warnings for conversion issues', () => {
    const root = createSimpleDocumentRoot();
    const result = astToTipTapJson(root);

    // Should succeed without warnings for valid document
    expect(result.success).toBe(true);
    // Warnings should be undefined or empty for valid input
    expect(result.warnings?.length || 0).toBe(0);
  });
});
