/**
 * useDocument Hook
 *
 * Provides access to the document state and manager.
 * Primary hook for consuming document data in components.
 */

import { useCallback, useMemo } from 'react';
import { useDocumentContext, useDocumentContextSafe } from '../DocumentContext';
import type { DocumentManager, DocumentStatistics, TextExtractionOptions } from '../DocumentManager';
import type {
  DocumentState,
  DocumentRootNode,
  DocumentNode,
  ParagraphNode,
  NodeId,
} from '../../../../shared/documentModel';

/**
 * Return type for useDocument hook.
 */
export interface UseDocumentResult {
  /** Whether a document is loaded */
  hasDocument: boolean;

  /** Whether this is a legacy (body-only) document */
  isLegacy: boolean;

  /** The DocumentManager instance (null if no document) */
  manager: DocumentManager | null;

  /** The full DocumentState (null if no document) */
  state: DocumentState | null;

  /** The root document node (null if no document) */
  root: DocumentRootNode | null;

  /** Document title */
  title: string | undefined;

  /** Main Bible passage */
  biblePassage: string | undefined;

  /** Speaker/Author (from audio metadata) */
  speaker: string | undefined;

  /** Total word count */
  wordCount: number;

  /** Document statistics */
  statistics: DocumentStatistics | null;

  /** All paragraphs */
  paragraphs: ParagraphNode[];

  /** All headings (paragraphs with headingLevel formatting) */
  headings: (ParagraphNode & { headingLevel: 1 | 2 | 3 })[];

  /** Extracted references (for backward compatibility) */
  references: string[];

  /** Extracted tags (for backward compatibility) */
  tags: string[];

  /** Extract plain text from document */
  extractText: (options?: TextExtractionOptions) => string;

  /** Get a node by ID */
  getNodeById: (nodeId: NodeId) => DocumentNode | undefined;

  /** Get text content of a node */
  getNodeText: (nodeId: NodeId) => string;
}

/**
 * Hook for accessing the document state and utilities.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { hasDocument, title, wordCount, paragraphs } = useDocument();
 *
 *   if (!hasDocument) {
 *     return <div>No document loaded</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <h1>{title}</h1>
 *       <p>Word count: {wordCount}</p>
 *       {paragraphs.map(p => <ParagraphRenderer key={p.id} node={p} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDocument(): UseDocumentResult {
  const context = useDocumentContext();

  // Get state and root from manager
  const state = useMemo(() => {
    return context.manager?.getState() ?? null;
  }, [context.manager]);

  const root = useMemo(() => {
    return context.manager?.getRoot() ?? null;
  }, [context.manager]);

  // Get headings
  const headings = useMemo(() => {
    return context.manager?.getHeadings() ?? [];
  }, [context.manager]);

  // Memoized extractText with stable reference
  const extractText = useCallback(
    (options?: TextExtractionOptions): string => {
      return context.extractText(options);
    },
    [context.extractText]
  );

  // Memoized getNodeById with stable reference
  const getNodeById = useCallback(
    (nodeId: NodeId): DocumentNode | undefined => {
      return context.getNodeById(nodeId);
    },
    [context.getNodeById]
  );

  // Memoized getNodeText with stable reference
  const getNodeText = useCallback(
    (nodeId: NodeId): string => {
      return context.getNodeText(nodeId);
    },
    [context.getNodeText]
  );

  return {
    hasDocument: context.hasDocument,
    isLegacy: context.isLegacy,
    manager: context.manager,
    state,
    root,
    title: context.title,
    biblePassage: context.biblePassage,
    speaker: context.speaker,
    wordCount: context.wordCount,
    statistics: context.statistics,
    paragraphs: context.paragraphs,
    headings,
    references: context.references,
    tags: context.tags,
    extractText,
    getNodeById,
    getNodeText,
  };
}

/**
 * Safe version of useDocument that returns null if not in provider.
 * Useful for optional document features.
 */
export function useDocumentSafe(): UseDocumentResult | null {
  const context = useDocumentContextSafe();

  if (!context) {
    return null;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useDocument();
}

export default useDocument;
