import { ipcMain, dialog, app, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import {
  listModels,
  downloadModel,
  deleteModel,
  checkGpuStatus,
  checkFFmpeg,
} from '../services/whisper';
import {
  transcribe as pythonTranscribe,
  processSermon,
  cancelTranscription as cancelPythonTranscription,
  checkDependencies as checkPythonDependencies,
} from '../services/python-whisper';
import {
  checkPythonStatus,
  installAll as installPythonEnvironment,
  downloadWhisperModel,
} from '../services/python-installer';
import { checkForUpdates, downloadUpdate, quitAndInstall } from '../services/auto-updater';
import {
  generateWordDocument,
  generatePdfDocument,
  generateMarkdownDocument,
  generateWordDocumentFromHtml,
  generatePdfDocumentFromHtml,
  generateMarkdownFromHtml,
  htmlToSermonPlainText,
} from '../utils/export-helper';
import { trackEvent, AnalyticsEvents } from '../services/analytics';
import type { TranscriptionOptions, SaveFileOptions } from '../../shared/types';

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('dialog:openFile', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio/Video',
          extensions: ['mp3', 'wav', 'm4a', 'mp4', 'mov', 'mkv', 'flac', 'ogg', 'webm'],
        },
      ],
    });
    if (canceled) {
      return null;
    }
    return filePaths[0];
  });

  ipcMain.handle('dialog:openMultipleFiles', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Audio/Video',
          extensions: ['mp3', 'wav', 'm4a', 'mp4', 'mov', 'mkv', 'flac', 'ogg', 'webm'],
        },
      ],
    });
    return canceled ? null : filePaths;
  });

  ipcMain.handle('dialog:saveFile', async (_event, options: SaveFileOptions) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false, error: 'No window available' };

    const { defaultName, content, format, html, isSermon } = options;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    try {
      let data: string | Buffer = content;
      const fileName = path.basename(filePath);

      // Use HTML-based export for sermon documents
      if (isSermon && html) {
        if (format === 'docx') {
          data = await generateWordDocumentFromHtml(html, { fileName });
        } else if (format === 'pdf') {
          data = await generatePdfDocumentFromHtml(html, { fileName });
        } else if (format === 'md') {
          data = generateMarkdownFromHtml(html, { fileName });
        } else if (format === 'txt') {
          // Use sermon-specific text export (no header metadata, title first)
          data = htmlToSermonPlainText(html);
        }
      } else {
        // Standard transcription export
        if (format === 'docx') {
          data = await generateWordDocument(content, { fileName });
        } else if (format === 'pdf') {
          data = await generatePdfDocument(content, { fileName });
        } else if (format === 'md') {
          data = generateMarkdownDocument(content, { fileName });
        }
      }

      fs.writeFileSync(filePath, data);
      trackEvent(AnalyticsEvents.EXPORT_SAVED, { format, isSermon: !!isSermon });
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('file:getInfo', async (_event, filePath: string) => {
    try {
      const stats = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('models:list', async () => {
    const models = listModels();
    return { models };
  });

  ipcMain.handle('models:gpuStatus', () => checkGpuStatus());

  ipcMain.handle('system:checkFFmpeg', () => checkFFmpeg());

  ipcMain.handle('models:download', async (_event, modelName: string) => {
    try {
      const result = await downloadModel(modelName, (progress) => {
        getMainWindow()?.webContents.send('models:downloadProgress', progress);
      });
      if (result.success) {
        trackEvent(AnalyticsEvents.MODEL_DOWNLOADED, { model: modelName });
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('models:delete', (_event, modelName: string) => {
    const result = deleteModel(modelName);
    if (result.success) {
      trackEvent(AnalyticsEvents.MODEL_DELETED, { model: modelName });
    }
    return result;
  });

  let currentTranscription: { cancel?: () => void } | null = null;

  // Standard transcription handler - now uses Python Whisper
  ipcMain.handle('transcribe:start', async (_event, options: TranscriptionOptions) => {
    try {
      trackEvent(AnalyticsEvents.TRANSCRIPTION_STARTED, {
        model: options.model,
        language: options.language,
      });

      // Use Python transcription (whisper.cpp has been removed)
      const result = await pythonTranscribe(options, (progress) => {
        getMainWindow()?.webContents.send('transcribe:progress', progress);
      });

      currentTranscription = null;

      if (result.success && !result.cancelled) {
        trackEvent(AnalyticsEvents.TRANSCRIPTION_COMPLETED, {
          model: options.model,
          language: options.language,
        });
      } else if (result.cancelled) {
        trackEvent(AnalyticsEvents.TRANSCRIPTION_CANCELLED);
      }

      return result;
    } catch (error) {
      currentTranscription = null;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedError = errorMessage
        .replace(/\/[^\s]+/g, '[path]')
        .replace(/[A-Za-z]:[\\/][^\s]+/g, '[path]')
        .substring(0, 100);
      trackEvent(AnalyticsEvents.TRANSCRIPTION_FAILED, {
        model: options.model,
        error: sanitizedError,
      });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('transcribe:cancel', () => {
    // Cancel Python transcription
    return cancelPythonTranscription();
  });

  ipcMain.handle('app:getInfo', () => {
    return {
      isDev: !app.isPackaged,
      version: app.getVersion(),
      platform: process.platform,
      osVersion: process.getSystemVersion(),
    };
  });

  ipcMain.handle('app:getMemoryUsage', () => {
    const memory = process.memoryUsage();
    return {
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      rss: memory.rss,
      external: memory.external,
      isTranscribing: !!currentTranscription,
    };
  });

  ipcMain.handle(
    'analytics:track',
    (_event, eventName: string, properties?: Record<string, string | number | boolean>) => {
      trackEvent(eventName, properties);
    }
  );

  ipcMain.handle('update:check', () => checkForUpdates());

  ipcMain.handle('update:download', () => downloadUpdate());

  ipcMain.handle('update:install', () => {
    trackEvent(AnalyticsEvents.UPDATE_INSTALLED);
    quitAndInstall();
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!url.startsWith('https://')) {
      throw new Error('Invalid URL protocol. Only HTTPS is allowed.');
    }
    await shell.openExternal(url);
  });

  // ============================================================================
  // PYTHON ENVIRONMENT HANDLERS
  // ============================================================================

  ipcMain.handle('python:checkStatus', async () => {
    try {
      return await checkPythonStatus();
    } catch (error) {
      return {
        installed: false,
        packagesInstalled: false,
        modelsDownloaded: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('python:install', async () => {
    try {
      await installPythonEnvironment((progress) => {
        getMainWindow()?.webContents.send('python:installProgress', progress);
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('python:downloadModel', async (_event, modelName: string) => {
    try {
      await downloadWhisperModel(modelName, (progress) => {
        getMainWindow()?.webContents.send('python:modelProgress', progress);
      });
      return { success: true, model: modelName };
    } catch (error) {
      return {
        success: false,
        model: modelName,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('python:checkDependencies', async () => {
    return await checkPythonDependencies();
  });

  // ============================================================================
  // PYTHON TRANSCRIPTION HANDLERS (sermon processing)
  // ============================================================================

  interface ExtendedTranscriptionOptions extends TranscriptionOptions {
    processAsSermon?: boolean;
  }

  // Stage names for progress mapping
  const STAGE_NAMES: Record<number, string> = {
    1: 'Transcribe',
    2: 'Metadata',
    3: 'Bible Quotes',
    4: 'Paragraphs',
    5: 'Tags',
  };

  // Calculate overall progress based on stage and stage progress
  function calculateOverallProgress(stage: number, stagePercent: number): number {
    // Each stage contributes to overall progress
    // Stage 1: 0-60% (transcription is the longest)
    // Stage 2: 60-65%
    // Stage 3: 65-80%
    // Stage 4: 80-90%
    // Stage 5: 90-100%
    const stageWeights: Record<number, { start: number; end: number }> = {
      1: { start: 0, end: 60 },
      2: { start: 60, end: 65 },
      3: { start: 65, end: 80 },
      4: { start: 80, end: 90 },
      5: { start: 90, end: 100 },
    };

    const weight = stageWeights[stage] || { start: 0, end: 100 };
    const stageContribution = (stagePercent / 100) * (weight.end - weight.start);
    return Math.round(weight.start + stageContribution);
  }

  ipcMain.handle('transcribe:startPython', async (_event, options: ExtendedTranscriptionOptions) => {
    try {
      const { processAsSermon, ...transcriptionOptions } = options;

      trackEvent(AnalyticsEvents.TRANSCRIPTION_STARTED, {
        model: options.model,
        language: options.language,
        sermonMode: processAsSermon ? 'true' : 'false',
      });

      let result;

      if (processAsSermon) {
        // Full sermon processing pipeline
        result = await processSermon(
          transcriptionOptions,
          (progress) => {
            // Transcription progress (stage 1)
            getMainWindow()?.webContents.send('transcribe:progress', progress);
          },
          (pipelineProgress) => {
            // Transform pipeline progress to match UI format
            const transformedProgress = {
              currentStage: {
                id: pipelineProgress.stage,
                name: STAGE_NAMES[pipelineProgress.stage] || pipelineProgress.stageName,
              },
              stageProgress: pipelineProgress.percent,
              overallProgress: calculateOverallProgress(
                pipelineProgress.stage,
                pipelineProgress.percent
              ),
              message: pipelineProgress.message,
            };
            getMainWindow()?.webContents.send('transcribe:pipelineProgress', transformedProgress);
          }
        );

        // Transform result to match SermonTranscriptionResult interface
        // The Python bridge returns sermon data directly in result.sermon
        if (result.success && result.sermon) {
          return {
            success: true,
            text: result.text,
            sermonDocument: {
              title: result.sermon.title,
              biblePassage: result.sermon.biblePassage,
              references: result.sermon.references || [],
              tags: result.sermon.tags || [],
              body: result.sermon.body || '',
              rawTranscript: result.sermon.rawTranscript || result.text || '',
            },
          };
        }
      } else {
        // Simple transcription only
        result = await pythonTranscribe(transcriptionOptions, (progress) => {
          getMainWindow()?.webContents.send('transcribe:progress', progress);
        });
      }

      if (result.success && !result.cancelled) {
        trackEvent(AnalyticsEvents.TRANSCRIPTION_COMPLETED, {
          model: options.model,
          language: options.language,
          sermonMode: processAsSermon ? 'true' : 'false',
        });
      } else if (result.cancelled) {
        trackEvent(AnalyticsEvents.TRANSCRIPTION_CANCELLED);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      trackEvent(AnalyticsEvents.TRANSCRIPTION_FAILED, {
        model: options.model,
        error: errorMessage.substring(0, 100),
      });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('transcribe:cancelPython', () => {
    return cancelPythonTranscription();
  });
}
