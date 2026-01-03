/**
 * usePassages Hook
 *
 * Provides access to Bible passages in the document.
 * Specialized hook for passage-related functionality.
 */

import { useCallback, useMemo } from 'react';
import { useDocumentContext } from '../DocumentContext';
import type {
  PassageNode,
  PassageMetadata,
  NodeId,
  ConfidenceLevel,
} from '../../../../shared/documentModel';

/**
 * Passage with additional computed properties.
 */
export interface EnrichedPassage extends PassageNode {
  /** Index in document order (0-based) */
  index: number;
  /** Full text content of the passage */
  text: string;
  /** Normalized reference string */
  reference: string;
  /** Book name */
  book: string;
  /** Confidence level */
  confidenceLevel: ConfidenceLevel;
  /** Number of interjections */
  interjectionCount: number;
}

/**
 * Filter options for passages.
 */
export interface PassageFilterOptions {
  /** Filter by minimum confidence */
  minConfidence?: number;
  /** Filter by confidence level */
  confidenceLevel?: ConfidenceLevel;
  /** Filter by book name */
  book?: string;
  /** Filter by user verification status */
  verified?: boolean;
}

/**
 * Return type for usePassages hook.
 */
export interface UsePassagesResult {
  /** Whether there are any passages */
  hasPassages: boolean;

  /** Total number of passages */
  passageCount: number;

  /** All passages in document order */
  passages: PassageNode[];

  /** All passages with enriched properties */
  enrichedPassages: EnrichedPassage[];

  /** Unique book names with passage counts */
  bookSummary: { book: string; count: number }[];

  /** Get a passage by ID */
  getPassageById: (passageId: NodeId) => PassageNode | undefined;

  /** Get passages by reference */
  getPassagesByReference: (reference: string) => PassageNode[];

  /** Get passages by book */
  getPassagesByBook: (book: string) => PassageNode[];

  /** Get passage metadata */
  getPassageMetadata: (passageId: NodeId) => PassageMetadata | undefined;

  /** Get passage text content */
  getPassageText: (passageId: NodeId) => string;

  /** Filter passages by criteria */
  filterPassages: (options: PassageFilterOptions) => PassageNode[];
}

/**
 * Hook for accessing and filtering Bible passages.
 *
 * @example
 * ```tsx
 * function PassageList() {
 *   const { hasPassages, enrichedPassages, bookSummary } = usePassages();
 *
 *   if (!hasPassages) {
 *     return <div>No passages found</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <h2>Books Referenced:</h2>
 *       <ul>
 *         {bookSummary.map(({ book, count }) => (
 *           <li key={book}>{book}: {count} passages</li>
 *         ))}
 *       </ul>
 *
 *       <h2>All Passages:</h2>
 *       {enrichedPassages.map(passage => (
 *         <PassageBlockRenderer key={passage.id} passage={passage} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePassages(): UsePassagesResult {
  const context = useDocumentContext();

  // Get enriched passages with computed properties
  const enrichedPassages = useMemo((): EnrichedPassage[] => {
    return context.passages.map((passage, index) => {
      // Extract text from children
      let text = '';
      let interjectionCount = 0;

      passage.children.forEach((child) => {
        if (child.type === 'text') {
          text += child.content;
        } else if (child.type === 'interjection') {
          interjectionCount++;
        }
      });

      return {
        ...passage,
        index,
        text: text.trim(),
        reference: passage.metadata.reference?.normalizedReference ?? 'Unknown',
        book: passage.metadata.reference?.book ?? 'Unknown',
        confidenceLevel: passage.metadata.detection?.confidenceLevel ?? 'low',
        interjectionCount,
      };
    });
  }, [context.passages]);

  // Get book summary
  const bookSummary = useMemo(() => {
    const bookCounts = new Map<string, number>();

    context.passages.forEach((passage) => {
      const book = passage.metadata.reference?.book ?? 'Unknown';
      bookCounts.set(book, (bookCounts.get(book) || 0) + 1);
    });

    return Array.from(bookCounts.entries())
      .map(([book, count]) => ({ book, count }))
      .sort((a, b) => a.book.localeCompare(b.book));
  }, [context.passages]);

  // Get passage by ID with metadata
  const getPassageMetadata = useCallback(
    (passageId: NodeId): PassageMetadata | undefined => {
      const passage = context.getPassageById(passageId);
      return passage?.metadata;
    },
    [context]
  );

  // Get passage text
  const getPassageText = useCallback(
    (passageId: NodeId): string => {
      return context.getNodeText(passageId);
    },
    [context]
  );

  // Filter passages
  const filterPassages = useCallback(
    (options: PassageFilterOptions): PassageNode[] => {
      let filtered = context.passages;

      if (options.minConfidence !== undefined) {
        filtered = filtered.filter(
          (p) => (p.metadata.detection?.confidence ?? 0) >= options.minConfidence!
        );
      }

      if (options.confidenceLevel !== undefined) {
        filtered = filtered.filter(
          (p) => p.metadata.detection?.confidenceLevel === options.confidenceLevel
        );
      }

      if (options.book !== undefined) {
        filtered = filtered.filter((p) => p.metadata.reference?.book === options.book);
      }

      if (options.verified !== undefined) {
        filtered = filtered.filter((p) => p.metadata.userVerified === options.verified);
      }

      return filtered;
    },
    [context.passages]
  );

  return {
    hasPassages: context.passages.length > 0,
    passageCount: context.passages.length,
    passages: context.passages,
    enrichedPassages,
    bookSummary,
    getPassageById: context.getPassageById,
    getPassagesByReference: context.getPassagesByReference,
    getPassagesByBook: context.getPassagesByBook,
    getPassageMetadata,
    getPassageText,
    filterPassages,
  };
}

export default usePassages;
