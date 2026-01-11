/**
 * useInterjectionPanel Hook
 *
 * Manages state and actions for the InterjectionSidePanel:
 * - Selected interjection tracking
 * - Boundary change handling
 * - Editor highlight synchronization
 * - Add/remove interjection actions
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  NodeId,
  PassageNode,
  InterjectionMetadata,
} from '../../../../shared/documentModel';
import { useDocumentMutations } from '../../document';

interface UseInterjectionPanelOptions {
  /** The passage being edited */
  passage: PassageNode | null;
  /** Callback when an interjection is selected for highlighting */
  onInterjectionHighlight?: (interjectionId: NodeId, offsetStart: number, offsetEnd: number) => void;
  /** Called after successful boundary change */
  onBoundaryChangeComplete?: () => void;
}

interface UseInterjectionPanelReturn {
  /** Currently selected interjection ID */
  selectedInterjectionId: NodeId | null;
  /** Select an interjection and trigger highlight */
  selectInterjection: (interjectionId: NodeId) => void;
  /** Clear selection */
  clearSelection: () => void;
  /** Change interjection boundaries */
  changeInterjectionBoundary: (
    interjectionId: NodeId,
    newOffsetStart: number,
    newOffsetEnd: number,
    newText: string
  ) => void;
  /** Add a new interjection */
  addInterjection: (text: string, offsetStart: number, offsetEnd: number) => void;
  /** Remove an interjection */
  removeInterjection: (interjectionId: NodeId) => void;
  /** List of interjections for the current passage */
  interjections: InterjectionMetadata[];
  /** Whether any changes are pending */
  hasPendingChanges: boolean;
}

/**
 * Hook for managing interjection side panel state and actions.
 */
export function useInterjectionPanel(
  options: UseInterjectionPanelOptions
): UseInterjectionPanelReturn {
  const { passage, onInterjectionHighlight, onBoundaryChangeComplete } = options;

  const [selectedInterjectionId, setSelectedInterjectionId] = useState<NodeId | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  // Get document mutations
  const mutations = useDocumentMutations();

  // Get interjections from passage
  const interjections = useMemo(() => {
    return passage?.metadata?.interjections ?? [];
  }, [passage]);

  // Clear selection when passage changes
  useEffect(() => {
    setSelectedInterjectionId(null);
  }, [passage?.id]);

  /**
   * Select an interjection and trigger highlighting in the editor
   */
  const selectInterjection = useCallback((interjectionId: NodeId) => {
    setSelectedInterjectionId(interjectionId);

    // Find the interjection data
    const interjection = interjections.find((i) => i.id === interjectionId);
    if (interjection && onInterjectionHighlight) {
      onInterjectionHighlight(
        interjectionId,
        interjection.offsetStart,
        interjection.offsetEnd
      );
    }
  }, [interjections, onInterjectionHighlight]);

  /**
   * Clear the selection
   */
  const clearSelection = useCallback(() => {
    setSelectedInterjectionId(null);
  }, []);

  /**
   * Change interjection boundaries
   */
  const changeInterjectionBoundary = useCallback(
    (
      interjectionId: NodeId,
      newOffsetStart: number,
      newOffsetEnd: number,
      newText: string
    ) => {
      if (!passage) return;

      setHasPendingChanges(true);

      try {
        mutations.changeInterjectionBoundary(
          passage.id,
          interjectionId,
          newOffsetStart,
          newOffsetEnd,
          newText
        );
        onBoundaryChangeComplete?.();
      } catch (error) {
        console.error('Failed to change interjection boundary:', error);
      } finally {
        setHasPendingChanges(false);
      }
    },
    [passage, mutations, onBoundaryChangeComplete]
  );

  /**
   * Add a new interjection to the passage
   */
  const addInterjection = useCallback(
    (text: string, offsetStart: number, offsetEnd: number) => {
      if (!passage) return;

      setHasPendingChanges(true);

      try {
        // Generate a unique ID for the new interjection
        const newId = `interjection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` as NodeId;

        // For now, we'll need to use a different mutation that adds interjections
        // This would typically be handled by the document mutator
        console.log('Adding interjection:', { newId, text, offsetStart, offsetEnd });
        
        // TODO: Implement addInterjection mutation in DocumentMutator
        // mutations.addInterjection(passage.nodeId, newId, text, offsetStart, offsetEnd);
        
        onBoundaryChangeComplete?.();
      } catch (error) {
        console.error('Failed to add interjection:', error);
      } finally {
        setHasPendingChanges(false);
      }
    },
    [passage, onBoundaryChangeComplete]
  );

  /**
   * Remove an interjection from the passage
   */
  const removeInterjection = useCallback(
    (interjectionId: NodeId) => {
      if (!passage) return;

      setHasPendingChanges(true);

      try {
        // TODO: Implement removeInterjection mutation in DocumentMutator
        // mutations.removeInterjection(passage.nodeId, interjectionId);
        console.log('Removing interjection:', interjectionId);
        
        // Clear selection if the removed interjection was selected
        if (selectedInterjectionId === interjectionId) {
          setSelectedInterjectionId(null);
        }

        onBoundaryChangeComplete?.();
      } catch (error) {
        console.error('Failed to remove interjection:', error);
      } finally {
        setHasPendingChanges(false);
      }
    },
    [passage, selectedInterjectionId, onBoundaryChangeComplete]
  );

  return {
    selectedInterjectionId,
    selectInterjection,
    clearSelection,
    changeInterjectionBoundary,
    addInterjection,
    removeInterjection,
    interjections,
    hasPendingChanges,
  };
}

export default useInterjectionPanel;
