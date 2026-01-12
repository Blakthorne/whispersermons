/**
 * Document Renderer Component Tests
 *
 * Tests for DocumentRenderer and related components.
 *
 * AST Node Types: document, paragraph, text, passage, interjection
 * Headings are paragraphs with headingLevel (1-3)
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentProvider } from '../DocumentContext';
import { DocumentRenderer } from '../components/DocumentRenderer';
import { TextRenderer } from '../components/TextRenderer';
import { InterjectionRenderer } from '../components/InterjectionRenderer';
import { BiblePassageRenderer } from '../components/BiblePassageRenderer';
import { ParagraphRenderer } from '../components/ParagraphRenderer';
import { NodeRenderer } from '../components/NodeRenderer';
import type {
  DocumentState,
  DocumentRootNode,
  ParagraphNode,
  TextNode,
  PassageNode,
  InterjectionNode,
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

function createParagraphNode(id: string, children: (TextNode | InterjectionNode)[]): ParagraphNode {
  return {
    id,
    type: 'paragraph',
    version: 1,
    updatedAt: new Date().toISOString(),
    children,
  };
}

function createInterjectionNode(id: string, content: string): InterjectionNode {
  return {
    id,
    type: 'interjection',
    version: 1,
    updatedAt: new Date().toISOString(),
    content,
    metadataId: 'meta-1',
  };
}

/**
 * Create a heading paragraph (paragraph with headingLevel formatting).
 * Level is clamped to 1-3.
 */
function createHeadingParagraph(
  id: string,
  content: string,
  level: 1 | 2 | 3
): ParagraphNode & { headingLevel: 1 | 2 | 3 } {
  return {
    id,
    type: 'paragraph',
    version: 1,
    updatedAt: new Date().toISOString(),
    headingLevel: level,
    children: [createTextNode(`${id}-text`, content)],
  };
}

function createPassageNode(
  id: string,
  text: string,
  reference: string,
  book: string,
  confidence: number = 0.85
): PassageNode {
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
        confidence,
        confidenceLevel: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
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
  const para1 = createParagraphNode('para-1', [textNode1]);
  const passage1 = createPassageNode(
    'passage-1',
    'For God so loved the world.',
    'John 3:16',
    'John',
    0.92
  );

  const root: DocumentRootNode = {
    id: 'doc-root',
    type: 'document',
    version: 1,
    updatedAt: now,
    title: 'Test Sermon',
    biblePassage: 'John 3:16',
    children: [para1, passage1],
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
      'passage-1': { node: passage1, parentId: 'doc-root', path: ['doc-root'] },
      'passage-1-text': {
        node: passage1.children[0]!,
        parentId: 'passage-1',
        path: ['doc-root', 'passage-1'],
      },
    },
    passageIndex: {
      byReference: { 'John 3:16': ['passage-1'] },
      byBook: { John: ['passage-1'] },
      all: ['passage-1'],
    },
    extracted: {
      references: ['John 3:16'],
      tags: ['gospel'],
    },
    lastModified: now,
    createdAt: now,
  };
}

function createTestSermonDocument(): SermonDocument {
  return {
    title: 'Test Sermon',
    biblePassage: 'John 3:16',
    references: ['John 3:16'],
    tags: ['gospel'],
    body: 'Hello world.',
    rawTranscript: 'Hello world.',
    documentState: createTestDocumentState(),
  };
}

// ============================================================================
// TextRenderer TESTS
// ============================================================================

describe('TextRenderer', () => {
  it('should render text content', () => {
    const node = createTextNode('text-1', 'Hello world!');
    render(<TextRenderer node={node} />);

    expect(screen.getByText('Hello world!')).toBeInTheDocument();
  });

  it('should have correct data-node-id attribute', () => {
    const node = createTextNode('text-1', 'Hello world!');
    render(<TextRenderer node={node} />);

    const element = screen.getByText('Hello world!');
    expect(element).toHaveAttribute('data-node-id', 'text-1');
  });

  it('should apply custom className', () => {
    const node = createTextNode('text-1', 'Hello world!');
    render(<TextRenderer node={node} className="custom-class" />);

    const element = screen.getByText('Hello world!');
    expect(element).toHaveClass('document-text');
    expect(element).toHaveClass('custom-class');
  });
});

// ============================================================================
// InterjectionRenderer TESTS
// ============================================================================

describe('InterjectionRenderer', () => {
  it('should render interjection content', () => {
    const node = createInterjectionNode('interj-1', 'amen');
    render(<InterjectionRenderer node={node} />);

    expect(screen.getByText('amen')).toBeInTheDocument();
  });

  it('should have interjection class', () => {
    const node = createInterjectionNode('interj-1', 'amen');
    render(<InterjectionRenderer node={node} />);

    const element = screen.getByText('amen');
    expect(element).toHaveClass('document-interjection');
  });

  it('should have title attribute', () => {
    const node = createInterjectionNode('interj-1', 'amen');
    render(<InterjectionRenderer node={node} />);

    const element = screen.getByText('amen');
    expect(element).toHaveAttribute('title', 'Interjection');
  });

  it('should show brackets when showBrackets is true', () => {
    const node = createInterjectionNode('interj-1', 'amen');
    render(<InterjectionRenderer node={node} showBrackets />);

    expect(screen.getByText('[amen]')).toBeInTheDocument();
  });
});

// ============================================================================
// BiblePassageRenderer TESTS
// ============================================================================

describe('BiblePassageRenderer', () => {
  it('should render passage content', () => {
    const passage = createPassageNode(
      'passage-1',
      'For God so loved the world.',
      'John 3:16',
      'John'
    );
    render(<BiblePassageRenderer node={passage} />);

    expect(screen.getByText('For God so loved the world.')).toBeInTheDocument();
  });

  it('should wrap content in quotes', () => {
    const passage = createPassageNode(
      'passage-1',
      'For God so loved the world.',
      'John 3:16',
      'John'
    );
    const { container } = render(<BiblePassageRenderer node={passage} />);

    const passageContent = container.querySelector('.document-quote-content');
    expect(passageContent).toBeInTheDocument();
    // The component wraps content in curly quotes (unicode left double quotation mark U+201C)
    expect(passageContent?.textContent).toContain('\u201C');
  });

  it('should apply high confidence class', () => {
    const passage = createPassageNode(
      'passage-1',
      'For God so loved the world.',
      'John 3:16',
      'John',
      0.92
    );
    const { container } = render(<BiblePassageRenderer node={passage} />);

    const passageDiv = container.querySelector('.document-bible-passage');
    expect(passageDiv).toHaveClass('document-bible-passage--high-confidence');
  });

  it('should apply medium confidence class', () => {
    const passage = createPassageNode('passage-1', 'Text', 'John 3:16', 'John', 0.7);
    const { container } = render(<BiblePassageRenderer node={passage} />);

    const passageDiv = container.querySelector('.document-bible-passage');
    expect(passageDiv).toHaveClass('document-bible-passage--medium-confidence');
  });

  it('should apply low confidence class', () => {
    const passage = createPassageNode('passage-1', 'Text', 'John 3:16', 'John', 0.5);
    const { container } = render(<BiblePassageRenderer node={passage} />);

    const passageDiv = container.querySelector('.document-bible-passage');
    expect(passageDiv).toHaveClass('document-bible-passage--low-confidence');
  });

  it('should have data attributes', () => {
    const passage = createPassageNode('passage-1', 'Text', 'John 3:16', 'John', 0.85);
    const { container } = render(<BiblePassageRenderer node={passage} />);

    const passageDiv = container.querySelector('.document-bible-passage');
    expect(passageDiv).toHaveAttribute('data-node-id', 'passage-1');
    expect(passageDiv).toHaveAttribute('data-confidence', '0.85');
  });
});

// ============================================================================
// ParagraphRenderer TESTS
// ============================================================================

describe('ParagraphRenderer', () => {
  it('should render paragraph with text', () => {
    const textNode = createTextNode('text-1', 'Hello world.');
    const para = createParagraphNode('para-1', [textNode]);
    render(<ParagraphRenderer node={para} />);

    expect(screen.getByText('Hello world.')).toBeInTheDocument();
  });

  it('should have paragraph class', () => {
    const textNode = createTextNode('text-1', 'Hello world.');
    const para = createParagraphNode('para-1', [textNode]);
    const { container } = render(<ParagraphRenderer node={para} />);

    const p = container.querySelector('p');
    expect(p).toHaveClass('document-paragraph');
  });

  it('should render multiple children', () => {
    const text1 = createTextNode('text-1', 'Hello ');
    const text2 = createTextNode('text-2', 'world!');
    const para = createParagraphNode('para-1', [text1, text2]);
    const { container } = render(<ParagraphRenderer node={para} />);

    // Use container queries with exact: false for whitespace handling
    expect(container.textContent).toContain('Hello');
    expect(container.textContent).toContain('world!');
    expect(container.querySelectorAll('[data-node-id]').length).toBe(3); // para + 2 text nodes
  });

  it('should render interjections in paragraph', () => {
    const text1 = createTextNode('text-1', 'Hello ');
    const interj = createInterjectionNode('interj-1', 'amen');
    const para = createParagraphNode('para-1', [text1, interj]);
    const { container } = render(<ParagraphRenderer node={para} />);

    expect(container.textContent).toContain('Hello');
    expect(screen.getByText('amen')).toBeInTheDocument();
  });

  it('should render heading-styled paragraph as h1', () => {
    const heading = createHeadingParagraph('heading-1', 'Main Title', 1);
    render(<ParagraphRenderer node={heading} />);

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Main Title');
  });

  it('should render heading-styled paragraph as h2', () => {
    const heading = createHeadingParagraph('heading-2', 'Section Title', 2);
    render(<ParagraphRenderer node={heading} />);

    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent('Section Title');
  });

  it('should have level-specific class for heading paragraph', () => {
    const heading = createHeadingParagraph('heading-1', 'Title', 1);
    const { container } = render(<ParagraphRenderer node={heading} />);

    const h1 = container.querySelector('h1');
    expect(h1).toHaveClass('document-heading');
    expect(h1).toHaveClass('document-heading--level-1');
  });
});

// ============================================================================
// NodeRenderer TESTS
// ============================================================================

describe('NodeRenderer', () => {
  it('should render text node', () => {
    const node = createTextNode('text-1', 'Hello');
    render(<NodeRenderer node={node} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('should render paragraph node', () => {
    const textNode = createTextNode('text-1', 'Paragraph text');
    const para = createParagraphNode('para-1', [textNode]);
    render(<NodeRenderer node={para} />);

    expect(screen.getByText('Paragraph text')).toBeInTheDocument();
  });

  it('should render passage node', () => {
    const passage = createPassageNode('passage-1', 'Quote text', 'John 3:16', 'John');
    render(<NodeRenderer node={passage} />);

    // Quote content is wrapped in curly quotes by the renderer
    expect(screen.getByText('Quote text')).toBeInTheDocument();
  });

  it('should render heading paragraph via ParagraphRenderer', () => {
    const heading = createHeadingParagraph('heading-1', 'Heading', 2);
    render(<NodeRenderer node={heading} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Heading');
  });
});

// ============================================================================
// DocumentRenderer TESTS
// ============================================================================

describe('DocumentRenderer', () => {
  it('should render placeholder when no document', () => {
    render(
      <DocumentProvider sermonDocument={null}>
        <DocumentRenderer />
      </DocumentProvider>
    );

    expect(screen.getByText('No document loaded.')).toBeInTheDocument();
  });

  it('should render custom placeholder', () => {
    render(
      <DocumentProvider sermonDocument={null}>
        <DocumentRenderer emptyPlaceholder={<div>Custom placeholder</div>} />
      </DocumentProvider>
    );

    expect(screen.getByText('Custom placeholder')).toBeInTheDocument();
  });

  it('should render document title when showMetadata is true', () => {
    render(
      <DocumentProvider sermonDocument={createTestSermonDocument()}>
        <DocumentRenderer showMetadata />
      </DocumentProvider>
    );

    expect(screen.getByText('Test Sermon')).toBeInTheDocument();
  });

  it('should hide title when showMetadata is false', () => {
    render(
      <DocumentProvider sermonDocument={createTestSermonDocument()}>
        <DocumentRenderer showMetadata={false} />
      </DocumentProvider>
    );

    expect(screen.queryByText('Test Sermon')).not.toBeInTheDocument();
  });

  it('should show statistics when showStatistics is true', () => {
    render(
      <DocumentProvider sermonDocument={createTestSermonDocument()}>
        <DocumentRenderer showStatistics />
      </DocumentProvider>
    );

    expect(screen.getByText('words')).toBeInTheDocument();
    expect(screen.getByText('paragraphs')).toBeInTheDocument();
    expect(screen.getByText('passages')).toBeInTheDocument();
  });

  it('should hide statistics when showStatistics is false', () => {
    render(
      <DocumentProvider sermonDocument={createTestSermonDocument()}>
        <DocumentRenderer showStatistics={false} />
      </DocumentProvider>
    );

    expect(screen.queryByText('words')).not.toBeInTheDocument();
  });

  it('should render document content', () => {
    render(
      <DocumentProvider sermonDocument={createTestSermonDocument()}>
        <DocumentRenderer />
      </DocumentProvider>
    );

    expect(screen.getByText('Hello world.')).toBeInTheDocument();
    expect(screen.getByText('For God so loved the world.')).toBeInTheDocument();
  });

  it('should have readonly class', () => {
    const { container } = render(
      <DocumentProvider sermonDocument={createTestSermonDocument()}>
        <DocumentRenderer />
      </DocumentProvider>
    );

    const article = container.querySelector('article');
    expect(article).toHaveClass('document-renderer--readonly');
  });
});
