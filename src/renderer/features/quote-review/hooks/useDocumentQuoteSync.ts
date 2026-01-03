/**
 * useDocumentQuoteSync Hook
 *
 * Syncs quote review state with the document AST model:
 * - Extracts quotes from document nodes
 * - Applies quote changes back to document
 * - Handles paragraph merging
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQuoteReview } from '../../../contexts';
import type {
  DocumentRootNode,
  NodeId,
  PassageNode,
  ParagraphNode,
  DocumentNode,
} from '../../../../shared/documentModel';
import type { QuoteReviewItem } from '../../../types/quoteReview';

interface UseDocumentQuoteSyncOptions {
  /** Current document root */
  document: DocumentRootNode | null;
  /** Callback when document should be updated */
  onDocumentUpdate?: (updatedDocument: DocumentRootNode) => void;
  /** Callback when quotes are extracted */
  onQuotesExtracted?: (quotes: QuoteReviewItem[]) => void;
}

interface DocumentQuoteSyncActions {
  /** Extract quotes from document and sync to context */
  syncQuotesFromDocument: () => void;
  /** Apply quote changes to document */
  applyQuoteToDocument: (quote: QuoteReviewItem) => void;
  /** Remove quote from document */
  removeQuoteFromDocument: (quoteId: NodeId) => void;
  /** Merge paragraphs in document */
  mergeParagraphs: (paragraphIds: NodeId[]) => void;
  /** Update quote boundaries in document */
  updateQuoteBoundaries: (quoteId: NodeId, startOffset: number, endOffset: number) => void;
  /** Get paragraph by ID */
  getParagraph: (paragraphId: NodeId) => ParagraphNode | null;
  /** Get passage node by ID */
  getQuoteNode: (quoteId: NodeId) => PassageNode | null;
}

/**
 * Helper to extract text content from a node
 */
function extractTextFromNode(node: PassageNode | ParagraphNode): string {
  if ('children' in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => {
        if ('content' in child) return child.content;
        if ('children' in child) return extractTextFromNode(child as unknown as PassageNode);
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * Type guard for PassageNode
 */
function isPassageNode(node: DocumentNode): node is PassageNode {
  return node.type === 'passage';
}

/**
 * Type guard for ParagraphNode
 */
function isParagraphNode(node: DocumentNode): node is ParagraphNode {
  return node.type === 'paragraph';
}

/**
 * Helper to find all passage nodes in document
 */
function findPassageNodes(document: DocumentRootNode): PassageNode[] {
  const passages: PassageNode[] = [];

  function traverse(children: DocumentNode[]) {
    for (const child of children) {
      if (isPassageNode(child)) {
        passages.push(child);
      } else if ('children' in child && Array.isArray(child.children)) {
        traverse(child.children as DocumentNode[]);
      }
    }
  }

  traverse(document.children);
  return passages;
}

/**
 * Helper to find all paragraph nodes in document
 */
function findParagraphNodes(document: DocumentRootNode): ParagraphNode[] {
  const paragraphs: ParagraphNode[] = [];

  function traverse(children: DocumentNode[]) {
    for (const child of children) {
      if (isParagraphNode(child)) {
        paragraphs.push(child);
      } else if ('children' in child && Array.isArray(child.children)) {
        traverse(child.children as DocumentNode[]);
      }
    }
  }

  traverse(document.children);
  return paragraphs;
}

/**
 * Hook for syncing quote review state with document model.
 */
export function useDocumentQuoteSync(
  options: UseDocumentQuoteSyncOptions
): DocumentQuoteSyncActions {
  const { document, onDocumentUpdate, onQuotesExtracted } = options;

  const context = useQuoteReview();
  const { setQuotes, updateQuote, removeQuote } = context;

  // Track previous document to detect changes
  const prevDocumentRef = useRef<DocumentRootNode | null>(null);

  /**
   * Extract quotes from document and sync to context
   */
  const syncQuotesFromDocument = useCallback(() => {
    if (!document) return;

    const passageNodes = findPassageNodes(document);
    const paragraphNodes = findParagraphNodes(document);

    // Calculate paragraph offsets
    let offset = 0;
    const paragraphOffsets = new Map<NodeId, { start: number; end: number }>();
    for (const para of paragraphNodes) {
      const text = extractTextFromNode(para);
      paragraphOffsets.set(para.id, {
        start: offset,
        end: offset + text.length,
      });
      offset += text.length + 1; // +1 for newline
    }

    // Convert passage nodes to review items
    const quotes: QuoteReviewItem[] = passageNodes.map((node) => {
      const text = extractTextFromNode(node);
      const metadata = node.metadata;

      // Find which paragraph contains this quote
      let paragraphId: NodeId | undefined;
      let startOffset: number | undefined = metadata.startOffset;
      let endOffset: number | undefined = metadata.endOffset;

      // Look for quote in paragraphs (simplified - in real impl would use AST positions)
      for (const para of paragraphNodes) {
        const paraText = extractTextFromNode(para);
        const quoteIndex = paraText.indexOf(text);
        if (quoteIndex !== -1) {
          paragraphId = para.id;
          if (startOffset === undefined) {
            const paraOffsets = paragraphOffsets.get(para.id);
            if (paraOffsets) {
              startOffset = paraOffsets.start + quoteIndex;
              endOffset = startOffset + text.length;
            }
          }
          break;
        }
      }

      // Get reference string with robust fallback
      let reference = metadata.reference?.normalizedReference;

      // Fallback: Construct from parts if normalized reference is missing
      if (!reference && metadata.reference) {
        const { book, chapter, verseStart, verseEnd } = metadata.reference;
        if (book && chapter) {
          reference = `${book} ${chapter}`;
          if (verseStart) {
            reference += `:${verseStart}`;
            if (verseEnd) {
              reference += `-${verseEnd}`;
            }
          }
        }
      }

      // Fallback: Use original text if available
      if (!reference && metadata.reference?.originalText) {
        reference = metadata.reference.originalText;
      }


      // Get interjection texts
      const interjections = metadata.interjections?.map((i) => i.text) || [];

      return {
        id: node.id,
        text,
        reference,
        isNonBiblical: metadata.isNonBiblicalPassage ?? false,
        isReviewed: metadata.userVerified ?? false,
        interjections,
        startOffset,
        endOffset,
        paragraphId,
      };
    });

    setQuotes(quotes);

    if (onQuotesExtracted) {
      onQuotesExtracted(quotes);
    }
  }, [document, setQuotes, onQuotesExtracted]);

  // Auto-sync when document changes
  useEffect(() => {
    if (document && document !== prevDocumentRef.current) {
      syncQuotesFromDocument();
      prevDocumentRef.current = document;
    }
  }, [document, syncQuotesFromDocument]);

  /**
   * Apply quote changes to document
   */
  const applyQuoteToDocument = useCallback((quote: QuoteReviewItem) => {
    if (!document || !onDocumentUpdate) return;

    // Find and update the quote node in document
    const updatedChildren = document.children.map((child) => {
      if (isPassageNode(child) && child.id === quote.id) {
        return {
          ...child,
          metadata: {
            ...child.metadata,
            userVerified: quote.isReviewed,
            isNonBiblicalPassage: quote.isNonBiblical,
            // Note: reference updates would need more complex handling
          },
        };
      }
      return child;
    });

    onDocumentUpdate({
      ...document,
      children: updatedChildren,
    });
  }, [document, onDocumentUpdate]);

  /**
   * Remove quote from document
   */
  const removeQuoteFromDocument = useCallback((quoteId: NodeId) => {
    if (!document || !onDocumentUpdate) return;

    // Find the passage and convert back to regular text
    const updatedChildren = document.children.flatMap((child) => {
      if (isPassageNode(child) && child.id === quoteId) {
        // Convert passage children back to regular paragraph
        const paragraphNode: ParagraphNode = {
          type: 'paragraph',
          id: `para_from_quote_${quoteId}`,
          version: 1,
          updatedAt: new Date().toISOString(),
          children: child.children,
        };
        return paragraphNode;
      }
      return child;
    });

    onDocumentUpdate({
      ...document,
      children: updatedChildren,
    });

    // Also remove from context
    removeQuote(quoteId);
  }, [document, onDocumentUpdate, removeQuote]);

  /**
   * Merge paragraphs in document
   */
  const mergeParagraphs = useCallback((paragraphIds: NodeId[]) => {
    if (!document || !onDocumentUpdate || paragraphIds.length < 2) return;

    const paragraphsToMerge = new Set(paragraphIds);
    const mergedChildren: DocumentNode[] = [];
    let mergeTarget: ParagraphNode | null = null;
    let mergedContent: ParagraphNode['children'] = [];

    for (const child of document.children) {
      if (isParagraphNode(child) && paragraphsToMerge.has(child.id)) {
        if (!mergeTarget) {
          // First paragraph becomes the merge target
          mergeTarget = child;
          mergedContent = [...child.children];
        } else {
          // Append content from subsequent paragraphs
          mergedContent = [...mergedContent, ...child.children];
        }
      } else {
        // If we were merging, add the merged paragraph
        if (mergeTarget) {
          mergedChildren.push({
            ...mergeTarget,
            children: mergedContent,
          });
          mergeTarget = null;
          mergedContent = [];
        }
        mergedChildren.push(child);
      }
    }

    // Don't forget the last merged paragraph
    if (mergeTarget) {
      mergedChildren.push({
        ...mergeTarget,
        children: mergedContent,
      });
    }

    onDocumentUpdate({
      ...document,
      children: mergedChildren,
    });
  }, [document, onDocumentUpdate]);

  /**
   * Update quote boundaries in document
   */
  const updateQuoteBoundaries = useCallback((
    quoteId: NodeId,
    newStartOffset: number,
    newEndOffset: number
  ) => {
    // This would require more complex AST manipulation
    // For now, update the context state
    updateQuote(quoteId, {
      startOffset: newStartOffset,
      endOffset: newEndOffset,
    });
  }, [updateQuote]);

  /**
   * Get paragraph by ID
   */
  const getParagraph = useCallback((paragraphId: NodeId): ParagraphNode | null => {
    if (!document) return null;

    const paragraphs = findParagraphNodes(document);
    return paragraphs.find((p) => p.id === paragraphId) ?? null;
  }, [document]);

  /**
   * Get passage node by ID
   */
  const getQuoteNode = useCallback((quoteId: NodeId): PassageNode | null => {
    if (!document) return null;

    const passages = findPassageNodes(document);
    return passages.find((q) => q.id === quoteId) ?? null;
  }, [document]);

  return {
    syncQuotesFromDocument,
    applyQuoteToDocument,
    removeQuoteFromDocument,
    mergeParagraphs,
    updateQuoteBoundaries,
    getParagraph,
    getQuoteNode,
  };
}

export default useDocumentQuoteSync;
