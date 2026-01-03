/**
 * AST-TipTap Converter
 *
 * Converts between the DocumentState AST and TipTap's JSON format.
 * Preserves metadata using TipTap's mark/attribute system.
 *
 * ## Architecture Note (AST as Single Source of Truth):
 * The AST (DocumentState) is the single source of truth for document content.
 * TipTap is a view/editor that reads from and writes to the AST.
 * - AST → TipTap: For rendering in the editor
 * - TipTap → AST: For persisting edits (debounced)
 *
 * ## Node ID Preservation Strategy:
 * - Structural nodes (paragraphs, passages): Preserve IDs via attrs
 * - Text nodes: Regenerate IDs (they change frequently during editing)
 * - This balances stability with simplicity
 *
 * ## IMPORTANT: Passages vs Block Quotes
 * - PassageNode = Bible passage (semantic content with scripture reference)
 * - ParagraphNode with isBlockQuote = Visual formatting (indented text)
 * These are DISTINCT concepts and should not be confused!
 *
 * ## Node Mapping (AST has 5 semantic types):
 * - DocumentRootNode → TipTap doc
 * - ParagraphNode → TipTap paragraph, heading, bulletList/orderedList item, or blockquote (visual)
 * - TextNode → TipTap text
 * - PassageNode → TipTap custom 'biblePassage' node (NOT blockquote!)
 * - InterjectionNode → TipTap text with interjection mark
 *
 * ## Formatting as Properties:
 * - TipTap headings → ParagraphNode with headingLevel (1-3)
 * - TipTap lists → ParagraphNode with listStyle + listNumber
 * - TipTap blockquote (visual) → ParagraphNode with isBlockQuote=true
 *
 * ## Metadata Preservation:
 * Passage metadata is stored in TipTap's `attrs` system.
 */

import type {
  DocumentRootNode,
  DocumentNode,
  ParagraphNode,
  TextNode,
  PassageNode,
  InterjectionNode,
  NodeId,
  PassageMetadata,
} from '../../../../shared/documentModel';
import {
  isParagraphNode,
  isTextNode,
  isPassageNode,
  isInterjectionNode,
  isHeadingParagraph,
  isListItemParagraph,
  isBlockQuoteParagraph,
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
 *
 * Paragraphs with headingLevel become TipTap headings.
 * Paragraphs with listStyle become TipTap list items.
 * Paragraphs with isBlockQuote become TipTap blockquote (visual formatting).
 * PassageNodes become custom biblePassage elements (NOT blockquote!).
 */
function convertNodeToTipTap(
  node: DocumentNode,
  options: ConversionOptions
): TipTapNode | null {
  const { preserveIds, includeInterjections } = options;

  if (isParagraphNode(node)) {
    // Paragraphs with headingLevel render as TipTap headings
    if (isHeadingParagraph(node)) {
      return convertHeadingParagraphToTipTap(node, options);
    }
    // Paragraphs with listStyle render as TipTap list items
    if (isListItemParagraph(node)) {
      return convertListItemParagraphToTipTap(node, options);
    }
    // Paragraphs with isBlockQuote render as TipTap blockquote (VISUAL formatting only)
    if (isBlockQuoteParagraph(node)) {
      return convertBlockQuoteParagraphToTipTap(node, options);
    }
    return convertParagraphToTipTap(node, options);
  }

  // PassageNode = Bible passage (semantic content), NOT visual blockquote
  if (isPassageNode(node)) {
    return convertPassageToTipTap(node, options);
  }

  if (isTextNode(node)) {
    // Skip empty text nodes - ProseMirror doesn't allow them
    // This prevents the "Empty text nodes are not allowed" error
    if (!node.content) {
      return null;
    }
    // Preserve marks (bold, italic, etc.) if they exist
    const result: TipTapNode = { type: 'text', text: node.content };
    if (node.marks && node.marks.length > 0) {
      result.marks = node.marks.map(mark => ({
        type: mark.type,
        attrs: mark.attrs,
      }));
    }
    return result;
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

  // Build attrs
  const attrs: Record<string, unknown> = {};
  if (preserveIds) {
    attrs.nodeId = node.id;
  }
  if (node.textAlign) {
    attrs.textAlign = node.textAlign;
  }

  return {
    type: 'paragraph',
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    // Use empty array for empty paragraphs - ProseMirror doesn't allow empty text nodes
    content: content.length > 0 ? content : [],
  };
}

/**
 * Convert a paragraph with headingLevel to TipTap heading.
 */
function convertHeadingParagraphToTipTap(
  node: ParagraphNode & { headingLevel: 1 | 2 | 3 },
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

  // Build attrs
  const attrs: Record<string, unknown> = {
    level: node.headingLevel,
  };
  if (preserveIds) {
    attrs.nodeId = node.id;
  }
  if (node.textAlign) {
    attrs.textAlign = node.textAlign;
  }

  return {
    type: 'heading',
    attrs,
    content: content.length > 0 ? content : [],
  };
}

/**
 * Convert a paragraph with listStyle to TipTap list item.
 * Note: TipTap expects lists to be wrapped, but we output flat list items
 * that the editor can handle.
 */
function convertListItemParagraphToTipTap(
  node: ParagraphNode & { listStyle: 'bullet' | 'ordered' },
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

  // Build the paragraph content
  const paragraphNode: TipTapNode = {
    type: 'paragraph',
    content: content.length > 0 ? content : [],
  };

  // Build list item attrs
  const listItemAttrs: Record<string, unknown> = {};
  if (preserveIds) {
    listItemAttrs.nodeId = node.id;
  }

  // Create list item wrapping the paragraph
  const listItem: TipTapNode = {
    type: 'listItem',
    attrs: Object.keys(listItemAttrs).length > 0 ? listItemAttrs : undefined,
    content: [paragraphNode],
  };

  // Wrap in appropriate list type
  return {
    type: node.listStyle === 'ordered' ? 'orderedList' : 'bulletList',
    content: [listItem],
  };
}

/**
 * Convert a paragraph with isBlockQuote to TipTap blockquote.
 * This is VISUAL formatting only - NOT a Bible passage!
 */
function convertBlockQuoteParagraphToTipTap(
  node: ParagraphNode & { isBlockQuote: true },
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

  // Build attrs - NO Bible metadata here, just node ID and formatting
  const attrs: Record<string, unknown> = {};
  if (preserveIds) {
    attrs.nodeId = node.id;
  }
  if (node.textAlign) {
    attrs.textAlign = node.textAlign;
  }

  // Wrap content in a paragraph inside the blockquote
  const paragraphContent: TipTapNode = {
    type: 'paragraph',
    content: content.length > 0 ? content : [],
  };

  return {
    type: 'blockquote',
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    content: [paragraphContent],
  };
}

/**
 * Convert Bible passage to TipTap.
 * Uses blockquote with isBiblePassage=true to distinguish from visual block quotes.
 * This keeps Bible passages semantically distinct from visual block quotes.
 */
function convertPassageToTipTap(
  node: PassageNode,
  options: ConversionOptions
): TipTapNode {
  const { preserveIds, includeMetadata } = options;
  const content: TipTapNode[] = [];

  // Convert children (TextNode and InterjectionNode)
  for (const child of node.children) {
    const converted = convertNodeToTipTap(child, options);
    if (converted) {
      // Wrap text nodes in paragraphs
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

  // Build attrs with metadata - ALWAYS mark as Bible passage
  const attrs: Record<string, unknown> = {
    isBiblePassage: true, // Key differentiator from visual blockquote
  };
  if (preserveIds) {
    attrs.nodeId = node.id;
  }
  if (includeMetadata && node.metadata.reference) {
    attrs.reference = node.metadata.reference.normalizedReference;
    attrs.book = node.metadata.reference.book;
    attrs.chapter = node.metadata.reference.chapter;
    attrs.verseStart = node.metadata.reference.verseStart;
    attrs.verseEnd = node.metadata.reference.verseEnd;
    attrs.originalText = node.metadata.reference.originalText;
  }
  if (includeMetadata && node.metadata.detection) {
    attrs.translation = node.metadata.detection.translation;
    attrs.confidence = node.metadata.detection.confidence;
  }
  if (includeMetadata) {
    attrs.userVerified = node.metadata.userVerified;
  }

  return {
    type: 'blockquote',
    attrs,
    content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
  };
}

// ============================================================================
// TIPTAP TO AST
// ============================================================================

/**
 * Convert TipTap JSON document to DocumentRootNode.
 *
 * TipTap headings become ParagraphNode with headingLevel.
 * TipTap lists become ParagraphNode with listStyle.
 *
 * @param doc - TipTap document JSON
 * @param options - Conversion options
 * @param existingRoot - Optional existing root for ID preservation hints
 */
export function tipTapJsonToAst(
  doc: TipTapDocument,
  options: ConversionOptions = {},
  existingRoot?: DocumentRootNode
): ConversionResult<DocumentRootNode> {
  const { preserveIds = true } = options;
  const warnings: string[] = [];

  try {
    const children: DocumentNode[] = [];
    let title: string | undefined;
    let biblePassage: string | undefined;
    let speaker: string | undefined;
    let isFirstNode = true;  // Track if we're processing the first node

    // Safety check for empty or invalid document content
    if (!doc.content || !Array.isArray(doc.content)) {
      console.warn('[tipTapJsonToAst] Invalid document content:', doc.content);
      // Return empty document with preserved metadata from existing root
      const rootId = preserveIds 
        ? (existingRoot?.id || 'root-1' as NodeId)
        : createNodeId();
      
      return {
        success: true,
        data: {
          id: rootId,
          type: 'document',
          version: 1,
          updatedAt: createTimestamp(),
          title: existingRoot?.title,
          biblePassage: existingRoot?.biblePassage,
          speaker: existingRoot?.speaker,
          children: [],
        },
        warnings: ['Document content was empty or invalid'],
      };
    }

    for (const node of doc.content) {
      // Extract title from FIRST H1 ONLY if it's centered (auto-generated title format)
      // User-created H1s (not centered) should be preserved as paragraphs with headingLevel
      if (
        node.type === 'heading' && 
        node.attrs?.level === 1 && 
        !title && 
        isFirstNode &&
        node.attrs?.textAlign === 'center'  // Only treat centered H1 as title
      ) {
        title = extractText(node);
        isFirstNode = false;
        continue;
      }
      
      isFirstNode = false;

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
        if (text.startsWith('Speaker:')) {
          speaker = text.replace(/^Speaker:\s*/, '');
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

    // Preserve root ID from existing document or attrs, fallback to constant
    const rootId = preserveIds 
      ? (existingRoot?.id || 'root-1' as NodeId)
      : createNodeId();

    const root: DocumentRootNode = {
      id: rootId,
      type: 'document',
      version: 1,
      updatedAt: createTimestamp(),
      title: title || existingRoot?.title,
      biblePassage: biblePassage || existingRoot?.biblePassage,
      speaker: speaker || existingRoot?.speaker,
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
 *
 * TipTap headings become ParagraphNode with headingLevel.
 * TipTap lists become ParagraphNode with listStyle.
 * TipTap blockquotes are distinguished:
 *   - With isBiblePassage=true or Bible metadata → PassageNode
 *   - Without Bible metadata → ParagraphNode with isBlockQuote=true (VISUAL formatting)
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
      // CRITICAL: Distinguish between Bible passages and visual block quotes
      return convertTipTapBlockquoteOrPassage(node, options);

    case 'heading':
      // Headings become paragraphs with headingLevel
      return convertTipTapHeadingToParagraph(node, options);

    case 'bulletList':
    case 'orderedList':
      // Lists become array of paragraphs with listStyle
      return convertTipTapListToParagraphs(node, options);

    case 'listItem':
      // List items handled by parent list converter
      return null;

    case 'text': {
      // Check for interjection mark
      if (node.marks?.some((m) => m.type === 'interjection')) {
        return convertTipTapInterjection(node);
      }
      
      // Filter out interjection marks and preserve all other marks (bold, italic, etc.)
      const otherMarks = node.marks?.filter((m) => m.type !== 'interjection');
      
      const textNode: TextNode = {
        id: preserveIds && node.attrs?.nodeId
          ? (node.attrs.nodeId as NodeId)
          : createNodeId(),
        type: 'text',
        version: 1,
        updatedAt: createTimestamp(),
        content: node.text || '',
      };
      
      // Preserve formatting marks if present
      if (otherMarks && otherMarks.length > 0) {
        textNode.marks = otherMarks.map(mark => ({
          type: mark.type,
          attrs: mark.attrs as Record<string, unknown> | undefined,
        }));
      }
      
      return textNode;
    }

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

  const result: ParagraphNode = {
    id: preserveIds && node.attrs?.nodeId
      ? (node.attrs.nodeId as NodeId)
      : createNodeId(),
    type: 'paragraph',
    version: 1,
    updatedAt: createTimestamp(),
    children,
  };

  // Preserve textAlign if present
  if (node.attrs?.textAlign) {
    result.textAlign = node.attrs.textAlign as 'left' | 'center' | 'right' | 'justify';
  }

  return result;
}

/**
 * Convert TipTap blockquote to either PassageNode (Bible passage) or
 * ParagraphNode with isBlockQuote=true (visual formatting).
 * 
 * CRITICAL: This function distinguishes between:
 * 1. Bible passages (have isBiblePassage=true or reference/book metadata)
 * 2. Visual block quotes (no Bible metadata - just indented text)
 */
function convertTipTapBlockquoteOrPassage(
  node: TipTapNode,
  options: ConversionOptions
): PassageNode | ParagraphNode {
  const attrs = node.attrs || {};
  
  // Check if this is a Bible passage (has Bible-specific metadata)
  const isBiblePassage = 
    attrs.isBiblePassage === true ||
    attrs.reference !== undefined ||
    attrs.book !== undefined;
  
  if (isBiblePassage) {
    return convertTipTapToPassage(node, options);
  } else {
    // This is a VISUAL block quote (formatting only)
    return convertTipTapToBlockQuoteParagraph(node, options);
  }
}

/**
 * Convert TipTap blockquote to PassageNode (Bible passage with metadata).
 */
function convertTipTapToPassage(
  node: TipTapNode,
  options: ConversionOptions
): PassageNode {
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
  const metadata: PassageMetadata = {
    reference: {
      book: (attrs.book as string) || extractBook(refString),
      chapter: (attrs.chapter as number) || 0,
      verseStart: (attrs.verseStart as number) || null,
      verseEnd: (attrs.verseEnd as number) ?? null,
      originalText: (attrs.originalText as string) || refString,
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
    type: 'passage',
    version: 1,
    updatedAt: createTimestamp(),
    metadata,
    children,
  };
}

/**
 * Convert TipTap blockquote to ParagraphNode with isBlockQuote=true (visual formatting).
 * This is for user-created visual block quotes, NOT Bible passages.
 */
function convertTipTapToBlockQuoteParagraph(
  node: TipTapNode,
  options: ConversionOptions
): ParagraphNode {
  const { preserveIds } = options;
  const attrs = node.attrs || {};
  const children: DocumentNode[] = [];

  // Extract content from blockquote
  if (node.content) {
    for (const child of node.content) {
      if (child.type === 'paragraph' && child.content) {
        // Flatten paragraph content into our paragraph
        for (const textNode of child.content) {
          const converted = convertTipTapToNode(textNode, options);
          if (converted) {
            children.push(converted);
          }
        }
      } else {
        // Handle other node types
        const converted = convertTipTapToNode(child, options);
        if (converted) {
          children.push(converted);
        }
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
    id: preserveIds && attrs.nodeId
      ? (attrs.nodeId as NodeId)
      : createNodeId(),
    type: 'paragraph',
    version: 1,
    updatedAt: createTimestamp(),
    children,
    isBlockQuote: true, // Mark as visual block quote formatting
    textAlign: attrs.textAlign as 'left' | 'center' | 'right' | 'justify' | undefined,
  };
}

/**
 * Convert TipTap heading to ParagraphNode with headingLevel.
 */
function convertTipTapHeadingToParagraph(
  node: TipTapNode,
  options: ConversionOptions
): ParagraphNode {
  const { preserveIds } = options;
  const children: DocumentNode[] = [];
  // Clamp level to 1-3
  const rawLevel = (node.attrs?.level as number) || 1;
  const level = Math.min(3, Math.max(1, rawLevel)) as 1 | 2 | 3;

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

  const result: ParagraphNode = {
    id: preserveIds && node.attrs?.nodeId
      ? (node.attrs.nodeId as NodeId)
      : createNodeId(),
    type: 'paragraph',
    version: 1,
    updatedAt: createTimestamp(),
    children,
    headingLevel: level,
  };

  // Preserve textAlign if present
  if (node.attrs?.textAlign) {
    result.textAlign = node.attrs.textAlign as 'left' | 'center' | 'right' | 'justify';
  }

  return result;
}

/**
 * Convert TipTap list to array of ParagraphNodes with listStyle.
 * Returns first item - caller should handle multiple items.
 */
function convertTipTapListToParagraphs(
  node: TipTapNode,
  options: ConversionOptions
): ParagraphNode | null {
  const listStyle: 'bullet' | 'ordered' = node.type === 'orderedList' ? 'ordered' : 'bullet';
  const items = node.content || [];

  // Convert first list item (TipTap typically flattens during sync)
  if (items.length === 0) {
    return null;
  }

  const listItem = items[0]!;
  const { preserveIds } = options;
  const children: DocumentNode[] = [];

  // List items contain paragraphs
  if (listItem.content) {
    for (const child of listItem.content) {
      if (child.type === 'paragraph' && child.content) {
        for (const textChild of child.content) {
          const converted = convertTipTapToNode(textChild, options);
          if (converted) {
            children.push(converted);
          }
        }
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
    id: preserveIds && listItem.attrs?.nodeId
      ? (listItem.attrs.nodeId as NodeId)
      : createNodeId(),
    type: 'paragraph',
    version: 1,
    updatedAt: createTimestamp(),
    children,
    listStyle,
    listNumber: listStyle === 'ordered' ? 1 : undefined,
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
    // Handle heading formatting
    if (node.headingLevel) {
      return `<h${node.headingLevel}>${content}</h${node.headingLevel}>`;
    }
    // Handle list formatting
    if (node.listStyle) {
      const listTag = node.listStyle === 'ordered' ? 'ol' : 'ul';
      return `<${listTag}><li>${content}</li></${listTag}>`;
    }
    // Handle block quote formatting (visual, NOT Bible passage)
    if (node.isBlockQuote) {
      return `<blockquote>${content}</blockquote>`;
    }
    return `<p>${content}</p>`;
  }

  if (isPassageNode(node)) {
    let content = '';
    for (const child of node.children) {
      content += nodeToHtml(child);
    }
    const ref = node.metadata.reference?.normalizedReference ?? 'Unknown';
    return `<div class="bible-passage" data-passage-id="${node.id}" data-reference="${escapeHtml(ref)}">${content}</div>`;
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

    case 'DIV':
    case 'BLOCKQUOTE': {
      const passageId = element.getAttribute('data-passage-id') || element.getAttribute('data-quote-id');
      const reference = element.getAttribute('data-reference');

      // Check if this is a Bible passage (has passage/reference metadata)
      const isBiblePassage = 
        passageId !== null ||
        reference !== null ||
        element.classList.contains('bible-passage') ||
        element.classList.contains('bible-quote') ||
        element.classList.contains('quote-block');

      if (isBiblePassage) {
        // This is a Bible passage - create PassageNode
        const refString = reference || 'Unknown';
        return {
          id: (passageId || createNodeId()) as NodeId,
          type: 'passage',
          version: 1,
          updatedAt: createTimestamp(),
          metadata: {
            reference: {
              book: extractBook(refString),
              chapter: 0,
              verseStart: null,
              verseEnd: null,
              originalText: refString,
              normalizedReference: refString,
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
        } as PassageNode;
      } else if (tagName === 'BLOCKQUOTE') {
        // Visual block quote (formatting only) - create ParagraphNode with isBlockQuote
        return {
          id: createNodeId(),
          type: 'paragraph',
          version: 1,
          updatedAt: createTimestamp(),
          isBlockQuote: true,
          children: extractInlineNodes(element),
        };
      } else {
        // Plain div - create regular paragraph
        return {
          id: createNodeId(),
          type: 'paragraph',
          version: 1,
          updatedAt: createTimestamp(),
          children: extractInlineNodes(element),
        };
      }
    }

    case 'H1':
    case 'H2':
    case 'H3': {
      // H1-H3 become paragraphs with headingLevel
      const levelChar = tagName.charAt(1);
      const level = parseInt(levelChar, 10) as 1 | 2 | 3;
      return {
        id: createNodeId(),
        type: 'paragraph',
        version: 1,
        updatedAt: createTimestamp(),
        headingLevel: level,
        children: extractInlineNodes(element),
      };
    }

    case 'H4':
    case 'H5':
    case 'H6': {
      // H4-H6 clamped to level 3
      return {
        id: createNodeId(),
        type: 'paragraph',
        version: 1,
        updatedAt: createTimestamp(),
        headingLevel: 3,
        children: extractInlineNodes(element),
      };
    }

    case 'UL':
    case 'OL': {
      // Convert list items to paragraphs with listStyle
      const listStyle: 'bullet' | 'ordered' = tagName === 'OL' ? 'ordered' : 'bullet';
      const listItems = element.querySelectorAll(':scope > li');
      if (listItems.length > 0) {
        // Return first item, others would need to be handled separately
        return {
          id: createNodeId(),
          type: 'paragraph',
          version: 1,
          updatedAt: createTimestamp(),
          listStyle,
          listNumber: listStyle === 'ordered' ? 1 : undefined,
          children: extractInlineNodes(listItems[0]!),
        };
      }
      return null;
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
