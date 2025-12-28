/**
 * useQuotes Hook
 *
 * Provides access to Bible quotes in the document.
 * Specialized hook for quote-related functionality.
 */

import { useCallback, useMemo } from 'react';
import { useDocumentContext } from '../DocumentContext';
import type {
  QuoteBlockNode,
  QuoteMetadata,
  NodeId,
  ConfidenceLevel,
} from '../../../../shared/documentModel';

/**
 * Quote with additional computed properties.
 */
export interface EnrichedQuote extends QuoteBlockNode {
  /** Index in document order (0-based) */
  index: number;
  /** Full text content of the quote */
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
 * Filter options for quotes.
 */
export interface QuoteFilterOptions {
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
 * Return type for useQuotes hook.
 */
export interface UseQuotesResult {
  /** Whether there are any quotes */
  hasQuotes: boolean;

  /** Total number of quotes */
  quoteCount: number;

  /** All quotes in document order */
  quotes: QuoteBlockNode[];

  /** All quotes with enriched properties */
  enrichedQuotes: EnrichedQuote[];

  /** Unique book names with quote counts */
  bookSummary: { book: string; count: number }[];

  /** Get a quote by ID */
  getQuoteById: (quoteId: NodeId) => QuoteBlockNode | undefined;

  /** Get quotes by reference */
  getQuotesByReference: (reference: string) => QuoteBlockNode[];

  /** Get quotes by book */
  getQuotesByBook: (book: string) => QuoteBlockNode[];

  /** Get quote metadata */
  getQuoteMetadata: (quoteId: NodeId) => QuoteMetadata | undefined;

  /** Get quote text content */
  getQuoteText: (quoteId: NodeId) => string;

  /** Filter quotes by criteria */
  filterQuotes: (options: QuoteFilterOptions) => QuoteBlockNode[];
}

/**
 * Hook for accessing and filtering Bible quotes.
 *
 * @example
 * ```tsx
 * function QuoteList() {
 *   const { hasQuotes, enrichedQuotes, bookSummary } = useQuotes();
 *
 *   if (!hasQuotes) {
 *     return <div>No quotes found</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <h2>Books Referenced:</h2>
 *       <ul>
 *         {bookSummary.map(({ book, count }) => (
 *           <li key={book}>{book}: {count} quotes</li>
 *         ))}
 *       </ul>
 *
 *       <h2>All Quotes:</h2>
 *       {enrichedQuotes.map(quote => (
 *         <QuoteBlockRenderer key={quote.id} quote={quote} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useQuotes(): UseQuotesResult {
  const context = useDocumentContext();

  // Get enriched quotes with computed properties
  const enrichedQuotes = useMemo((): EnrichedQuote[] => {
    return context.quotes.map((quote, index) => {
      // Extract text from children
      let text = '';
      let interjectionCount = 0;

      quote.children.forEach((child) => {
        if (child.type === 'text') {
          text += child.content;
        } else if (child.type === 'interjection') {
          interjectionCount++;
        }
      });

      return {
        ...quote,
        index,
        text: text.trim(),
        reference: quote.metadata.reference.normalizedReference,
        book: quote.metadata.reference.book,
        confidenceLevel: quote.metadata.detection.confidenceLevel,
        interjectionCount,
      };
    });
  }, [context.quotes]);

  // Get book summary
  const bookSummary = useMemo(() => {
    const bookCounts = new Map<string, number>();

    context.quotes.forEach((quote) => {
      const book = quote.metadata.reference.book;
      bookCounts.set(book, (bookCounts.get(book) || 0) + 1);
    });

    return Array.from(bookCounts.entries())
      .map(([book, count]) => ({ book, count }))
      .sort((a, b) => a.book.localeCompare(b.book));
  }, [context.quotes]);

  // Get quote by ID with metadata
  const getQuoteMetadata = useCallback(
    (quoteId: NodeId): QuoteMetadata | undefined => {
      const quote = context.getQuoteById(quoteId);
      return quote?.metadata;
    },
    [context]
  );

  // Get quote text
  const getQuoteText = useCallback(
    (quoteId: NodeId): string => {
      return context.getNodeText(quoteId);
    },
    [context]
  );

  // Filter quotes
  const filterQuotes = useCallback(
    (options: QuoteFilterOptions): QuoteBlockNode[] => {
      let filtered = context.quotes;

      if (options.minConfidence !== undefined) {
        filtered = filtered.filter(
          (q) => q.metadata.detection.confidence >= options.minConfidence!
        );
      }

      if (options.confidenceLevel !== undefined) {
        filtered = filtered.filter(
          (q) => q.metadata.detection.confidenceLevel === options.confidenceLevel
        );
      }

      if (options.book !== undefined) {
        filtered = filtered.filter((q) => q.metadata.reference.book === options.book);
      }

      if (options.verified !== undefined) {
        filtered = filtered.filter((q) => q.metadata.userVerified === options.verified);
      }

      return filtered;
    },
    [context.quotes]
  );

  return {
    hasQuotes: context.quotes.length > 0,
    quoteCount: context.quotes.length,
    quotes: context.quotes,
    enrichedQuotes,
    bookSummary,
    getQuoteById: context.getQuoteById,
    getQuotesByReference: context.getQuotesByReference,
    getQuotesByBook: context.getQuotesByBook,
    getQuoteMetadata,
    getQuoteText,
    filterQuotes,
  };
}

export default useQuotes;
