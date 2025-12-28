/**
 * useDocumentMutations - Hook for document mutation operations.
 *
 * This hook provides a stable interface to DocumentMutator methods.
 * It integrates with the DocumentContext to access the current document state
 * and provides mutation callbacks that are safe to use in React components.
 *
 * All mutations go through the event sourcing system, ensuring:
 * - Full audit trail
 * - Undo/redo support
 * - Consistent state updates
 */

import { useCallback, useMemo } from 'react';
import { useDocumentContext } from '../DocumentContext';
import { DocumentMutator, createDocumentMutator, type MutationResult, type CreateQuoteOptions } from '../DocumentMutator';
import type { NodeId, QuoteMetadata } from '../../../../shared/documentModel';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Return type for useDocumentMutations hook.
 */
export interface UseDocumentMutationsResult {
  /** Whether mutations are available (document loaded) */
  canMutate: boolean;

  /** The mutator instance (null if no document) */
  mutator: DocumentMutator | null;

  // --- Text mutations ---
  /** Update text content of a text node */
  updateText: (nodeId: NodeId, newContent: string) => MutationResult | null;
  /** Insert text at offset in a text node */
  insertText: (nodeId: NodeId, offset: number, text: string) => MutationResult | null;
  /** Delete text from a text node */
  deleteText: (nodeId: NodeId, offset: number, length: number) => MutationResult | null;

  // --- Node mutations ---
  /** Create and insert a new paragraph */
  createParagraph: (content: string, parentId: NodeId, index: number) => MutationResult | null;
  /** Delete a node */
  deleteNode: (nodeId: NodeId) => MutationResult | null;

  // --- Quote mutations ---
  /** Create a new quote block */
  createQuote: (options: CreateQuoteOptions) => MutationResult | null;
  /** Remove a quote block */
  removeQuote: (quoteId: NodeId) => MutationResult | null;
  /** Update quote metadata */
  updateQuoteMetadata: (quoteId: NodeId, updates: Partial<QuoteMetadata>) => MutationResult | null;
  /** Verify or unverify a quote */
  verifyQuote: (quoteId: NodeId, verified: boolean, notes?: string) => MutationResult | null;

  // --- Interjection mutations ---
  /** Add an interjection to a quote */
  addInterjection: (quoteId: NodeId, content: string, index: number) => MutationResult | null;
  /** Remove an interjection from a quote */
  removeInterjection: (quoteId: NodeId, interjectionId: NodeId) => MutationResult | null;

  // --- Paragraph mutations ---
  /** Split a paragraph at a character offset */
  splitParagraph: (paragraphId: NodeId, offset: number) => MutationResult | null;
  /** Merge two paragraphs */
  mergeParagraphs: (targetParagraphId: NodeId, mergedParagraphId: NodeId) => MutationResult | null;

  // --- Document metadata ---
  /** Update document title */
  updateTitle: (newTitle: string) => MutationResult | null;
  /** Update document Bible passage */
  updateBiblePassage: (newBiblePassage: string) => MutationResult | null;

  // --- Batch operations ---
  /** Apply multiple mutations as a batch */
  batch: (description: string, mutations: (mutator: DocumentMutator) => void) => MutationResult | null;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Hook for document mutation operations.
 *
 * @example
 * ```tsx
 * function EditPanel() {
 *   const { canMutate, updateText, verifyQuote, undo } = useDocumentMutations();
 *
 *   const handleTextChange = (nodeId: string, text: string) => {
 *     if (canMutate) {
 *       const result = updateText(nodeId, text);
 *       if (!result?.success) {
 *         console.error('Failed to update text:', result?.error);
 *       }
 *     }
 *   };
 *
 *   return (
 *     // ...
 *   );
 * }
 * ```
 */
export function useDocumentMutations(): UseDocumentMutationsResult {
  const { manager, hasDocument } = useDocumentContext();

  // Create mutator from current manager state
  const mutator = useMemo(() => {
    if (!manager || !hasDocument) return null;
    return createDocumentMutator(manager.getState());
  }, [manager, hasDocument]);

  const canMutate = mutator !== null;

  // --- Text mutations ---

  const updateText = useCallback(
    (nodeId: NodeId, newContent: string): MutationResult | null => {
      if (!mutator) return null;
      return mutator.updateText(nodeId, newContent);
    },
    [mutator]
  );

  const insertText = useCallback(
    (nodeId: NodeId, offset: number, text: string): MutationResult | null => {
      if (!mutator) return null;
      return mutator.insertText(nodeId, offset, text);
    },
    [mutator]
  );

  const deleteText = useCallback(
    (nodeId: NodeId, offset: number, length: number): MutationResult | null => {
      if (!mutator) return null;
      return mutator.deleteText(nodeId, offset, length);
    },
    [mutator]
  );

  // --- Node mutations ---

  const createParagraph = useCallback(
    (content: string, parentId: NodeId, index: number): MutationResult | null => {
      if (!mutator) return null;
      return mutator.createParagraph(content, parentId, index);
    },
    [mutator]
  );

  const deleteNode = useCallback(
    (nodeId: NodeId): MutationResult | null => {
      if (!mutator) return null;
      return mutator.deleteNode(nodeId);
    },
    [mutator]
  );

  // --- Quote mutations ---

  const createQuote = useCallback(
    (options: CreateQuoteOptions): MutationResult | null => {
      if (!mutator) return null;
      return mutator.createQuote(options);
    },
    [mutator]
  );

  const removeQuote = useCallback(
    (quoteId: NodeId): MutationResult | null => {
      if (!mutator) return null;
      return mutator.removeQuote(quoteId);
    },
    [mutator]
  );

  const updateQuoteMetadata = useCallback(
    (quoteId: NodeId, updates: Partial<QuoteMetadata>): MutationResult | null => {
      if (!mutator) return null;
      return mutator.updateQuoteMetadata(quoteId, updates);
    },
    [mutator]
  );

  const verifyQuote = useCallback(
    (quoteId: NodeId, verified: boolean, notes?: string): MutationResult | null => {
      if (!mutator) return null;
      return mutator.verifyQuote(quoteId, verified, notes);
    },
    [mutator]
  );

  // --- Interjection mutations ---

  const addInterjection = useCallback(
    (quoteId: NodeId, content: string, index: number): MutationResult | null => {
      if (!mutator) return null;
      return mutator.addInterjection(quoteId, content, index);
    },
    [mutator]
  );

  const removeInterjection = useCallback(
    (quoteId: NodeId, interjectionId: NodeId): MutationResult | null => {
      if (!mutator) return null;
      return mutator.removeInterjection(quoteId, interjectionId);
    },
    [mutator]
  );

  // --- Paragraph mutations ---

  const splitParagraph = useCallback(
    (paragraphId: NodeId, offset: number): MutationResult | null => {
      if (!mutator) return null;
      return mutator.splitParagraph(paragraphId, offset);
    },
    [mutator]
  );

  const mergeParagraphs = useCallback(
    (targetParagraphId: NodeId, mergedParagraphId: NodeId): MutationResult | null => {
      if (!mutator) return null;
      return mutator.mergeParagraphs(targetParagraphId, mergedParagraphId);
    },
    [mutator]
  );

  // --- Document metadata ---

  const updateTitle = useCallback(
    (newTitle: string): MutationResult | null => {
      if (!mutator) return null;
      return mutator.updateTitle(newTitle);
    },
    [mutator]
  );

  const updateBiblePassage = useCallback(
    (newBiblePassage: string): MutationResult | null => {
      if (!mutator) return null;
      return mutator.updateBiblePassage(newBiblePassage);
    },
    [mutator]
  );

  // --- Batch operations ---

  const batch = useCallback(
    (description: string, mutations: (mutator: DocumentMutator) => void): MutationResult | null => {
      if (!mutator) return null;
      return mutator.batch(description, mutations);
    },
    [mutator]
  );

  return {
    canMutate,
    mutator,
    updateText,
    insertText,
    deleteText,
    createParagraph,
    deleteNode,
    createQuote,
    removeQuote,
    updateQuoteMetadata,
    verifyQuote,
    addInterjection,
    removeInterjection,
    splitParagraph,
    mergeParagraphs,
    updateTitle,
    updateBiblePassage,
    batch,
  };
}

export default useDocumentMutations;
