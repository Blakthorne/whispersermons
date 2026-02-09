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
import type { TranscriptionOptions, SaveFileOptions, TranscriptionResult } from '../../shared/types';

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

  // Stage names for progress mapping (shared across handlers)
  const STAGE_NAMES: Record<number, string> = {
    1: 'Transcribe',
    2: 'Metadata',
    3: 'Bible Quotes',
    4: 'Paragraphs',
    5: 'Tags',
  };

  // Calculate overall progress based on stage and stage progress
  function calculateOverallProgress(stage: number, stagePercent: number): number {
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

  // Standard transcription handler - now uses Python sermon pipeline
  ipcMain.handle('transcribe:start', async (_event, options: TranscriptionOptions) => {
    try {
      trackEvent(AnalyticsEvents.TRANSCRIPTION_STARTED, {
        model: options.model,
        language: options.language,
        sermonMode: 'true',
      });

      const result = await processSermon(
        options,
        (progress) => {
          // Stage 1 transcription progress
          getMainWindow()?.webContents.send('transcribe:progress', progress);
        },
        (pipelineProgress) => {
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

      currentTranscription = null;

      if (result.success && result.sermon) {
        return {
          success: true,
          text: result.text,
          sermonDocument: {
            title: result.sermon.title,
            biblePassage: result.sermon.biblePassage,
            speaker: result.sermon.speaker,
            references: result.sermon.references || [],
            tags: result.sermon.tags || [],
            body: result.sermon.body || '',
            rawTranscript: result.sermon.rawTranscript || result.text || '',
            documentState: result.sermon.documentState,
            processingMetadata: result.sermon.processingMetadata,
          },
        } as TranscriptionResult & { sermonDocument: import('../../shared/types').SermonDocument };
      }

      if (result.success && !result.cancelled) {
        trackEvent(AnalyticsEvents.TRANSCRIPTION_COMPLETED, {
          model: options.model,
          language: options.language,
          sermonMode: 'true',
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
    const mainWindow = getMainWindow();
    return {
      isDev: !app.isPackaged,
      isDevToolsOpen: mainWindow?.webContents.isDevToolsOpened() ?? false,
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
    testMode?: boolean;
  }

  ipcMain.handle(
    'transcribe:startPython',
    async (_event, options: ExtendedTranscriptionOptions & { testMode?: boolean }) => {
      try {
        const { testMode, ...transcriptionOptions } = options;

        trackEvent(AnalyticsEvents.TRANSCRIPTION_STARTED, {
          model: options.model,
          language: options.language,
          sermonMode: 'true',
          testMode: testMode ? 'true' : 'false',
        });

        const result = await processSermon(
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
          },
          testMode
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
              speaker: result.sermon.speaker,
              references: result.sermon.references || [],
              tags: result.sermon.tags || [],
              body: result.sermon.body || '',
              rawTranscript: result.sermon.rawTranscript || result.text || '',
              // Include AST document state (quote boundaries, interjections, etc.)
              documentState: result.sermon.documentState,
              processingMetadata: result.sermon.processingMetadata,
            },
          };
        }

        if (result.success && !result.cancelled) {
          trackEvent(AnalyticsEvents.TRANSCRIPTION_COMPLETED, {
            model: options.model,
            language: options.language,
            sermonMode: 'true',
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
    }
  );

  ipcMain.handle('transcribe:cancelPython', () => {
    return cancelPythonTranscription();
  });

  // ============================================================================
  // BIBLE API HANDLERS
  // ============================================================================

  /**
   * List of all 66 Bible book names with common abbreviations
   */
  const BIBLE_BOOKS = [
    // Old Testament
    { name: 'Genesis', abbrevs: ['Gen', 'Ge', 'Gn'] },
    { name: 'Exodus', abbrevs: ['Exod', 'Ex', 'Exo'] },
    { name: 'Leviticus', abbrevs: ['Lev', 'Le', 'Lv'] },
    { name: 'Numbers', abbrevs: ['Num', 'Nu', 'Nm', 'Nb'] },
    { name: 'Deuteronomy', abbrevs: ['Deut', 'De', 'Dt'] },
    { name: 'Joshua', abbrevs: ['Josh', 'Jos', 'Jsh'] },
    { name: 'Judges', abbrevs: ['Judg', 'Jdg', 'Jg', 'Jdgs'] },
    { name: 'Ruth', abbrevs: ['Rth', 'Ru'] },
    { name: '1 Samuel', abbrevs: ['1 Sam', '1Sam', '1Sa', '1S', 'I Sam', 'First Samuel'] },
    { name: '2 Samuel', abbrevs: ['2 Sam', '2Sam', '2Sa', '2S', 'II Sam', 'Second Samuel'] },
    { name: '1 Kings', abbrevs: ['1 Kgs', '1Kgs', '1Ki', '1K', 'I Kings', 'First Kings'] },
    { name: '2 Kings', abbrevs: ['2 Kgs', '2Kgs', '2Ki', '2K', 'II Kings', 'Second Kings'] },
    { name: '1 Chronicles', abbrevs: ['1 Chron', '1Chron', '1Ch', '1 Chr', 'I Chronicles', 'First Chronicles'] },
    { name: '2 Chronicles', abbrevs: ['2 Chron', '2Chron', '2Ch', '2 Chr', 'II Chronicles', 'Second Chronicles'] },
    { name: 'Ezra', abbrevs: ['Ezr', 'Ez'] },
    { name: 'Nehemiah', abbrevs: ['Neh', 'Ne'] },
    { name: 'Esther', abbrevs: ['Esth', 'Est', 'Es'] },
    { name: 'Job', abbrevs: ['Jb'] },
    { name: 'Psalms', abbrevs: ['Ps', 'Psa', 'Psalm', 'Pss'] },
    { name: 'Proverbs', abbrevs: ['Prov', 'Pro', 'Pr', 'Prv'] },
    { name: 'Ecclesiastes', abbrevs: ['Eccl', 'Ecc', 'Ec', 'Qoh'] },
    { name: 'Song of Solomon', abbrevs: ['Song', 'SOS', 'SS', 'Canticles', 'Song of Songs'] },
    { name: 'Isaiah', abbrevs: ['Isa', 'Is'] },
    { name: 'Jeremiah', abbrevs: ['Jer', 'Je', 'Jr'] },
    { name: 'Lamentations', abbrevs: ['Lam', 'La'] },
    { name: 'Ezekiel', abbrevs: ['Ezek', 'Eze', 'Ezk'] },
    { name: 'Daniel', abbrevs: ['Dan', 'Da', 'Dn'] },
    { name: 'Hosea', abbrevs: ['Hos', 'Ho'] },
    { name: 'Joel', abbrevs: ['Joe', 'Jl'] },
    { name: 'Amos', abbrevs: ['Am'] },
    { name: 'Obadiah', abbrevs: ['Obad', 'Ob'] },
    { name: 'Jonah', abbrevs: ['Jon', 'Jnh'] },
    { name: 'Micah', abbrevs: ['Mic', 'Mi'] },
    { name: 'Nahum', abbrevs: ['Nah', 'Na'] },
    { name: 'Habakkuk', abbrevs: ['Hab', 'Hb'] },
    { name: 'Zephaniah', abbrevs: ['Zeph', 'Zep', 'Zp'] },
    { name: 'Haggai', abbrevs: ['Hag', 'Hg'] },
    { name: 'Zechariah', abbrevs: ['Zech', 'Zec', 'Zc'] },
    { name: 'Malachi', abbrevs: ['Mal', 'Ml'] },
    // New Testament
    { name: 'Matthew', abbrevs: ['Matt', 'Mat', 'Mt'] },
    { name: 'Mark', abbrevs: ['Mk', 'Mr'] },
    { name: 'Luke', abbrevs: ['Lk', 'Lu'] },
    { name: 'John', abbrevs: ['Jn', 'Jhn'] },
    { name: 'Acts', abbrevs: ['Ac'] },
    { name: 'Romans', abbrevs: ['Rom', 'Ro', 'Rm'] },
    { name: '1 Corinthians', abbrevs: ['1 Cor', '1Cor', '1Co', 'I Corinthians', 'First Corinthians'] },
    { name: '2 Corinthians', abbrevs: ['2 Cor', '2Cor', '2Co', 'II Corinthians', 'Second Corinthians'] },
    { name: 'Galatians', abbrevs: ['Gal', 'Ga'] },
    { name: 'Ephesians', abbrevs: ['Eph', 'Ephes'] },
    { name: 'Philippians', abbrevs: ['Phil', 'Php', 'Pp'] },
    { name: 'Colossians', abbrevs: ['Col', 'Co'] },
    { name: '1 Thessalonians', abbrevs: ['1 Thess', '1Thess', '1Th', 'I Thessalonians', 'First Thessalonians'] },
    { name: '2 Thessalonians', abbrevs: ['2 Thess', '2Thess', '2Th', 'II Thessalonians', 'Second Thessalonians'] },
    { name: '1 Timothy', abbrevs: ['1 Tim', '1Tim', '1Ti', 'I Timothy', 'First Timothy'] },
    { name: '2 Timothy', abbrevs: ['2 Tim', '2Tim', '2Ti', 'II Timothy', 'Second Timothy'] },
    { name: 'Titus', abbrevs: ['Tit', 'Ti'] },
    { name: 'Philemon', abbrevs: ['Phlm', 'Phm', 'Pm'] },
    { name: 'Hebrews', abbrevs: ['Heb'] },
    { name: 'James', abbrevs: ['Jas', 'Jm'] },
    { name: '1 Peter', abbrevs: ['1 Pet', '1Pet', '1Pe', '1P', 'I Peter', 'First Peter'] },
    { name: '2 Peter', abbrevs: ['2 Pet', '2Pet', '2Pe', '2P', 'II Peter', 'Second Peter'] },
    { name: '1 John', abbrevs: ['1 Jn', '1Jn', '1J', 'I John', 'First John'] },
    { name: '2 John', abbrevs: ['2 Jn', '2Jn', '2J', 'II John', 'Second John'] },
    { name: '3 John', abbrevs: ['3 Jn', '3Jn', '3J', 'III John', 'Third John'] },
    { name: 'Jude', abbrevs: ['Jud', 'Jd'] },
    { name: 'Revelation', abbrevs: ['Rev', 'Re', 'Revelations'] },
  ];

  // Book ID mapping for Bolls.life API
  const BOOK_ID_MAP: Record<string, number> = {
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
    'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
    '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14,
    'Ezra': 15, 'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19,
    'Proverbs': 20, 'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23,
    'Jeremiah': 24, 'Lamentations': 25, 'Ezekiel': 26, 'Daniel': 27,
    'Hosea': 28, 'Joel': 29, 'Amos': 30, 'Obadiah': 31, 'Jonah': 32,
    'Micah': 33, 'Nahum': 34, 'Habakkuk': 35, 'Zephaniah': 36, 'Haggai': 37,
    'Zechariah': 38, 'Malachi': 39, 'Matthew': 40, 'Mark': 41, 'Luke': 42,
    'John': 43, 'Acts': 44, 'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47,
    'Galatians': 48, 'Ephesians': 49, 'Philippians': 50, 'Colossians': 51,
    '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54, '2 Timothy': 55,
    'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59, '1 Peter': 60,
    '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64, 'Jude': 65,
    'Revelation': 66
  };

  /**
   * Parse a Bible reference string into its components
   */
  function parseReference(reference: string): {
    book: string;
    chapter: number;
    verseStart: number | null;
    verseEnd: number | null;
  } | null {
    // Normalize the reference
    const normalized = reference.trim();

    // Match patterns like "John 3:16", "1 Corinthians 13:4-7", "Psalms 23"
    // Book can have numbers at start (1 John, 2 Kings)
    const match = normalized.match(
      /^(\d?\s*[A-Za-z]+(?:\s+of\s+[A-Za-z]+)?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?/i
    );

    if (!match) return null;

    const [, bookPart, chapterStr, verseStartStr, verseEndStr] = match;

    // Check if bookPart is defined
    if (!bookPart || !chapterStr) return null;

    // Normalize book name
    const bookLower = bookPart.toLowerCase().trim();
    let book: string | null = null;

    for (const bookInfo of BIBLE_BOOKS) {
      if (bookInfo.name.toLowerCase() === bookLower) {
        book = bookInfo.name;
        break;
      }
      for (const abbrev of bookInfo.abbrevs) {
        if (abbrev.toLowerCase() === bookLower) {
          book = bookInfo.name;
          break;
        }
      }
      if (book) break;
    }

    if (!book) return null;

    return {
      book,
      chapter: parseInt(chapterStr, 10),
      verseStart: verseStartStr ? parseInt(verseStartStr, 10) : null,
      verseEnd: verseEndStr ? parseInt(verseEndStr, 10) : null,
    };
  }

  /**
   * Clean HTML tags from API response
   */
  function cleanHtml(text: string): string {
    // Remove Strong's number tags
    let cleaned = text.replace(/<S>\d+<\/S>/g, '');
    cleaned = cleaned.replace(/<sup>[^<]*<\/sup>/g, '');
    // Remove remaining HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, '');
    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ');
    return cleaned.trim();
  }

  ipcMain.handle('bible:getBookNames', () => {
    return BIBLE_BOOKS.map(b => ({
      name: b.name,
      abbreviations: b.abbrevs,
    }));
  });

  ipcMain.handle(
    'bible:lookupVerse',
    async (
      _event,
      reference: string,
      translation: string = 'KJV'
    ): Promise<{
      success: boolean;
      verseText?: string;
      normalizedReference?: string;
      book?: string;
      chapter?: number;
      verseStart?: number | null;
      verseEnd?: number | null;
      translation?: string;
      error?: string;
    }> => {
      try {
        const parsed = parseReference(reference);

        if (!parsed) {
          return {
            success: false,
            error: `Could not parse reference: "${reference}"`,
          };
        }

        const { book, chapter, verseStart, verseEnd } = parsed;
        const bookId = BOOK_ID_MAP[book];

        if (!bookId) {
          return {
            success: false,
            error: `Unknown book: "${book}"`,
          };
        }

        // Build normalized reference string
        let normalizedReference = `${book} ${chapter}`;
        if (verseStart !== null) {
          normalizedReference += `:${verseStart}`;
          if (verseEnd !== null && verseEnd !== verseStart) {
            normalizedReference += `-${verseEnd}`;
          }
        }

        // Fetch from Bolls.life API
        const https = await import('https');

        const fetchVerse = (url: string): Promise<string> => {
          return new Promise((resolve, reject) => {
            https.get(url, (res) => {
              let data = '';
              res.on('data', (chunk) => { data += chunk; });
              res.on('end', () => resolve(data));
              res.on('error', reject);
            }).on('error', reject);
          });
        };

        let verseText = '';

        if (verseStart === null) {
          // Fetch entire chapter
          const url = `https://bolls.life/get-text/${translation}/${bookId}/${chapter}/`;
          const response = await fetchVerse(url);
          const data = JSON.parse(response);

          if (Array.isArray(data)) {
            verseText = data.map((v: { text: string }) => cleanHtml(v.text)).join(' ');
          }
        } else if (verseEnd === null || verseEnd === verseStart) {
          // Fetch single verse
          const url = `https://bolls.life/get-verse/${translation}/${bookId}/${chapter}/${verseStart}/`;
          const response = await fetchVerse(url);
          const data = JSON.parse(response);

          if (data && data.text) {
            verseText = cleanHtml(data.text);
          }
        } else {
          // Fetch verse range
          const verses: string[] = [];
          for (let v = verseStart; v <= verseEnd; v++) {
            const url = `https://bolls.life/get-verse/${translation}/${bookId}/${chapter}/${v}/`;
            const response = await fetchVerse(url);
            const data = JSON.parse(response);
            if (data && data.text) {
              verses.push(cleanHtml(data.text));
            }
          }
          verseText = verses.join(' ');
        }

        if (!verseText) {
          return {
            success: false,
            error: 'Verse not found',
          };
        }

        return {
          success: true,
          verseText,
          normalizedReference,
          book,
          chapter,
          verseStart,
          verseEnd,
          translation,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}
