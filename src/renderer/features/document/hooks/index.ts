/**
 * Document Hooks - barrel export
 */

// Read hooks
export { useDocument, useDocumentSafe } from './useDocument';
export type { UseDocumentResult } from './useDocument';

export { useQuotes } from './useQuotes';
export type { UseQuotesResult, EnrichedQuote, QuoteFilterOptions } from './useQuotes';

export { useNode, useNodeTraversal } from './useNode';
export type { UseNodeResult } from './useNode';

// Write hooks (Phase C)
export { useDocumentMutations } from './useDocumentMutations';
export type { UseDocumentMutationsResult } from './useDocumentMutations';

export { useUndoRedo } from './useUndoRedo';
export type { UseUndoRedoResult, UseUndoRedoOptions } from './useUndoRedo';
