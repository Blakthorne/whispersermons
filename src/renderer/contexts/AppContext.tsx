import React, { useCallback, useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import { useTranscription, useBatchQueue, useQueueSelection } from '../features/transcription';
import { useHistory } from '../features/history';
import { usePreferences } from '../features/preferences';
import { useTheme, useCopyToClipboard, useElectronMenu } from '../hooks';
import { selectAndProcessFiles } from '../utils';
import type { HistoryItem, SelectedFile, SermonDocument, OutputFormat, TranscriptionSettings } from '../types';
import type { DocumentState, DocumentRootNode } from '../../shared/documentModel';
import { astToHtml } from '../features/document/bridge/astTipTapConverter';
import {
  buildNodeIndex,
  buildPassageIndex,
  buildExtracted,
} from '../features/document/serialization/stateSerializer';
import { createDocumentMutator } from '../features/document/DocumentMutator';
import { createContentReplacedEvent } from '../features/document/events';
import {
  ThemeContext,
  HistoryContext,
  TranscriptionStateContext,
  TranscriptionActionsContext,
} from './contexts';
import { PreferencesProvider } from './PreferencesContext';
import type {
  ThemeContextValue,
  HistoryContextValue,
  TranscriptionStateContextValue,
  TranscriptionActionsContextValue,
  DocumentSaveState,
} from './types';

interface AppProviderProps {
  children: ReactNode;
}

// Debounce delay for AST sync in milliseconds (300ms)
const AST_SYNC_DEBOUNCE = 300;
// Debounce delay for auto-save to history (300ms - fast, unobtrusive UX)
const AUTO_SAVE_DEBOUNCE = 300;

export function AppProvider({ children }: AppProviderProps): React.JSX.Element {
  const { theme, toggleTheme, isDark } = useTheme();

  const { copySuccess, copyToClipboard } = useCopyToClipboard();

  const {
    history,
    showHistory,
    setShowHistory,
    toggleHistory,
    addHistoryItem,
    updateHistoryItem,
    clearHistory,
    removeHistoryItem,
  } = useHistory();

  // Get advanced Whisper settings from preferences
  const { preferences } = usePreferences();
  const whisperAdvancedSettings = preferences.whisper;

  const {
    selectedFile,
    settings,
    transcription,
    error,
    modelDownloaded,
    setSelectedFile,
    setSettings: setTranscriptionSettings,
    setModelDownloaded,
    setTranscription,
    handleSave,
    handleCopy,
  } = useTranscription();

  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [sermonDocument, setSermonDocument] = useState<SermonDocument | null>(null);
  // Draft AST JSON from Monaco editor (persists unsaved edits across tab switches)
  const [draftAstJson, setDraftAstJson] = useState<string | null>(null);
  const [currentHistoryItemId, setCurrentHistoryItemId] = useState<string | null>(null);
  // Version counter to track AST updates (used for sync detection between editors)
  const [documentStateVersion, setDocumentStateVersion] = useState<number>(0);
  // Version counter for EXTERNAL AST changes only (DevASTPanel, undo/redo)
  // TipTap watches this to know when to sync AST→TipTap (not for its own edits)
  const [externalAstVersion, setExternalAstVersion] = useState<number>(0);
  const [documentSaveState, setDocumentSaveState] = useState<DocumentSaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isDev, setIsDev] = useState<boolean>(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState<boolean>(false);
  const [visibleNodeId, setVisibleNodeId] = useState<string | null>(null);

  // Guarded setter to ensure Test Mode is only enabled in dev builds
  const setSettings = useCallback(
    (newSettings: TranscriptionSettings) => {
      const sanitizedSettings = (!isDev || !isDevToolsOpen) && newSettings.testMode
        ? { ...newSettings, testMode: false }
        : newSettings;
      setTranscriptionSettings(sanitizedSettings);
    },
    [isDev, isDevToolsOpen, setTranscriptionSettings]
  );

  // If we transition to non-dev or DevTools closed while testMode is on, force-disable it
  useEffect(() => {
    if ((!isDev || !isDevToolsOpen) && settings.testMode) {
      setTranscriptionSettings({ ...settings, testMode: false });
    }
  }, [isDev, isDevToolsOpen, settings, setTranscriptionSettings]);

  // Version-based dirty tracking (AST-only architecture)
  const [editVersion, setEditVersion] = useState<number>(0);
  const [savedVersion, setSavedVersion] = useState<number>(0);

  // Ref for debounced AST sync timer
  const astSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track pending AST changes (for debouncing)
  const pendingAstRootRef = useRef<DocumentRootNode | null>(null);
  // Ref for debounced auto-save timer
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch app info on mount
  useEffect(() => {
    if (window.electronAPI?.getAppInfo) {
      window.electronAPI.getAppInfo().then((info) => {
        setIsDev(info.isDev);
        setIsDevToolsOpen(info.isDevToolsOpen);
      });
    }
  }, []);

  // Track DevTools open/close state to conditionally show Dev AST editor mode
  useEffect(() => {
    if (!window.electronAPI?.onDevToolsStateChanged) return;

    const cleanup = window.electronAPI.onDevToolsStateChanged((isOpen) => {
      setIsDevToolsOpen(isOpen);
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Auto-save with debounce when there are unsaved changes
  useEffect(() => {
    // Only auto-save if there are unsaved changes and we have a history item to save to
    if (editVersion > savedVersion && currentHistoryItemId && sermonDocument) {
      // Clear any existing auto-save timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      // Set new debounced auto-save timer (2 seconds)
      autoSaveTimerRef.current = setTimeout(() => {
        setDocumentSaveState('auto-saving');

        // Save to history - AST is already up to date
        updateHistoryItem(currentHistoryItemId, {
          sermonDocument,
        });

        // Update saved version to match current edit version
        setSavedVersion(editVersion);
        setLastSavedAt(new Date());

        // Brief delay to show saving state, then transition to saved
        setTimeout(() => {
          setDocumentSaveState('saved');
        }, 300);

        autoSaveTimerRef.current = null;
      }, AUTO_SAVE_DEBOUNCE);
    }

    // Cleanup function to clear timer on unmount or dependency changes
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [editVersion, savedVersion, currentHistoryItemId, sermonDocument, updateHistoryItem]);

  const {
    queue,
    isProcessing,
    pipelineProgress,
    addFiles,
    removeFile,
    clearCompleted,
    startProcessing,
    cancelProcessing,
    getCompletedTranscription,
  } = useBatchQueue({
    settings,
    advancedSettings: whisperAdvancedSettings,
    onHistoryAdd: (item) => {
      addHistoryItem(item);
      // Track the ID of the newly created history item
      setCurrentHistoryItemId(item.id);
    },
    onFirstComplete: (id, text, file, sermonDoc) => {
      setSelectedQueueItemId(id);
      setTranscription(text);
      setSelectedFile(file);
      // Set sermon document if available (AST is source of truth)
      if (sermonDoc) {
        setSermonDocument(sermonDoc);
        setDraftAstJson(null); // Clear any draft AST from previous document
        // Reset version tracking for new document
        setEditVersion(0);
        setSavedVersion(0);
        setDocumentSaveState('saved');
        setLastSavedAt(new Date());
      } else {
        setSermonDocument(null);
        setDraftAstJson(null);
      }
    },
  });

  const selectHistoryItem = useCallback(
    (item: HistoryItem): void => {
      setTranscription(item.fullText);
      setSelectedFile({ name: item.fileName, path: item.filePath });
      // Restore sermon document from history (AST is source of truth)
      if (item.isSermon && item.sermonDocument) {
        setSermonDocument(item.sermonDocument);
        setDraftAstJson(null); // Clear any draft AST from previous document
      } else {
        setSermonDocument(null);
        setDraftAstJson(null);
      }
      // Track which history item is currently being viewed
      setCurrentHistoryItemId(item.id);
      // Reset version tracking - document is saved state from history
      setEditVersion(0);
      setSavedVersion(0);
      setDocumentSaveState('saved');
      setLastSavedAt(item.date ? new Date(item.date) : null);
      setShowHistory(false);
    },
    [setTranscription, setSelectedFile, setShowHistory]
  );

  /**
   * Apply pending AST changes to the document state.
   * This is called after the debounce period for both TipTap and DevASTPanel changes.
   */
  const applyPendingAstChanges = useCallback(() => {
    const newRoot = pendingAstRootRef.current;
    if (!newRoot || !sermonDocument) {
      return;
    }

    const existingState = sermonDocument.documentState;
    const previousRoot = existingState?.root;

    // Always generate an event if we have a previous root
    // This enables undo/redo for all AST changes
    if (previousRoot) {
      console.log(
        '[AppContext] Generating undo event. Previous root ID:',
        previousRoot.id,
        'New root ID:',
        newRoot.id
      );

      // CRITICAL: Preserve the root ID for undo/redo to work
      // TipTap creates new root IDs, but we need stable IDs for the event system
      const stableRoot: DocumentRootNode = {
        ...newRoot,
        id: previousRoot.id, // Keep the same root ID
      };

      // Create a content replacement event for the document root
      const contentReplacedEvent = createContentReplacedEvent(
        previousRoot.id, // Use the stable root ID
        previousRoot.children,
        stableRoot.children,
        (existingState?.version || 0) + 1,
        'user'
      );

      // Build new document state with the event and stable root
      const nodeIndex = buildNodeIndex(stableRoot);
      const newDocumentState: DocumentState = {
        version: (existingState?.version || 0) + 1,
        root: stableRoot, // Use the root with stable ID
        // Append the event to the log
        eventLog: [...(existingState?.eventLog || []), contentReplacedEvent],
        // Add this event to the undo stack
        undoStack: [...(existingState?.undoStack || []), contentReplacedEvent.id],
        // Clear redo stack when new change is made
        redoStack: [],
        nodeIndex,
        passageIndex: buildPassageIndex(stableRoot, nodeIndex),
        extracted: buildExtracted(stableRoot, nodeIndex),
        lastModified: new Date().toISOString(),
        createdAt: existingState?.createdAt || new Date().toISOString(),
      };

      console.log(
        '[AppContext] Event generated. UndoStack length:',
        newDocumentState.undoStack.length
      );

      const updatedSermonDocument = {
        ...sermonDocument,
        documentState: newDocumentState,
      };

      setSermonDocument(updatedSermonDocument);
      setDocumentStateVersion((v) => v + 1);
      setEditVersion((v) => v + 1);
    } else {
      // No previous root - this is initial load, just update without event
      console.log('[AppContext] No previous root - initial load');
      const nodeIndex = buildNodeIndex(newRoot);
      const newDocumentState: DocumentState = {
        version: (existingState?.version || 0) + 1,
        root: newRoot,
        eventLog: existingState?.eventLog || [],
        undoStack: existingState?.undoStack || [],
        redoStack: existingState?.redoStack || [],
        nodeIndex,
        passageIndex: buildPassageIndex(newRoot, nodeIndex),
        extracted: buildExtracted(newRoot, nodeIndex),
        lastModified: new Date().toISOString(),
        createdAt: existingState?.createdAt || new Date().toISOString(),
      };

      const updatedSermonDocument = {
        ...sermonDocument,
        documentState: newDocumentState,
      };

      setSermonDocument(updatedSermonDocument);
      setDocumentStateVersion((v) => v + 1);
      setEditVersion((v) => v + 1);
    }

    // Clear pending ref
    pendingAstRootRef.current = null;
  }, [sermonDocument]);

  /**
   * Handle AST changes from the TipTap editor (debounced).
   * This is the primary way content changes flow from the editor to the AST.
   */
  const handleAstChange = useCallback(
    (newRoot: DocumentRootNode) => {
      // Store the pending root
      pendingAstRootRef.current = newRoot;

      // Clear existing timer
      if (astSyncTimerRef.current) {
        clearTimeout(astSyncTimerRef.current);
      }

      // Set new debounced timer
      astSyncTimerRef.current = setTimeout(() => {
        applyPendingAstChanges();
        astSyncTimerRef.current = null;
      }, AST_SYNC_DEBOUNCE);
    },
    [applyPendingAstChanges]
  );

  /**
   * Handle immediate metadata updates (title, speaker, biblePassage, tags).
   * These changes are applied immediately without debouncing to avoid UI flashing.
   * Metadata changes don't affect the content tree, so they're safe to apply instantly.
   */
  const handleMetadataChange = useCallback(
    (updates: Partial<Pick<DocumentRootNode, 'title' | 'speaker' | 'biblePassage' | 'tags'>>) => {
      if (!sermonDocument?.documentState?.root) return;

      const updatedRoot: DocumentRootNode = {
        ...sermonDocument.documentState.root,
        ...updates,
      };

      // Update the node index (needed for serialization)
      const nodeIndex = buildNodeIndex(updatedRoot);
      const newDocumentState: DocumentState = {
        ...sermonDocument.documentState,
        root: updatedRoot,
        nodeIndex,
        passageIndex: buildPassageIndex(updatedRoot, nodeIndex),
        extracted: buildExtracted(updatedRoot, nodeIndex),
        lastModified: new Date().toISOString(),
      };

      const updatedSermonDocument = {
        ...sermonDocument,
        documentState: newDocumentState,
      };

      setSermonDocument(updatedSermonDocument);
      setDocumentStateVersion((v) => v + 1);
      setEditVersion((v) => v + 1);
    },
    [sermonDocument]
  );

  /**
   * Update document state (AST) directly from the root node.
   * Used by DevASTPanel when JSON changes are made.
   * This triggers sync back to TipTap via externalAstVersion.
   */
  const updateDocumentState = useCallback(
    (newRoot: DocumentRootNode): void => {
      // Store the pending root and trigger debounced sync
      pendingAstRootRef.current = newRoot;

      // Clear existing timer
      if (astSyncTimerRef.current) {
        clearTimeout(astSyncTimerRef.current);
      }

      // Set new debounced timer (same as TipTap, but also bumps external version)
      astSyncTimerRef.current = setTimeout(() => {
        applyPendingAstChanges();
        // Bump external version AFTER applying changes - this tells TipTap to sync
        setExternalAstVersion((v) => v + 1);
        astSyncTimerRef.current = null;
      }, AST_SYNC_DEBOUNCE);
    },
    [applyPendingAstChanges]
  );

  /**
   * Undo the last change using the event-based undo system.
   * Works for both TipTap editor and AST mode edits.
   */
  const handleUndo = useCallback(() => {
    if (!sermonDocument?.documentState) {
      console.log('[AppContext] handleUndo: no document state');
      return;
    }

    console.log(
      '[AppContext] handleUndo: undoStack length:',
      sermonDocument.documentState.undoStack.length
    );

    // Create a mutator with current state
    const mutator = createDocumentMutator(sermonDocument.documentState);

    // Perform undo
    const result = mutator.undo();

    console.log('[AppContext] handleUndo result:', result.success, result.error);

    if (result.success) {
      // Update the sermon document with the new state
      const updatedSermonDocument = {
        ...sermonDocument,
        documentState: result.state,
      };

      setSermonDocument(updatedSermonDocument);
      setDocumentStateVersion((v) => v + 1);
      // Bump external version to trigger TipTap sync
      setExternalAstVersion((v) => v + 1);
      // Trigger autosave for undo
      setEditVersion((v) => v + 1);
      // Clear any draft AST to sync DevASTPanel
      setDraftAstJson(null);
    } else {
      console.error('[AppContext] Undo failed:', result.error);
    }
  }, [sermonDocument]);

  /**
   * Redo a previously undone change using the event-based redo system.
   * Works for both TipTap editor and AST mode edits.
   */
  const handleRedo = useCallback(() => {
    if (!sermonDocument?.documentState) {
      console.log('[AppContext] handleRedo: no document state');
      return;
    }

    console.log(
      '[AppContext] handleRedo: redoStack length:',
      sermonDocument.documentState.redoStack.length
    );

    // Create a mutator with current state
    const mutator = createDocumentMutator(sermonDocument.documentState);

    // Perform redo
    const result = mutator.redo();

    console.log('[AppContext] handleRedo result:', result.success, result.error);

    if (result.success) {
      // Update the sermon document with the new state
      const updatedSermonDocument = {
        ...sermonDocument,
        documentState: result.state,
      };

      setSermonDocument(updatedSermonDocument);
      setDocumentStateVersion((v) => v + 1);
      // Bump external version to trigger TipTap sync
      setExternalAstVersion((v) => v + 1);
      // Trigger autosave for redo
      setEditVersion((v) => v + 1);
      // Clear any draft AST to sync DevASTPanel
      setDraftAstJson(null);
    } else {
      console.error('[AppContext] Redo failed:', result.error);
    }
  }, [sermonDocument]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (astSyncTimerRef.current) {
        clearTimeout(astSyncTimerRef.current);
      }
    };
  }, []);

  const onCopy = useCallback(async (): Promise<void> => {
    await handleCopy(copyToClipboard);
  }, [handleCopy, copyToClipboard]);

  // Wrap handleSave to include sermon-specific data
  // Generate HTML on-demand from AST for exports
  const wrappedHandleSave = useCallback(
    async (format?: OutputFormat): Promise<void> => {
      // For sermon documents, generate HTML from AST on-demand
      if (sermonDocument?.documentState?.root) {
        const { saveFile } = await import('../services/electronAPI');
        const fileName = selectedFile?.name?.replace(/\.[^/.]+$/, '') || 'sermon';

        // Generate HTML from AST (single source of truth)
        const html = astToHtml(
          sermonDocument.documentState.root,
          sermonDocument.documentState.extracted
        );

        const result = await saveFile({
          defaultName: `${fileName}.${format || 'txt'}`,
          content: transcription, // Fallback plain text
          format: format || 'txt',
          html, // Generated on-demand from AST
          isSermon: true,
        });

        if (result?.error) {
          console.error('Failed to save:', result.error);
        }
      } else {
        // Fallback save path when no sermon document is available
        await handleSave(format);
      }
    },
    [sermonDocument, selectedFile, transcription, handleSave]
  );

  const handleFilesSelect = useCallback(
    (files: SelectedFile[]): void => {
      addFiles(files);
    },
    [addFiles]
  );

  const handleFileSelectFromMenu = useCallback(async (): Promise<void> => {
    const files = await selectAndProcessFiles();
    if (files.length > 0) {
      addFiles(files);
    }
  }, [addFiles]);

  const handleTranscribe = useCallback(async (): Promise<void> => {
    await startProcessing();
  }, [startProcessing]);

  const handleCancel = useCallback(async (): Promise<void> => {
    await cancelProcessing();
  }, [cancelProcessing]);

  const removeFromQueue = useCallback(
    (id: string): void => {
      removeFile(id);
      if (selectedQueueItemId === id) {
        setSelectedQueueItemId(null);
        setTranscription('');
        setSelectedFile(null);
        setSermonDocument(null);
        setDraftAstJson(null);
      }
    },
    [removeFile, selectedQueueItemId, setTranscription, setSelectedFile]
  );

  const clearCompletedFromQueue = useCallback((): void => {
    clearCompleted();
    setSelectedQueueItemId(null);
    setTranscription('');
    setSelectedFile(null);
    setSermonDocument(null);
    setDraftAstJson(null);
  }, [clearCompleted, setTranscription, setSelectedFile]);

  const { selectQueueItem } = useQueueSelection(
    queue,
    getCompletedTranscription,
    setTranscription,
    setSelectedFile,
    setSelectedQueueItemId
  );

  useElectronMenu({
    onOpenFile: () => {
      if (!isProcessing) {
        handleFileSelectFromMenu();
      }
    },
    onSaveFile: () => {
      if (transcription && !isProcessing) {
        handleSave();
      }
    },
    onCopyTranscription: () => {
      if (transcription) {
        onCopy();
      }
    },
    onStartTranscription: () => {
      const hasProcessableItems = queue.some(
        (item) =>
          item.status === 'pending' || item.status === 'error' || item.status === 'cancelled'
      );
      if (hasProcessableItems && !isProcessing) {
        handleTranscribe();
      }
    },
    onCancelTranscription: () => {
      if (isProcessing) {
        handleCancel();
      }
    },
    onToggleHistory: toggleHistory,
  });

  const themeContextValue = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, isDark }),
    [theme, toggleTheme, isDark]
  );

  const historyContextValue = useMemo<HistoryContextValue>(
    () => ({
      history,
      showHistory,
      setShowHistory,
      toggleHistory,
      clearHistory,
      removeHistoryItem,
      selectHistoryItem,
      updateHistoryItem,
      currentHistoryItemId,
    }),
    [
      history,
      showHistory,
      setShowHistory,
      toggleHistory,
      clearHistory,
      removeHistoryItem,
      selectHistoryItem,
      updateHistoryItem,
      currentHistoryItemId,
    ]
  );

  const transcriptionStateValue = useMemo<TranscriptionStateContextValue>(
    () => ({
      selectedFile,
      settings,
      isTranscribing: isProcessing,
      transcription,
      error,
      modelDownloaded,
      copySuccess,
      queue,
      selectedQueueItemId,
      sermonDocument,
      draftAstJson,
      pipelineProgress,
      documentSaveState,
      lastSavedAt,
      editVersion,
      savedVersion,
      isDev,
      isDevToolsOpen,
      visibleNodeId,
      canUndo: (sermonDocument?.documentState?.undoStack?.length ?? 0) > 0,
      canRedo: (sermonDocument?.documentState?.redoStack?.length ?? 0) > 0,
    }),
    [
      selectedFile,
      settings,
      isProcessing,
      transcription,
      error,
      modelDownloaded,
      copySuccess,
      queue,
      selectedQueueItemId,
      sermonDocument,
      draftAstJson,
      pipelineProgress,
      documentSaveState,
      lastSavedAt,
      editVersion,
      savedVersion,
      isDev,
      isDevToolsOpen,
      visibleNodeId,
    ]
  );

  const transcriptionActionsValue = useMemo<TranscriptionActionsContextValue>(
    () => ({
      setSelectedFile,
      setSettings,
      setModelDownloaded,
      handleTranscribe,
      handleCancel,
      handleSave: wrappedHandleSave,
      handleCopy: onCopy,
      handleFilesSelect,
      removeFromQueue,
      clearCompletedFromQueue,
      selectQueueItem,
      setSermonDocument,
      setDraftAstJson,
      updateDocumentState,
      handleAstChange,
      handleMetadataChange,
      setVisibleNodeId,
      documentStateVersion,
      externalAstVersion,
      handleUndo,
      handleRedo,
    }),
    [
      setSelectedFile,
      setSettings,
      setModelDownloaded,
      handleTranscribe,
      handleCancel,
      wrappedHandleSave,
      onCopy,
      handleFilesSelect,
      removeFromQueue,
      clearCompletedFromQueue,
      selectQueueItem,
      updateDocumentState,
      handleAstChange,
      handleMetadataChange,
      setVisibleNodeId,
      documentStateVersion,
      externalAstVersion,
      handleUndo,
      handleRedo,
    ]
  );

  return (
    <PreferencesProvider>
      <ThemeContext.Provider value={themeContextValue}>
        <HistoryContext.Provider value={historyContextValue}>
          <TranscriptionStateContext.Provider value={transcriptionStateValue}>
            <TranscriptionActionsContext.Provider value={transcriptionActionsValue}>
              {children}
            </TranscriptionActionsContext.Provider>
          </TranscriptionStateContext.Provider>
        </HistoryContext.Provider>
      </ThemeContext.Provider>
    </PreferencesProvider>
  );
}
