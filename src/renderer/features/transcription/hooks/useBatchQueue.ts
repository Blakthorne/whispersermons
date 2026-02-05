import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  SelectedFile,
  TranscriptionSettings,
  QueueItem,
  QueueItemStatus,
  HistoryItem,
  SermonDocument,
} from '../../../types';
import {
  startPythonTranscription,
  cancelPythonTranscription,
  onPipelineProgress,
} from '../../../services/electronAPI';
import type { PipelineProgress, SermonTranscriptionResult } from '../../../services/electronAPI';
import { logger } from '../../../services/logger';
import { sanitizePath } from '../../../../shared/utils';
import type { WhisperAdvancedSettings } from '../../preferences/types';

interface UseBatchQueueOptions {
  settings: TranscriptionSettings;
  advancedSettings?: WhisperAdvancedSettings;
  onHistoryAdd?: (item: HistoryItem) => void;
  onFirstComplete?: (id: string, text: string, file: SelectedFile, sermonDocument?: SermonDocument) => void;
}

interface UseBatchQueueReturn {
  queue: QueueItem[];
  isProcessing: boolean;
  currentItemId: string | null;
  pipelineProgress: PipelineProgress | null;

  addFiles: (files: SelectedFile[]) => void;
  removeFile: (id: string) => void;
  clearCompleted: () => void;
  clearAll: () => void;

  startProcessing: () => Promise<void>;
  cancelProcessing: () => Promise<void>;

  getCompletedTranscription: (id: string) => string | undefined;
}

function generateId(): string {
  return crypto.randomUUID();
}

export function useBatchQueue(options: UseBatchQueueOptions): UseBatchQueueReturn {
  const { settings, advancedSettings, onHistoryAdd, onFirstComplete } = options;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);

  const isCancelledRef = useRef(false);
  const hasCalledFirstCompleteRef = useRef(false);
  const pipelineProgressUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (pipelineProgressUnsubscribeRef.current) {
        pipelineProgressUnsubscribeRef.current();
        pipelineProgressUnsubscribeRef.current = null;
      }
    };
  }, []);

  const addFiles = useCallback((files: SelectedFile[]) => {
    const newItems: QueueItem[] = files.map((file) => ({
      id: generateId(),
      file,
      status: 'pending' as QueueItemStatus,
      progress: { percent: 0, status: '' },
    }));

    setQueue((prev) => [...prev, ...newItems]);

    logger.info('Added files to batch queue', {
      count: files.length,
      files: files.map((f) => f.name),
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
    logger.info('Removed file from batch queue', { id });
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) =>
      prev.filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    );
    logger.info('Cleared completed items from batch queue');
  }, []);

  const clearAll = useCallback(() => {
    if (isProcessing) {
      logger.warn('Cannot clear queue while processing');
      return;
    }
    setQueue([]);
    logger.info('Cleared all items from batch queue');
  }, [isProcessing]);

  const processItem = useCallback(
    async (item: QueueItem): Promise<QueueItem> => {
      const startTime = Date.now();

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: 'processing' as QueueItemStatus, startTime } : q
        )
      );
      setCurrentItemId(item.id);

      if (pipelineProgressUnsubscribeRef.current) {
        pipelineProgressUnsubscribeRef.current();
        pipelineProgressUnsubscribeRef.current = null;
      }

      // Subscribe to pipeline progress for sermon processing
      pipelineProgressUnsubscribeRef.current = onPipelineProgress((progress) => {
        setPipelineProgress(progress);

        // Calculate overall progress using weighted stages (matching PipelineProgress component)
        // Stage weights: Transcribe=60%, Metadata=5%, Bible Quotes=25%, Paragraphs=5%, Tags=5%
        const stageWeights: Record<number, { start: number; end: number }> = {
          1: { start: 0, end: 60 },
          2: { start: 60, end: 65 },
          3: { start: 65, end: 90 },
          4: { start: 90, end: 95 },
          5: { start: 95, end: 100 },
        };

        const stageId = progress.currentStage?.id;
        let calculatedOverallProgress = 0;
        if (stageId && stageWeights[stageId]) {
          const weight = stageWeights[stageId];
          const stageContribution = (progress.stageProgress / 100) * (weight.end - weight.start);
          calculatedOverallProgress = Math.min(100, Math.round(weight.start + stageContribution));
        }

        // Update the queue item's progress to reflect overall pipeline progress
        // This ensures the FileQueue progress bar matches the PipelineProgress display
        if (item.id !== 'test-mode-dummy-id') {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? {
                  ...q,
                  progress: {
                    percent: calculatedOverallProgress,
                    status: progress.message,
                  },
                }
                : q
            )
          );
        }
      });

      logger.info('Processing batch item', {
        id: item.id,
        file: sanitizePath(item.file.path),
        model: settings.model,
        language: settings.language,
        sermonMode: true,
      });

      try {
        const result: SermonTranscriptionResult = await startPythonTranscription({
          filePath: item.file.path,
          model: settings.model,
          language: settings.language,
          outputFormat: 'vtt',
          testMode: settings.testMode,
          advancedSettings,
        });

        const endTime = Date.now();

        if (isCancelledRef.current) {
          return {
            ...item,
            status: 'cancelled',
            endTime,
          };
        }

        if (!result || result.error || !result.success) {
          const error = result?.error || 'Transcription failed';
          logger.error('Batch item failed', { id: item.id, error });
          return {
            ...item,
            status: 'error',
            error,
            endTime,
          };
        }

        if (result.cancelled) {
          return {
            ...item,
            status: 'cancelled',
            endTime,
          };
        }

        if (!result.text) {
          return {
            ...item,
            status: 'error',
            error: 'Transcription produced no output',
            endTime,
          };
        }

        logger.info('Batch item completed', {
          id: item.id,
          durationMs: endTime - startTime,
        });

        if (onHistoryAdd) {
          const historyItem: HistoryItem = {
            id: crypto.randomUUID(),
            fileName: item.file.name,
            filePath: item.file.path,
            model: settings.model,
            language: settings.language,
            date: new Date().toISOString(),
            duration: Math.round((endTime - startTime) / 1000),
            preview: result.text.substring(0, 100) + (result.text.length > 100 ? '...' : ''),
            fullText: result.text,
            // Sermon-specific fields - AST in sermonDocument.documentState is source of truth
            isSermon: true,
            sermonDocument: result.sermonDocument,
          };
          onHistoryAdd(historyItem);
        }

        if (!hasCalledFirstCompleteRef.current && onFirstComplete && result.text) {
          hasCalledFirstCompleteRef.current = true;
          onFirstComplete(item.id, result.text, item.file, result.sermonDocument);
        }

        return {
          ...item,
          status: 'completed',
          result,
          progress: { percent: 100, status: 'Complete!' },
          endTime,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        logger.error('Batch item threw error', { id: item.id, error: err });
        return {
          ...item,
          status: 'error',
          error,
          endTime: Date.now(),
        };
      } finally {
        if (pipelineProgressUnsubscribeRef.current) {
          pipelineProgressUnsubscribeRef.current();
          pipelineProgressUnsubscribeRef.current = null;
        }
      }
    },
    [settings, onHistoryAdd, onFirstComplete]
  );

  const startProcessing = useCallback(async () => {
    if (isProcessing) return;

    const itemsToProcess = queue.filter(
      (item) => item.status === 'pending' || item.status === 'cancelled' || item.status === 'error'
    );

    if (itemsToProcess.length === 0 && !settings.testMode) {
      logger.warn('No items to process');
      return;
    }

    // New logic for Test Mode with empty queue
    let effectiveQueue = itemsToProcess;
    if (itemsToProcess.length === 0 && settings.testMode) {
      const dummyItem: QueueItem = {
        id: 'test-mode-dummy-id',
        file: {
          name: 'test_transcript.txt',
          path: 'test_transcript.txt',
          size: 0
        },
        status: 'pending',
        progress: { percent: 0, status: 'Pending' }
      };
      effectiveQueue = [dummyItem];
      // We don't verify update the main queue state for this dummy item to avoid UI clutter, 
      // or we could add it temporarily. For now, let's treat it as transient.
    }

    if (!settings.testMode) {
      setQueue((prev) =>
        prev.map((item) =>
          item.status === 'cancelled' || item.status === 'error'
            ? { ...item, status: 'pending' as QueueItemStatus, error: undefined, endTime: undefined }
            : item
        )
      );
    }

    setIsProcessing(true);
    isCancelledRef.current = false;
    hasCalledFirstCompleteRef.current = false;

    logger.info('Starting batch processing', { count: effectiveQueue.length, testMode: settings.testMode });

    for (const item of effectiveQueue) {
      if (isCancelledRef.current) {
        setQueue((prev) =>
          prev.map((q) =>
            q.status === 'pending' ? { ...q, status: 'cancelled' as QueueItemStatus } : q
          )
        );
        break;
      }

      const resetItem = { ...item, status: 'pending' as QueueItemStatus, error: undefined };
      const processedItem = await processItem(resetItem);

      if (processedItem.id !== 'test-mode-dummy-id') {
        setQueue((prev) => prev.map((q) => (q.id === processedItem.id ? processedItem : q)));
      }

      // Clear pipeline progress after each item completes
      setPipelineProgress(null);
    }

    setIsProcessing(false);
    setCurrentItemId(null);
    setPipelineProgress(null);
    logger.info('Batch processing complete');
  }, [isProcessing, queue, processItem]);

  const cancelProcessing = useCallback(async () => {
    if (!isProcessing) return;

    isCancelledRef.current = true;

    await cancelPythonTranscription();

    setIsProcessing(false);
    setCurrentItemId(null);
    setPipelineProgress(null);

    setQueue((prev) =>
      prev.map((q) =>
        q.status === 'processing' || q.status === 'pending'
          ? { ...q, status: 'cancelled' as QueueItemStatus, endTime: Date.now() }
          : q
      )
    );

    if (pipelineProgressUnsubscribeRef.current) {
      pipelineProgressUnsubscribeRef.current();
      pipelineProgressUnsubscribeRef.current = null;
    }

    logger.warn('Batch processing cancelled by user');
  }, [isProcessing]);

  const getCompletedTranscription = useCallback(
    (id: string): string | undefined => {
      const item = queue.find((q) => q.id === id);
      if (item?.status === 'completed' && item.result?.text) {
        return item.result.text;
      }
      return undefined;
    },
    [queue]
  );

  return {
    queue,
    isProcessing,
    currentItemId,
    pipelineProgress,

    addFiles,
    removeFile,
    clearCompleted,
    clearAll,

    startProcessing,
    cancelProcessing,

    getCompletedTranscription,
  };
}
