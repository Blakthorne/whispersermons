/**
 * useUndoRedo - Hook for undo/redo operations on documents.
 *
 * This hook provides access to the undo/redo system built into the
 * event-sourced document architecture. It integrates with the DocumentMutator
 * to provide:
 * - Undo/redo state tracking
 * - Keyboard shortcut integration (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
 * - Undo stack depth information
 *
 * The undo system works by:
 * 1. Recording inverse events for each mutation
 * 2. Maintaining an undo stack of inverse event batches
 * 3. Applying inverse events on undo, and re-applying original events on redo
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentContext } from '../DocumentContext';
import { createDocumentMutator, type MutationResult } from '../DocumentMutator';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for the useUndoRedo hook.
 */
export interface UseUndoRedoOptions {
  /**
   * Whether to register keyboard shortcuts.
   * @default true
   */
  enableKeyboardShortcuts?: boolean;

  /**
   * Maximum number of undo steps to keep in history.
   * @default 100
   */
  maxUndoSteps?: number;
}

/**
 * Return type for useUndoRedo hook.
 */
export interface UseUndoRedoResult {
  /** Whether undo is available */
  canUndo: boolean;

  /** Whether redo is available */
  canRedo: boolean;

  /** Number of available undo steps */
  undoStackDepth: number;

  /** Number of available redo steps */
  redoStackDepth: number;

  /** Perform an undo operation */
  undo: () => MutationResult | null;

  /** Perform a redo operation */
  redo: () => MutationResult | null;

  /** Clear the undo/redo history */
  clearHistory: () => void;
}

// ============================================================================
// KEYBOARD SHORTCUTS CONFIGURATION
// ============================================================================

const UNDO_KEY = 'z';

/**
 * Check if the pressed key combination matches the undo shortcut.
 */
function isUndoShortcut(event: KeyboardEvent): boolean {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifierKey = isMac ? event.metaKey : event.ctrlKey;
  return modifierKey && event.key.toLowerCase() === UNDO_KEY && !event.shiftKey;
}

/**
 * Check if the pressed key combination matches the redo shortcut.
 */
function isRedoShortcut(event: KeyboardEvent): boolean {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifierKey = isMac ? event.metaKey : event.ctrlKey;
  return modifierKey && event.key.toLowerCase() === UNDO_KEY && event.shiftKey;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Hook for undo/redo operations.
 *
 * @param options - Configuration options
 * @returns Undo/redo state and actions
 *
 * @example
 * ```tsx
 * function EditorToolbar() {
 *   const { canUndo, canRedo, undo, redo } = useUndoRedo();
 *
 *   return (
 *     <div className="toolbar">
 *       <button onClick={undo} disabled={!canUndo}>
 *         Undo
 *       </button>
 *       <button onClick={redo} disabled={!canRedo}>
 *         Redo
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With keyboard shortcuts disabled
 * function CustomEditor() {
 *   const { undo, redo } = useUndoRedo({ enableKeyboardShortcuts: false });
 *
 *   // Handle keyboard shortcuts manually if needed
 * }
 * ```
 */
export function useUndoRedo(options: UseUndoRedoOptions = {}): UseUndoRedoResult {
  const { enableKeyboardShortcuts = true } = options;

  const { manager, hasDocument } = useDocumentContext();

  // Track undo/redo state reactively
  const [undoRedoState, setUndoRedoState] = useState({
    canUndo: false,
    canRedo: false,
    undoStackDepth: 0,
    redoStackDepth: 0,
  });

  // Create mutator from current manager state
  const mutator = useMemo(() => {
    if (!manager || !hasDocument) return null;
    return createDocumentMutator(manager.getState());
  }, [manager, hasDocument]);

  // Update undo/redo state when mutator changes
  useEffect(() => {
    if (!mutator) {
      setUndoRedoState({
        canUndo: false,
        canRedo: false,
        undoStackDepth: 0,
        redoStackDepth: 0,
      });
      return;
    }

    // Subscribe to state changes
    const unsubscribe = mutator.subscribe(() => {
      setUndoRedoState({
        canUndo: mutator.canUndo(),
        canRedo: mutator.canRedo(),
        undoStackDepth: mutator.getState().undoStack.length,
        redoStackDepth: mutator.getState().redoStack.length,
      });
    });

    // Initial state
    setUndoRedoState({
      canUndo: mutator.canUndo(),
      canRedo: mutator.canRedo(),
      undoStackDepth: mutator.getState().undoStack.length,
      redoStackDepth: mutator.getState().redoStack.length,
    });

    return unsubscribe;
  }, [mutator]);

  // Undo action
  const undo = useCallback((): MutationResult | null => {
    if (!mutator || !mutator.canUndo()) return null;
    return mutator.undo();
  }, [mutator]);

  // Redo action
  const redo = useCallback((): MutationResult | null => {
    if (!mutator || !mutator.canRedo()) return null;
    return mutator.redo();
  }, [mutator]);

  // Clear history
  const clearHistory = useCallback((): void => {
    // Note: This would require adding a clearHistory method to DocumentMutator
    // For now, we'll just log a warning
    console.warn('clearHistory not yet implemented in DocumentMutator');
  }, []);

  // Keyboard shortcut handler
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't capture shortcuts if focus is in an input/textarea
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (isUndoShortcut(event)) {
        event.preventDefault();
        undo();
      } else if (isRedoShortcut(event)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardShortcuts, undo, redo]);

  return {
    canUndo: undoRedoState.canUndo,
    canRedo: undoRedoState.canRedo,
    undoStackDepth: undoRedoState.undoStackDepth,
    redoStackDepth: undoRedoState.redoStackDepth,
    undo,
    redo,
    clearHistory,
  };
}

export default useUndoRedo;
