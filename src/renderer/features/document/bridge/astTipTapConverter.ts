/**
 * AST-TipTap Converter
 *
 * Converts between the DocumentState AST and TipTap's JSON format.
 * Preserves metadata using TipTap's mark/attribute system.
 *
 * ## Node Mapping:
 * - DocumentRootNode → TipTap doc
 * - ParagraphNode → TipTap paragraph
 * - TextNode → TipTap text
 * - QuoteBlockNode → TipTap blockquote with data attributes
 * - HeadingNode → TipTap heading
 * - InterjectionNode → TipTap text with interjection mark
 *
 * ## Metadata Preservation:
 * Quote metadata is stored in TipTap's `attrs` system:
 * ```json
 * {
 *   "type": "blockquote",
 *   "attrs": {
 *     "quoteId": "node-xxx",
 *     "reference": "John 3:16",
 *     "book": "John",
 *     "userVerified": false
 *   }
 * }
 * ```
 */

import type {
  DocumentRootNode,
  DocumentNode,
  ParagraphNode,
  TextNode,
  QuoteBlockNode,
  HeadingNode,
  InterjectionNode,
  NodeId,
  QuoteMetadata,
} from '../../../../shared/documentModel';
import {
  isParagraphNode,
  isTextNode,
  isQuoteBlockNode,
  isHeadingNode,
  isInterjectionNode,
} from '../../../../shared/documentModel';
import { createNodeId, createTimestamp } from '../events';

// ============================================================================
// TYPES
// ============================================================================

/**
 * TipTap node structure (ProseMirror-compatible).
 */
export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
}

/**
 * TipTap mark (inline formatting/metadata).
 */
export interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * TipTap document (root node).
 */
export interface TipTapDocument {
  type: 'doc';
  content: TipTapNode[];
}

/**
 * Options for conversion.
 */
export interface ConversionOptions {
  /** Whether to preserve node IDs (default: true) */
  preserveIds?: boolean;
  /** Whether to include metadata in attrs (default: true) */
  includeMetadata?: boolean;
  /** Whether to include interjections (default: true) */
  includeInterjections?: boolean;
}

/**
 * Result from conversion.
 */
export interface ConversionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: string[];
}

// ============================================================================
// AST TO TIPTAP
// ============================================================================

/**
 * Convert DocumentRootNode to TipTap JSON document.
 */
export function astToTipTapJson(
  root: DocumentRootNode,
  options: ConversionOptions = {}
): ConversionResult<TipTapDocument> {
  const { preserveIds = true, includeMetadata = true, includeInterjections = true } = options;
  const warnings: string[] = [];

  try {
    const content: TipTapNode[] = [];

    // Add title as H1 if present
    if (root.title) {
      content.push({
        type: 'heading',
        attrs: { level: 1, textAlign: 'center' },
        content: [{ type: 'text', text: root.title }],
      });
    }

    // Add Bible passage if present
    if (root.biblePassage) {
      content.push({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Primary Reference: ', marks: [{ type: 'bold' }] },
          { type: 'text', text: root.biblePassage },
        ],
      });
    }

    // Convert children
    for (const child of root.children) {
      const converted = convertNodeToTipTap(child, {
        preserveIds,
        includeMetadata,
        includeInterjections,
      });
      if (converted) {
        content.push(converted);
      }
    }

    // Ensure at least one paragraph
    if (content.length === 0) {
      content.push({
        type: 'paragraph',
        content: [],
      });
    }

    return {
      success: true,
      data: { type: 'doc', content },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Convert a single AST node to TipTap node.
 */
function convertNodeToTipTap(
  node: DocumentNode,
  options: ConversionOptions
): TipTapNode | null {
  const { preserveIds, includeInterjections } = options;

  if (isParagraphNode(node)) {
    return convertParagraphToTipTap(node, options);
  }

  if (isQuoteBlockNode(node)) {
    return convertQuoteToTipTap(node, options);
  }

  if (isHeadingNode(node)) {
    return convertHeadingToTipTap(node, options);
  }

  if (isTextNode(node)) {
    return { type: 'text', text: node.content };
  }

  if (isInterjectionNode(node) && includeInterjections) {
    return {
      type: 'text',
      text: node.content,
      marks: [
        {
          type: 'interjection',
          attrs: preserveIds ? { nodeId: node.id, metadataId: node.metadataId } : {},
        },
      ],
    };
  }

  // Skip unknown node types
  return null;
}

/**
 * Convert paragraph to TipTap paragraph.
 */
function convertParagraphToTipTap(
  node: ParagraphNode,
  options: ConversionOptions
): TipTapNode {
  const { preserveIds } = options;
  const content: TipTapNode[] = [];

  for (const child of node.children) {
    const converted = convertNodeToTipTap(child, options);
    if (converted) {
      content.push(converted);
    }
  }

  return {
    type: 'paragraph',
    attrs: preserveIds ? { nodeId: node.id } : undefined,
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
  };
}

/**
 * Convert quote block to TipTap blockquote with metadata.
 */
function convertQuoteToTipTap(
  node: QuoteBlockNode,
  options: ConversionOptions
): TipTapNode {
  const { preserveIds, includeMetadata } = options;
  const content: TipTapNode[] = [];

  // Convert children (TextNode and InterjectionNode)
  for (const child of node.children) {
    const converted = convertNodeToTipTap(child, options);
    if (converted) {
      // Wrap text nodes in paragraphs for blockquote
      if (converted.type === 'text') {
        content.push({
          type: 'paragraph',
          content: [converted],
        });
      } else {
        content.push(converted);
      }
    }
  }

  // Build attrs with metadata
  const attrs: Record<string, unknown> = {};
  if (preserveIds) {
    attrs.nodeId = node.id;
  }
  if (includeMetadata) {
    attrs.reference = node.metadata.reference.normalizedReference;
    attrs.book = node.metadata.reference.book;
    attrs.chapter = node.metadata.reference.chapter;
    attrs.verseStart = node.metadata.reference.verseStart;
    attrs.verseEnd = node.metadata.reference.verseEnd;
    attrs.translation = node.metadata.detection.translation;
    attrs.userVerified = node.metadata.userVerified;
    attrs.confidence = node.metadata.detection.confidence;
  }

  return {
    type: 'blockquote',
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
  };
}

/**
 * Convert heading to TipTap heading.
 */
function convertHeadingToTipTap(
  node: HeadingNode,
  options: ConversionOptions
): TipTapNode {
  const { preserveIds } = options;
  const content: TipTapNode[] = [];

  for (const child of node.children) {
    const converted = convertNodeToTipTap(child, options);
    if (converted) {
      content.push(converted);
    }
  }

  return {
    type: 'heading',
    attrs: {
      level: node.level,
      ...(preserveIds ? { nodeId: node.id } : {}),
    },
    content,
  };
}

// ============================================================================
// TIPTAP TO AST
// ============================================================================

/**
 * Convert TipTap JSON document to DocumentRootNode.
 */
export function tipTapJsonToAst(
  doc: TipTapDocument,
  options: ConversionOptions = {}
): ConversionResult<DocumentRootNode> {
  const { preserveIds = true } = options;
  const warnings: string[] = [];

  try {
    const children: DocumentNode[] = [];
    let title: string | undefined;
    let biblePassage: string | undefined;

    for (const node of doc.content) {
      // Extract title from H1
      if (node.type === 'heading' && node.attrs?.level === 1 && !title) {
        title = extractText(node);
        continue;
      }

      // Extract Bible passage from metadata paragraph
      if (node.type === 'paragraph') {
        const text = extractText(node);
        if (text.startsWith('Primary Reference:') || text.startsWith('Primary References:')) {
          biblePassage = text.replace(/^Primary References?:\s*/, '');
          continue;
        }
        // Skip other metadata paragraphs
        if (text.startsWith('References from the Sermon:') || text.startsWith('Tags:')) {
          continue;
        }
      }

      // Skip horizontal rules
      if (node.type === 'horizontalRule') {
        continue;
      }

      const converted = convertTipTapToNode(node, options);
      if (converted) {
        children.push(converted);
      }
    }

    const root: DocumentRootNode = {
      id: preserveIds ? ('root-1' as NodeId) : createNodeId(),
      type: 'document',
      version: 1,
      updatedAt: createTimestamp(),
      title,
      biblePassage,
      children,
    };

    return {
      success: true,
      data: root,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Convert a TipTap node to AST node.
 */
function convertTipTapToNode(
  node: TipTapNode,
  options: ConversionOptions
): DocumentNode | null {
  const { preserveIds } = options;

  switch (node.type) {
    case 'paragraph':
      return convertTipTapParagraph(node, options);

    case 'blockquote':
      return convertTipTapBlockquote(node, options);

    case 'heading':
      return convertTipTapHeading(node, options);

    case 'text':
      // Check for interjection mark
      if (node.marks?.some((m) => m.type === 'interjection')) {
        return convertTipTapInterjection(node);
      }
      return {
        id: preserveIds && node.attrs?.nodeId
          ? (node.attrs.nodeId as NodeId)
          : createNodeId(),
        type: 'text',
        version: 1,
        updatedAt: createTimestamp(),
        content: node.text || '',
      };

    default:
      return null;
  }
}

/**
 * Convert TipTap paragraph to ParagraphNode.
 */
function convertTipTapParagraph(
  node: TipTapNode,
  options: ConversionOptions
): ParagraphNode {
  const { preserveIds } = options;
  const children: DocumentNode[] = [];

  if (node.content) {
    for (const child of node.content) {
      const converted = convertTipTapToNode(child, options);
      if (converted) {
        children.push(converted);
      }
    }
  }

  // Ensure at least one text node
  if (children.length === 0) {
    children.push({
      id: createNodeId(),
      type: 'text',
      version: 1,
      updatedAt: createTimestamp(),
      content: '',
    });
  }

  return {
    id: preserveIds && node.attrs?.nodeId
      ? (node.attrs.nodeId as NodeId)
      : createNodeId(),
    type: 'paragraph',
    version: 1,
    updatedAt: createTimestamp(),
    children,
  };
}

/**
 * Convert TipTap blockquote to QuoteBlockNode.
 */
function convertTipTapBlockquote(
  node: TipTapNode,
  options: ConversionOptions
): QuoteBlockNode {
  const { preserveIds } = options;
  const attrs = node.attrs || {};
  const children: (TextNode | InterjectionNode)[] = [];

  // Extract text from blockquote content
  if (node.content) {
    for (const child of node.content) {
      if (child.type === 'paragraph' && child.content) {
        for (const textNode of child.content) {
          if (textNode.type === 'text') {
            const hasInterjectionMark = textNode.marks?.some((m) => m.type === 'interjection');
            if (hasInterjectionMark) {
              const mark = textNode.marks?.find((m) => m.type === 'interjection');
              children.push({
                id: (mark?.attrs?.nodeId as NodeId) || createNodeId(),
                type: 'interjection',
                version: 1,
                updatedAt: createTimestamp(),
                content: textNode.text || '',
                metadataId: (mark?.attrs?.metadataId as NodeId) || createNodeId(),
              });
            } else {
              children.push({
                id: createNodeId(),
                type: 'text',
                version: 1,
                updatedAt: createTimestamp(),
                content: textNode.text || '',
              });
            }
          }
        }
      }
    }
  }

  // Build reference string for normalized reference
  const refString = (attrs.reference as string) || 'Unknown';

  // Build metadata from attrs
  const metadata: QuoteMetadata = {
    reference: {
      book: (attrs.book as string) || extractBook(refString),
      chapter: (attrs.chapter as number) || 0,
      verseStart: (attrs.verseStart as number) || null,
      verseEnd: (attrs.verseEnd as number) ?? null,
      originalText: refString,
      normalizedReference: refString,
    },
    detection: {
      confidence: (attrs.confidence as number) || 0.5,
      confidenceLevel: 'medium',
      translation: (attrs.translation as string) || 'KJV',
      translationAutoDetected: false,
      verseText: '',
      isPartialMatch: false,
    },
    interjections: [],
    userVerified: (attrs.userVerified as boolean) || false,
  };

  return {
    id: preserveIds && attrs.nodeId
      ? (attrs.nodeId as NodeId)
      : createNodeId(),
    type: 'quote_block',
    version: 1,
    updatedAt: createTimestamp(),
    metadata,
    children,
  };
}

/**
 * Convert TipTap heading to HeadingNode.
 */
function convertTipTapHeading(
  node: TipTapNode,
  options: ConversionOptions
): HeadingNode {
  const { preserveIds } = options;
  const children: DocumentNode[] = [];
  const level = (node.attrs?.level as number) || 1;

  if (node.content) {
    for (const child of node.content) {
      const converted = convertTipTapToNode(child, options);
      if (converted) {
        children.push(converted);
      }
    }
  }

  return {
    id: preserveIds && node.attrs?.nodeId
      ? (node.attrs.nodeId as NodeId)
      : createNodeId(),
    type: 'heading',
    version: 1,
    updatedAt: createTimestamp(),
    level: level as 1 | 2 | 3 | 4 | 5 | 6,
    children,
  };
}

/**
 * Convert TipTap text with interjection mark to InterjectionNode.
 */
function convertTipTapInterjection(node: TipTapNode): InterjectionNode {
  const mark = node.marks?.find((m) => m.type === 'interjection');
  const attrs = mark?.attrs || {};

  return {
    id: (attrs.nodeId as NodeId) || createNodeId(),
    type: 'interjection',
    version: 1,
    updatedAt: createTimestamp(),
    content: node.text || '',
    metadataId: (attrs.metadataId as NodeId) || createNodeId(),
  };
}

// ============================================================================
// HTML CONVERSION
// ============================================================================

/**
 * Convert AST to HTML string.
 */
export function astToHtml(root: DocumentRootNode): string {
  let html = '';

  // Title
  if (root.title) {
    html += `<h1 style="text-align: center">${escapeHtml(root.title)}</h1>`;
  }

  // Bible passage
  if (root.biblePassage) {
    const hasMultiple = root.biblePassage.includes(';');
    const label = hasMultiple ? 'Primary References' : 'Primary Reference';
    html += `<p><strong>${label}:</strong> ${escapeHtml(root.biblePassage)}</p>`;
  }

  // Add separator if we have metadata
  if (root.title || root.biblePassage) {
    html += '<hr />';
  }

  // Children
  for (const child of root.children) {
    html += nodeToHtml(child);
  }

  return html;
}

/**
 * Convert a single node to HTML.
 */
function nodeToHtml(node: DocumentNode): string {
  if (isParagraphNode(node)) {
    let content = '';
    for (const child of node.children) {
      content += nodeToHtml(child);
    }
    return `<p>${content}</p>`;
  }

  if (isQuoteBlockNode(node)) {
    let content = '';
    for (const child of node.children) {
      content += nodeToHtml(child);
    }
    const ref = node.metadata.reference.normalizedReference;
    return `<blockquote data-quote-id="${node.id}" data-reference="${escapeHtml(ref)}">${content}<footer>— ${escapeHtml(ref)}</footer></blockquote>`;
  }

  if (isHeadingNode(node)) {
    let content = '';
    for (const child of node.children) {
      content += nodeToHtml(child);
    }
    return `<h${node.level}>${content}</h${node.level}>`;
  }

  if (isTextNode(node)) {
    return escapeHtml(node.content);
  }

  if (isInterjectionNode(node)) {
    return `<span class="interjection" data-interjection-id="${node.id}">${escapeHtml(node.content)}</span>`;
  }

  return '';
}

/**
 * Convert HTML string to AST (basic implementation).
 * Note: For full HTML parsing, use a proper HTML parser.
 */
export function htmlToAst(html: string): ConversionResult<DocumentRootNode> {
  // This is a simplified implementation
  // For production, consider using DOMParser or a dedicated HTML parser
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    const children: DocumentNode[] = [];
    let title: string | undefined;
    let biblePassage: string | undefined;

    for (const element of Array.from(body.children)) {
      if (element.tagName === 'H1' && !title) {
        title = element.textContent || undefined;
        continue;
      }

      if (element.tagName === 'P') {
        const text = element.textContent || '';
        if (text.startsWith('Primary Reference')) {
          biblePassage = text.replace(/^Primary References?:\s*/, '');
          continue;
        }
      }

      if (element.tagName === 'HR') {
        continue;
      }

      const node = elementToNode(element);
      if (node) {
        children.push(node);
      }
    }

    const root: DocumentRootNode = {
      id: createNodeId(),
      type: 'document',
      version: 1,
      updatedAt: createTimestamp(),
      title,
      biblePassage,
      children,
    };

    return { success: true, data: root };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Convert HTML element to AST node.
 */
function elementToNode(element: Element): DocumentNode | null {
  const tagName = element.tagName;

  switch (tagName) {
    case 'P':
      return {
        id: createNodeId(),
        type: 'paragraph',
        version: 1,
        updatedAt: createTimestamp(),
        children: extractInlineNodes(element),
      };

    case 'BLOCKQUOTE': {
      const quoteId = element.getAttribute('data-quote-id') || createNodeId();
      const reference = element.getAttribute('data-reference') || 'Unknown';
      return {
        id: quoteId as NodeId,
        type: 'quote_block',
        version: 1,
        updatedAt: createTimestamp(),
        metadata: {
          reference: {
            book: extractBook(reference),
            chapter: 0,
            verseStart: null,
            verseEnd: null,
            originalText: reference,
            normalizedReference: reference,
          },
          detection: {
            confidence: 0.5,
            confidenceLevel: 'medium',
            translation: 'KJV',
            translationAutoDetected: false,
            verseText: '',
            isPartialMatch: false,
          },
          interjections: [],
          userVerified: false,
        },
        children: extractInlineNodes(element),
      } as QuoteBlockNode;
    }

    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const levelChar = tagName.charAt(1);
      const level = parseInt(levelChar, 10) as 1 | 2 | 3 | 4 | 5 | 6;
      return {
        id: createNodeId(),
        type: 'heading',
        version: 1,
        updatedAt: createTimestamp(),
        level,
        children: extractInlineNodes(element),
      } as HeadingNode;
    }

    default:
      return null;
  }
}

/**
 * Extract inline nodes from an element.
 */
function extractInlineNodes(element: Element): (TextNode | InterjectionNode)[] {
  const nodes: (TextNode | InterjectionNode)[] = [];

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      if (text.trim()) {
        nodes.push({
          id: createNodeId(),
          type: 'text',
          version: 1,
          updatedAt: createTimestamp(),
          content: text,
        });
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (el.classList.contains('interjection')) {
        nodes.push({
          id: (el.getAttribute('data-interjection-id') as NodeId) || createNodeId(),
          type: 'interjection',
          version: 1,
          updatedAt: createTimestamp(),
          content: el.textContent || '',
          metadataId: createNodeId(),
        });
      } else {
        // Recursively extract text from other elements
        const text = el.textContent || '';
        if (text.trim()) {
          nodes.push({
            id: createNodeId(),
            type: 'text',
            version: 1,
            updatedAt: createTimestamp(),
            content: text,
          });
        }
      }
    }
  }

  return nodes;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract plain text from a TipTap node.
 */
function extractText(node: TipTapNode): string {
  if (node.text) {
    return node.text;
  }
  if (node.content) {
    return node.content.map(extractText).join('');
  }
  return '';
}

/**
 * Extract book name from a reference string.
 */
function extractBook(reference: string): string {
  // Simple extraction: everything before the first number
  const match = reference.match(/^([A-Za-z\s]+)/);
  return match?.[1]?.trim() ?? 'Unknown';
}

/**
 * Escape HTML entities.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m] || m);
}
