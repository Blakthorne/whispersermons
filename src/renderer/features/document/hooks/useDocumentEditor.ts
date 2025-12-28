/**
 * useDocumentEditor - Integration hook for TipTap editor with DocumentState
 *
 * Phase D: This hook provides the main integration point between the
 * TipTap editor and the DocumentMutator/DocumentState system.
 *
 * Features:
 * - Bidirectional sync between TipTap and DocumentState
 * - Automatic state persistence
 * - History integration
 * - Undo/redo coordination
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocumentState } from '../../../../shared/documentModel';
import type { HistoryItem } from '../../../../shared/types';
import { DocumentMutator } from '../DocumentMutator';
import { createDocumentState, createDocumentRootNode } from '../events';
import { astToTipTapJson, tipTapJsonToAst, type TipTapNode } from '../bridge/astTipTapConverter';
import { createEditorSyncHandler, type EditorSyncOptions } from '../bridge/editorSync';
import {
  createHistoryItemWithState,
  restoreFromHistoryItem,
  type SaveToHistoryOptions,
  type RestoreFromHistoryResult,
} from '../history';
import {
  compactSerialize,
  compactDeserialize,
} from '../serialization';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for useDocumentEditor.
 */
export interface UseDocumentEditorConfig {
  /** TipTap editor instance */
  editor: Editor | null;
  /** Initial document state (optional) */
  initialState?: DocumentState | null;
  /** Initial history item to restore from (optional) */
  historyItem?: HistoryItem | null;
  /** Sync configuration */
  syncConfig?: Partial<EditorSyncOptions>;
  /** Callback when state changes */
  onStateChange?: (state: DocumentState) => void;
  /** Callback when save is triggered */
  onSave?: (state: DocumentState, serialized: string) => void;
  /** Whether to enable bidirectional sync (default: true) */
  enableSync?: boolean;
}

/**
 * Result from useDocumentEditor hook.
 */
export interface UseDocumentEditorResult {
  /** The document mutator instance */
  mutator: DocumentMutator | null;
  /** Current document state */
  state: DocumentState | null;
  /** Whether the document has unsaved changes */
  isDirty: boolean;
  /** Whether sync is currently in progress */
  isSyncing: boolean;
  /** Last error that occurred */
  error: string | null;
  /** Statistics about the document */
  statistics: {
    quoteCount: number;
    verifiedQuoteCount: number;
    paragraphCount: number;
    wordCount: number;
    eventLogSize: number;
  } | null;
  // Actions
  /** Sync editor content to document state */
  syncFromEditor: () => void;
  /** Sync document state to editor */
  syncToEditor: () => void;
  /** Save the current state */
  save: () => string | null;
  /** Restore from serialized state */
  restore: (serialized: string) => boolean;
  /** Restore from a history item */
  restoreFromHistory: (item: HistoryItem) => RestoreFromHistoryResult;
  /** Create a history item from current state */
  createHistoryItem: (
    baseItem: Omit<HistoryItem, 'id'>,
    options?: SaveToHistoryOptions
  ) => Omit<HistoryItem, 'id'>;
  /** Reset to initial state */
  reset: () => void;
  /** Mark as clean (not dirty) */
  markClean: () => void;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Hook for integrating TipTap editor with DocumentState.
 */
export function useDocumentEditor(
  config: UseDocumentEditorConfig
): UseDocumentEditorResult {
  const {
    editor,
    initialState,
    historyItem,
    syncConfig,
    onStateChange,
    onSave,
    enableSync = true,
  } = config;

  // Internal state
  const [mutator, setMutator] = useState<DocumentMutator | null>(null);
  const [state, setState] = useState<DocumentState | null>(initialState ?? null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup
  const cleanupRef = useRef<(() => void) | null>(null);

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  // Initialize mutator and state
  useEffect(() => {
    let newState: DocumentState | null = null;

    // Priority 1: Restore from history item
    if (historyItem) {
      const result = restoreFromHistoryItem(historyItem);
      if (result.success && result.state) {
        newState = result.state;
      } else if (result.isLegacy && result.legacyHtml) {
        // For legacy items, start with empty state
        // The HTML can be loaded into TipTap directly
        newState = createDocumentState(createDocumentRootNode());
      }
    }

    // Priority 2: Use initial state
    if (!newState && initialState) {
      newState = initialState;
    }

    // Priority 3: Create empty state
    if (!newState) {
      newState = createDocumentState(createDocumentRootNode());
    }

    const newMutator = new DocumentMutator(newState);
    setMutator(newMutator);
    setState(newState);
    setError(null);

    // Subscribe to state changes
    const unsubscribe = newMutator.subscribe((updatedState) => {
      setState(updatedState);
      setIsDirty(true);
      onStateChange?.(updatedState);
    });

    return () => {
      unsubscribe();
    };
  }, [initialState, historyItem]); // Deliberately exclude onStateChange to avoid re-init

  // ============================================================================
  // EDITOR SYNC SETUP
  // ============================================================================

  // Set up bidirectional sync with editor
  useEffect(() => {
    if (!editor || !mutator || !enableSync) {
      return;
    }

    const fullConfig: EditorSyncOptions = {
      debounce: true,
      debounceMs: syncConfig?.debounceMs ?? 300,
      syncOnChange: true,
      onSync: () => setIsSyncing(false),
      onError: (err) => setError(err.message),
      ...syncConfig,
    };

    // Create and attach sync handler - returns cleanup function directly
    const cleanup = createEditorSyncHandler(editor, mutator, fullConfig);
    cleanupRef.current = cleanup;

    return () => {
      cleanup();
      cleanupRef.current = null;
    };
  }, [editor, mutator, enableSync, syncConfig]);

  // Initial sync: Load state into editor
  useEffect(() => {
    if (!editor || !state || !enableSync) {
      return;
    }

    // Convert state to TipTap JSON and set editor content
    const result = astToTipTapJson(state.root);
    if (result.success && result.data) {
      editor.commands.setContent(result.data);
    }
  }, [editor, enableSync]); // Deliberately exclude state to only run on mount

  // ============================================================================
  // ACTIONS
  // ============================================================================

  /**
   * Sync editor content to document state.
   */
  const syncFromEditor = useCallback(() => {
    if (!editor || !mutator) {
      return;
    }

    setIsSyncing(true);
    try {
      const tipTapJson = editor.getJSON() as { type: 'doc'; content: TipTapNode[] };
      const result = tipTapJsonToAst(tipTapJson);
      if (result.success && result.data) {
        // Create new state from the converted root
        const newState = createDocumentState(result.data);
        const newMutator = new DocumentMutator(newState);
        setMutator(newMutator);
        setState(newState);
        setIsDirty(true);
      } else {
        setError(result.error || 'Failed to convert editor content');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync from editor');
    } finally {
      setIsSyncing(false);
    }
  }, [editor, mutator]);

  /**
   * Sync document state to editor.
   */
  const syncToEditor = useCallback(() => {
    if (!editor || !state) {
      return;
    }

    setIsSyncing(true);
    try {
      const result = astToTipTapJson(state.root);
      if (result.success && result.data) {
        editor.commands.setContent(result.data);
      } else {
        setError(result.error || 'Failed to convert state to TipTap');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync to editor');
    } finally {
      setIsSyncing(false);
    }
  }, [editor, state]);

  /**
   * Save the current state.
   */
  const save = useCallback((): string | null => {
    if (!state) {
      return null;
    }

    try {
      const serialized = compactSerialize(state);
      onSave?.(state, serialized);
      setIsDirty(false);
      return serialized;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      return null;
    }
  }, [state, onSave]);

  /**
   * Restore from serialized state.
   */
  const restore = useCallback((serialized: string): boolean => {
    try {
      const result = compactDeserialize(serialized);
      if (result.success && result.state) {
        const newMutator = new DocumentMutator(result.state);
        setMutator(newMutator);
        setState(result.state);
        setIsDirty(false);
        setError(null);

        // Sync to editor if available
        if (editor) {
          const tipTapResult = astToTipTapJson(result.state.root);
          if (tipTapResult.success && tipTapResult.data) {
            editor.commands.setContent(tipTapResult.data);
          }
        }

        return true;
      }
      setError(result.error || 'Failed to restore');
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore');
      return false;
    }
  }, [editor]);

  /**
   * Restore from a history item.
   */
  const restoreFromHistoryAction = useCallback(
    (item: HistoryItem): RestoreFromHistoryResult => {
      const result = restoreFromHistoryItem(item);

      if (result.success && result.state) {
        const newMutator = new DocumentMutator(result.state);
        setMutator(newMutator);
        setState(result.state);
        setIsDirty(false);
        setError(null);

        // Sync to editor if available
        if (editor) {
          const tipTapResult = astToTipTapJson(result.state.root);
          if (tipTapResult.success && tipTapResult.data) {
            editor.commands.setContent(tipTapResult.data);
          }
        }
      } else if (result.isLegacy && result.legacyHtml && editor) {
        // Load legacy HTML directly into editor
        editor.commands.setContent(result.legacyHtml);
        // We don't have a DocumentState for legacy items
        setError(null);
      }

      return result;
    },
    [editor]
  );

  /**
   * Create a history item from current state.
   */
  const createHistoryItemAction = useCallback(
    (
      baseItem: Omit<HistoryItem, 'id'>,
      options?: SaveToHistoryOptions
    ): Omit<HistoryItem, 'id'> => {
      return createHistoryItemWithState(baseItem, state, options);
    },
    [state]
  );

  /**
   * Reset to initial state.
   */
  const reset = useCallback(() => {
    const newState = initialState ?? createDocumentState(createDocumentRootNode());
    const newMutator = new DocumentMutator(newState);
    setMutator(newMutator);
    setState(newState);
    setIsDirty(false);
    setError(null);

    // Sync to editor if available
    if (editor) {
      const result = astToTipTapJson(newState.root);
      if (result.success && result.data) {
        editor.commands.setContent(result.data);
      }
    }
  }, [initialState, editor]);

  /**
   * Mark as clean (not dirty).
   */
  const markClean = useCallback(() => {
    setIsDirty(false);
  }, []);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  const statistics = useMemo(() => {
    if (!state) {
      return null;
    }

    const mutatorInstance = mutator ?? new DocumentMutator(state);
    const stats = mutatorInstance.getStatistics();

    return {
      quoteCount: stats.quoteCount,
      verifiedQuoteCount: stats.verifiedQuoteCount,
      paragraphCount: stats.paragraphCount,
      wordCount: stats.wordCount,
      eventLogSize: state.eventLog.length,
    };
  }, [state, mutator]);

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    mutator,
    state,
    isDirty,
    isSyncing,
    error,
    statistics,
    syncFromEditor,
    syncToEditor,
    save,
    restore,
    restoreFromHistory: restoreFromHistoryAction,
    createHistoryItem: createHistoryItemAction,
    reset,
    markClean,
  };
}
