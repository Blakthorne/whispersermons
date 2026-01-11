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
import { DocumentMutator, createDocumentMutator, type MutationResult, type CreatePassageOptions } from '../DocumentMutator';
import type { NodeId, PassageMetadata } from '../../../../shared/documentModel';

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

  // --- Passage mutations ---
  /** Create a new passage block */
  createPassage: (options: CreatePassageOptions) => MutationResult | null;
  /** Remove a passage block */
  removePassage: (passageId: NodeId) => MutationResult | null;
  /** Update passage metadata */
  updatePassageMetadata: (passageId: NodeId, updates: Partial<PassageMetadata>) => MutationResult | null;
  /** Verify or unverify a passage */
  verifyPassage: (passageId: NodeId, verified: boolean, notes?: string) => MutationResult | null;
  /** Change passage boundaries */
  changePassageBoundary: (
    passageId: NodeId,
    options: {
      newStartOffset: number;
      newEndOffset: number;
      newContent: string;
      paragraphsToMerge?: NodeId[];
    }
  ) => MutationResult | null;

  // --- Interjection mutations ---
  /** Add an interjection to a passage */
  addInterjection: (passageId: NodeId, content: string, index: number) => MutationResult | null;
  /** Remove an interjection from a passage */
  removeInterjection: (passageId: NodeId, interjectionId: NodeId) => MutationResult | null;
  /** Change interjection boundaries */
  changeInterjectionBoundary: (
    passageId: NodeId,
    interjectionId: NodeId,
    newOffsetStart: number,
    newOffsetEnd: number,
    newText: string
  ) => MutationResult | null;

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
  /** Update document speaker */
  updateSpeaker: (newSpeaker: string) => MutationResult | null;
  /** Update document tags */
  updateTags: (newTags: string[]) => MutationResult | null;

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

  // --- Passage mutations ---

  const createPassage = useCallback(
    (options: CreatePassageOptions): MutationResult | null => {
      if (!mutator) return null;
      return mutator.createPassage(options);
    },
    [mutator]
  );

  const removePassage = useCallback(
    (passageId: NodeId): MutationResult | null => {
      if (!mutator) return null;
      return mutator.removePassage(passageId);
    },
    [mutator]
  );

  const updatePassageMetadata = useCallback(
    (passageId: NodeId, updates: Partial<PassageMetadata>): MutationResult | null => {
      if (!mutator) return null;
      return mutator.updatePassageMetadata(passageId, updates);
    },
    [mutator]
  );

  const verifyPassage = useCallback(
    (passageId: NodeId, verified: boolean, notes?: string): MutationResult | null => {
      if (!mutator) return null;
      return mutator.verifyPassage(passageId, verified, notes);
    },
    [mutator]
  );

  // --- Interjection mutations ---

  const addInterjection = useCallback(
    (passageId: NodeId, content: string, index: number): MutationResult | null => {
      if (!mutator) return null;
      return mutator.addInterjection(passageId, content, index);
    },
    [mutator]
  );

  const removeInterjection = useCallback(
    (passageId: NodeId, interjectionId: NodeId): MutationResult | null => {
      if (!mutator) return null;
      return mutator.removeInterjection(passageId, interjectionId);
    },
    [mutator]
  );

  const changeInterjectionBoundary = useCallback(
    (
      passageId: NodeId,
      interjectionId: NodeId,
      newOffsetStart: number,
      newOffsetEnd: number,
      newText: string
    ): MutationResult | null => {
      if (!mutator) return null;
      return mutator.changeInterjectionBoundary(
        passageId,
        interjectionId,
        newOffsetStart,
        newOffsetEnd,
        newText
      );
    },
    [mutator]
  );

  const changePassageBoundary = useCallback(
    (
      passageId: NodeId,
      options: {
        newStartOffset: number;
        newEndOffset: number;
        newContent: string;
        paragraphsToMerge?: NodeId[];
      }
    ): MutationResult | null => {
      if (!mutator) return null;
      return mutator.changePassageBoundary(passageId, options);
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

  const updateSpeaker = useCallback(
    (newSpeaker: string): MutationResult | null => {
      if (!mutator) return null;
      return mutator.updateSpeaker(newSpeaker);
    },
    [mutator]
  );

  const updateTags = useCallback(
    (newTags: string[]): MutationResult | null => {
      if (!mutator) return null;
      return mutator.updateTags(newTags);
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
    createPassage,
    removePassage,
    updatePassageMetadata,
    verifyPassage,
    changePassageBoundary,
    addInterjection,
    removeInterjection,
    changeInterjectionBoundary,
    splitParagraph,
    mergeParagraphs,
    updateTitle,
    updateBiblePassage,
    updateSpeaker,
    updateTags,
    batch,
  };
}

export default useDocumentMutations;
