/**
 * DocumentContext - React context for the Hybrid AST + Event Log architecture.
 *
 * Provides:
 * - DocumentManager instance
 * - Convenience hooks for accessing document state
 * - Memoized values for performance
 *
 * This context integrates with the existing AppContext pattern.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DocumentManager, createDocumentManager } from './DocumentManager';
import type { QuoteBlockNode, ParagraphNode, NodeId } from '../../../shared/documentModel';
import type { SermonDocument } from '../../types';
import type { DocumentStatistics, NodeWithPath } from './DocumentManager';

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Document context value interface.
 */
export interface DocumentContextValue {
  /** The DocumentManager instance */
  manager: DocumentManager | null;

  /** Whether a document is loaded */
  hasDocument: boolean;

  /** Whether this is a legacy (body-only) document */
  isLegacy: boolean;

  // --- Quick accessors (memoized) ---

  /** Document title */
  title: string | undefined;

  /** Main Bible passage */
  biblePassage: string | undefined;

  /** Total word count */
  wordCount: number;

  /** Document statistics */
  statistics: DocumentStatistics | null;

  /** All quotes in document order */
  quotes: QuoteBlockNode[];

  /** All paragraphs */
  paragraphs: ParagraphNode[];

  /** Extracted references (for backward compatibility) */
  references: string[];

  /** Extracted tags (for backward compatibility) */
  tags: string[];

  // --- Node access methods ---

  /** Get a node by ID */
  getNodeById: (nodeId: NodeId) => ReturnType<DocumentManager['getNodeById']>;

  /** Get a node with path info */
  getNodeWithPath: (nodeId: NodeId) => NodeWithPath | undefined;

  /** Get a quote by ID */
  getQuoteById: (quoteId: NodeId) => QuoteBlockNode | undefined;

  /** Get quotes by reference */
  getQuotesByReference: (reference: string) => QuoteBlockNode[];

  /** Get quotes by book */
  getQuotesByBook: (book: string) => QuoteBlockNode[];

  /** Extract plain text */
  extractText: (options?: Parameters<DocumentManager['extractText']>[0]) => string;

  /** Get text content of a node */
  getNodeText: (nodeId: NodeId) => string;
}

// ============================================================================
// CONTEXT CREATION
// ============================================================================

/**
 * Default context value when no document is loaded.
 */
const defaultContextValue: DocumentContextValue = {
  manager: null,
  hasDocument: false,
  isLegacy: false,
  title: undefined,
  biblePassage: undefined,
  wordCount: 0,
  statistics: null,
  quotes: [],
  paragraphs: [],
  references: [],
  tags: [],
  getNodeById: () => undefined,
  getNodeWithPath: () => undefined,
  getQuoteById: () => undefined,
  getQuotesByReference: () => [],
  getQuotesByBook: () => [],
  extractText: () => '',
  getNodeText: () => '',
};

/**
 * Document context.
 */
export const DocumentContext = createContext<DocumentContextValue>(defaultContextValue);

// ============================================================================
// PROVIDER
// ============================================================================

export interface DocumentProviderProps {
  /** The sermon document from processing pipeline */
  sermonDocument: SermonDocument | null;
  /** Children to render */
  children: ReactNode;
}

/**
 * DocumentProvider - provides document context to children.
 *
 * Usage:
 * ```tsx
 * <DocumentProvider sermonDocument={sermonDocument}>
 *   <DocumentRenderer />
 * </DocumentProvider>
 * ```
 */
export function DocumentProvider({
  sermonDocument,
  children,
}: DocumentProviderProps): React.JSX.Element {
  // Create DocumentManager - memoized to prevent recreation on every render
  const manager = useMemo(() => {
    if (!sermonDocument) return null;
    return createDocumentManager(sermonDocument);
  }, [sermonDocument]);

  // Memoize context value
  const contextValue = useMemo((): DocumentContextValue => {
    if (!manager) {
      return defaultContextValue;
    }

    return {
      manager,
      hasDocument: true,
      isLegacy: manager.getIsLegacy(),
      title: manager.getTitle(),
      biblePassage: manager.getBiblePassage(),
      wordCount: manager.getWordCount(),
      statistics: manager.getStatistics(),
      quotes: manager.getAllQuotes(),
      paragraphs: manager.getParagraphs(),
      references: manager.getReferences(),
      tags: manager.getTags(),

      // Methods - bind to manager instance
      getNodeById: (nodeId) => manager.getNodeById(nodeId),
      getNodeWithPath: (nodeId) => manager.getNodeWithPath(nodeId),
      getQuoteById: (quoteId) => manager.getQuoteById(quoteId),
      getQuotesByReference: (reference) => manager.getQuotesByReference(reference),
      getQuotesByBook: (book) => manager.getQuotesByBook(book),
      extractText: (options) => manager.extractText(options),
      getNodeText: (nodeId) => manager.getNodeText(nodeId),
    };
  }, [manager]);

  return <DocumentContext.Provider value={contextValue}>{children}</DocumentContext.Provider>;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access the document context.
 *
 * @returns DocumentContextValue
 * @throws Error if used outside DocumentProvider
 */
export function useDocumentContext(): DocumentContextValue {
  const context = useContext(DocumentContext);
  if (context === undefined) {
    throw new Error('useDocumentContext must be used within a DocumentProvider');
  }
  return context;
}

/**
 * Hook to check if document context is available (doesn't throw).
 *
 * @returns DocumentContextValue or null if not in provider
 */
export function useDocumentContextSafe(): DocumentContextValue | null {
  const context = useContext(DocumentContext);
  return context ?? null;
}

export default DocumentContext;
