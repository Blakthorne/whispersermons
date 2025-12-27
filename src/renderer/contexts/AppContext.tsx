import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranscription, useBatchQueue, useQueueSelection } from '../features/transcription';
import { useHistory } from '../features/history';
import { useTheme, useCopyToClipboard, useElectronMenu } from '../hooks';
import { selectAndProcessFiles } from '../utils';
import type { HistoryItem, SelectedFile, SermonDocument, OutputFormat } from '../types';
import {
  ThemeContext,
  HistoryContext,
  TranscriptionStateContext,
  TranscriptionActionsContext,
} from './contexts';
import type {
  ThemeContextValue,
  HistoryContextValue,
  TranscriptionStateContextValue,
  TranscriptionActionsContextValue,
} from './types';

interface AppProviderProps {
  children: ReactNode;
}

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

  const {
    selectedFile,
    settings,
    transcription,
    error,
    modelDownloaded,
    setSelectedFile,
    setSettings,
    setModelDownloaded,
    setTranscription,
    handleSave,
    handleCopy,
  } = useTranscription();

  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [sermonDocument, setSermonDocument] = useState<SermonDocument | null>(null);
  const [documentHtml, setDocumentHtml] = useState<string | null>(null);
  const [currentHistoryItemId, setCurrentHistoryItemId] = useState<string | null>(null);

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
    onHistoryAdd: (item) => {
      addHistoryItem(item);
      // Track the ID of the newly created history item
      setCurrentHistoryItemId(item.id);
    },
    onFirstComplete: (id, text, file, sermonDoc) => {
      setSelectedQueueItemId(id);
      setTranscription(text);
      setSelectedFile(file);
      // Set sermon document if available
      if (sermonDoc) {
        setSermonDocument(sermonDoc);
        setDocumentHtml(null); // Reset HTML when new document arrives
      } else {
        setSermonDocument(null);
        setDocumentHtml(null);
      }
    },
  });

  const selectHistoryItem = useCallback(
    (item: HistoryItem): void => {
      setTranscription(item.fullText);
      setSelectedFile({ name: item.fileName, path: item.filePath });
      // Restore sermon document and HTML from history
      if (item.isSermon && item.sermonDocument) {
        setSermonDocument(item.sermonDocument);
        setDocumentHtml(item.documentHtml || null);
      } else {
        setSermonDocument(null);
        setDocumentHtml(null);
      }
      // Track which history item is currently being viewed
      setCurrentHistoryItemId(item.id);
      setShowHistory(false);
    },
    [setTranscription, setSelectedFile, setShowHistory]
  );

  const saveEdits = useCallback((): void => {
    if (currentHistoryItemId && documentHtml) {
      updateHistoryItem(currentHistoryItemId, { documentHtml });
    }
  }, [currentHistoryItemId, documentHtml, updateHistoryItem]);

  const onCopy = useCallback(async (): Promise<void> => {
    await handleCopy(copyToClipboard);
  }, [handleCopy, copyToClipboard]);

  // Wrap handleSave to include sermon-specific data
  const wrappedHandleSave = useCallback(
    async (format?: OutputFormat): Promise<void> => {
      // For sermon documents with HTML, we need to pass extra data
      // The handleSave function from useTranscription is basic
      // We need to call saveFile directly with sermon data
      if (sermonDocument && documentHtml) {
        const { saveFile } = await import('../services/electronAPI');
        const fileName = selectedFile?.name?.replace(/\.[^/.]+$/, '') || 'sermon';

        const result = await saveFile({
          defaultName: `${fileName}.${format || 'txt'}`,
          content: transcription, // Fallback plain text
          format: format || 'txt',
          html: documentHtml,
          isSermon: true,
        });

        if (result?.error) {
          console.error('Failed to save:', result.error);
        }
      } else {
        // Standard save for non-sermon content
        await handleSave(format);
      }
    },
    [sermonDocument, documentHtml, selectedFile, transcription, handleSave]
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
        setDocumentHtml(null);
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
    setDocumentHtml(null);
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
      documentHtml,
      pipelineProgress,
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
      documentHtml,
      pipelineProgress,
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
      setDocumentHtml,
      saveEdits,
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
      saveEdits,
    ]
  );

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <HistoryContext.Provider value={historyContextValue}>
        <TranscriptionStateContext.Provider value={transcriptionStateValue}>
          <TranscriptionActionsContext.Provider value={transcriptionActionsValue}>
            {children}
          </TranscriptionActionsContext.Provider>
        </TranscriptionStateContext.Provider>
      </HistoryContext.Provider>
    </ThemeContext.Provider>
  );
}
