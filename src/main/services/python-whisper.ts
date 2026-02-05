/**
 * Python Whisper Transcription Service
 *
 * This module replaces the whisper.cpp-based transcription with Python Whisper.
 * It spawns the Python bridge subprocess and communicates via JSON.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type {
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionProgress,
} from '../../shared/types';
import { getPythonPath, getWhisperCacheDir } from './python-installer';

// ============================================================================
// TYPES
// ============================================================================

export interface SermonProcessingResult {
  title?: string;
  biblePassage?: string;
  speaker?: string;
  tags: string[];
  references: string[];
  body: string;
  rawTranscript: string;
  /**
   * Structured document state (AST-based model)
   * Contains the full document tree with stable node IDs, passage metadata,
   * interjection positions, and event log for undo/redo.
   */
  documentState?: import('../../shared/documentModel').DocumentState;
  /**
   * Processing metadata with timing and statistics
   */
  processingMetadata?: {
    stageTimes: Record<string, number>;
    totalTime: number;
    passageCount: number;
    paragraphCount: number;
    interjectionCount: number;
  };
  /**
   * Error message if AST building failed (legacy output still available)
   */
  astError?: string;
}

export interface PipelineProgress {
  stage: number;
  stageName: string;
  percent: number;
  message: string;
}

interface PythonResponse {
  type: 'progress' | 'result' | 'error';
  stage?: number;
  stageName?: string;
  percent?: number;
  message?: string;
  error?: string;
  // Result fields
  text?: string;
  title?: string;
  biblePassage?: string;
  speaker?: string;
  tags?: string[];
  references?: string[];
  body?: string;
  rawTranscript?: string;
}

type TranscribeProgressCallback = (progress: TranscriptionProgress) => void;
type PipelineProgressCallback = (progress: PipelineProgress) => void;

// ============================================================================
// STATE
// ============================================================================

let currentProcess: ChildProcess | null = null;
let isCancelled = false;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPythonBridgePath(): string {
  if (isDev) {
    return path.join(process.cwd(), 'src', 'python', 'whisper_bridge.py');
  }
  // In production, Python files are bundled
  return path.join(app.getAppPath(), 'src', 'python', 'whisper_bridge.py');
}

/**
 * Spawn Python bridge and send a command
 */
async function runPythonCommand<T>(
  command: Record<string, unknown>,
  onProgress?: (response: PythonResponse) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const pythonPath = getPythonPath();
    const bridgePath = getPythonBridgePath();

    if (!fs.existsSync(pythonPath)) {
      reject(new Error('Python environment not installed. Please run setup first.'));
      return;
    }

    if (!fs.existsSync(bridgePath)) {
      reject(new Error('Python bridge not found.'));
      return;
    }

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      WHISPER_CACHE_DIR: getWhisperCacheDir(),
    };

    const proc = spawn(pythonPath, [bridgePath], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    currentProcess = proc;
    isCancelled = false;

    let stdout = '';
    let stderr = '';
    let lastResult: T | null = null;
    let stdoutBuffer = ''; // Buffer for incomplete JSON lines

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      stdoutBuffer += text;

      // Parse line-delimited JSON responses
      // Only process complete lines (ending with newline)
      // Keep partial lines in buffer for the next chunk
      const lastNewlineIndex = stdoutBuffer.lastIndexOf('\n');
      if (lastNewlineIndex === -1) {
        // No complete lines yet, keep buffering
        return;
      }

      // Split into complete lines and remaining partial line
      const completeData = stdoutBuffer.substring(0, lastNewlineIndex);
      stdoutBuffer = stdoutBuffer.substring(lastNewlineIndex + 1);

      const lines = completeData.split('\n').filter((line: string) => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line) as PythonResponse;

          if (response.type === 'progress' && onProgress) {
            onProgress(response);
          } else if (response.type === 'result') {
            lastResult = response as unknown as T;
          } else if (response.type === 'error') {
            reject(new Error(response.error || 'Unknown Python error'));
          }
        } catch {
          // Not JSON, ignore (might be debug output)
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log stderr for debugging but don't treat as error
      console.log('[Python stderr]', data.toString());
    });

    proc.on('close', (code) => {
      currentProcess = null;

      // Process any remaining data in the buffer
      if (stdoutBuffer.trim()) {
        try {
          const response = JSON.parse(stdoutBuffer) as PythonResponse;
          if (response.type === 'result') {
            lastResult = response as unknown as T;
          } else if (response.type === 'error') {
            reject(new Error(response.error || 'Unknown Python error'));
            return;
          }
        } catch {
          // Not JSON, ignore
        }
      }

      if (isCancelled) {
        reject(new Error('Transcription cancelled'));
        return;
      }

      if (code === 0 && lastResult) {
        resolve(lastResult);
      } else if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
      } else {
        reject(new Error('No result received from Python'));
      }
    });

    proc.on('error', (err) => {
      currentProcess = null;
      reject(err);
    });

    // Send command as JSON to stdin
    proc.stdin.write(JSON.stringify(command));
    proc.stdin.end();
  });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Transcribe audio using Python Whisper (without sermon processing)
 */
export async function transcribe(
  options: TranscriptionOptions,
  onProgress?: TranscribeProgressCallback
): Promise<TranscriptionResult> {
  const { filePath, model, language, advancedSettings } = options;

  try {
    const result = await runPythonCommand<{ text: string; rawTranscript: string }>(
      {
        command: 'transcribe',
        filePath,
        model,
        language,
        advancedSettings,
      },
      (response) => {
        if (onProgress && response.percent !== undefined) {
          onProgress({
            percent: response.percent,
            status: response.message || 'Transcribing...',
          });
        }
      }
    );

    return {
      success: true,
      text: result.text || result.rawTranscript,
    };
  } catch (error) {
    if (isCancelled) {
      return { success: false, cancelled: true };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Process sermon with full pipeline (transcribe + Bible quotes + tags)
 */
export async function processSermon(
  options: TranscriptionOptions,
  onTranscriptionProgress?: TranscribeProgressCallback,
  onPipelineProgress?: PipelineProgressCallback,
  skipTranscription: boolean = false
): Promise<TranscriptionResult & { sermon?: SermonProcessingResult }> {
  const { filePath, model, language, advancedSettings } = options;

  try {
    const result = await runPythonCommand<SermonProcessingResult>(
      {
        command: 'process_sermon',
        filePath,
        model,
        language,
        skip_transcription: skipTranscription,
        advancedSettings,
      },
      (response) => {
        // Route progress to appropriate callbacks
        if (response.stage === 1 && response.percent !== undefined) {
          // Stage 1 is transcription - send to both callbacks
          if (onTranscriptionProgress) {
            onTranscriptionProgress({
              percent: response.percent,
              status: response.message || 'Transcribing...',
            });
          }
          // Also send to pipeline progress so the stage indicator shows correctly
          if (onPipelineProgress) {
            onPipelineProgress({
              stage: response.stage || 0,
              stageName: response.stageName || '',
              percent: response.percent || 0,
              message: response.message || '',
            });
          }
        } else if (onPipelineProgress) {
          // Stages 2-5 go to pipeline progress
          onPipelineProgress({
            stage: response.stage || 0,
            stageName: response.stageName || '',
            percent: response.percent || 0,
            message: response.message || '',
          });
        }
      }
    );

    return {
      success: true,
      text: result.body || result.rawTranscript,
      sermon: result,
    };
  } catch (error) {
    if (isCancelled) {
      return { success: false, cancelled: true };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Cancel current transcription/processing
 */
export function cancelTranscription(): { success: boolean; message?: string } {
  if (currentProcess) {
    isCancelled = true;
    currentProcess.kill('SIGTERM');
    currentProcess = null;
    return { success: true, message: 'Transcription cancelled' };
  }
  return { success: false, message: 'No transcription in progress' };
}

/**
 * Check Python dependencies
 */
export async function checkDependencies(): Promise<{
  installed: boolean;
  device?: string;
  error?: string;
}> {
  try {
    const result = await runPythonCommand<{
      all_installed: boolean;
      device: string;
      dependencies: Record<string, boolean>;
    }>({
      command: 'check_dependencies',
    });

    return {
      installed: result.all_installed,
      device: result.device,
    };
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract audio metadata (for sermon mode)
 */
export async function extractMetadata(
  filePath: string
): Promise<{ title?: string; comment?: string; error?: string }> {
  try {
    const result = await runPythonCommand<{ title?: string; comment?: string; error?: string }>({
      command: 'extract_metadata',
      filePath,
    });
    return result;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
