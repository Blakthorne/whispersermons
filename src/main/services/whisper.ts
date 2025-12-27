/**
 * Whisper Service - Model Management and Utilities
 *
 * This module provides model management for Python Whisper.
 * Transcription is handled by python-whisper.ts.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { ModelDownloadProgress, ModelInfo, GpuInfo, QualityLevel } from '../../shared/types';
import { detectGpuStatus } from './gpu-detector';
import { getPythonPath, getWhisperCacheDir } from './python-installer';

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

/**
 * Python Whisper model information.
 * Models are automatically downloaded to the cache directory when first used.
 */
interface WhisperModelInfo {
  /** Display size for UI */
  size: string;
  /** Quality rating 1-5 */
  quality: QualityLevel;
  /** Relative speed compared to large model */
  speed: string;
  /** Estimated VRAM requirement */
  vram: string;
}

/**
 * Available Python Whisper models with their characteristics.
 * These match OpenAI's Whisper model names.
 */
export const MODELS: Record<string, WhisperModelInfo> = {
  tiny: {
    size: '~75 MB',
    quality: 1,
    speed: '~10x',
    vram: '~1 GB',
  },
  'tiny.en': {
    size: '~75 MB',
    quality: 1,
    speed: '~10x',
    vram: '~1 GB',
  },
  base: {
    size: '~140 MB',
    quality: 2,
    speed: '~7x',
    vram: '~1 GB',
  },
  'base.en': {
    size: '~140 MB',
    quality: 2,
    speed: '~7x',
    vram: '~1 GB',
  },
  small: {
    size: '~460 MB',
    quality: 3,
    speed: '~4x',
    vram: '~2 GB',
  },
  'small.en': {
    size: '~460 MB',
    quality: 3,
    speed: '~4x',
    vram: '~2 GB',
  },
  medium: {
    size: '~1.5 GB',
    quality: 4,
    speed: '~2x',
    vram: '~5 GB',
  },
  'medium.en': {
    size: '~1.5 GB',
    quality: 4,
    speed: '~2x',
    vram: '~5 GB',
  },
  'large-v3': {
    size: '~3.1 GB',
    quality: 5,
    speed: '~1x',
    vram: '~10 GB',
  },
  'large-v3-turbo': {
    size: '~1.6 GB',
    quality: 5,
    speed: '~2x',
    vram: '~6 GB',
  },
};

/** Model name aliases for convenience */
const MODEL_ALIASES: Record<string, string> = {
  large: 'large-v3',
  turbo: 'large-v3-turbo',
};

// ============================================================================
// MODEL MANAGEMENT
// ============================================================================

/**
 * Get the directory where Whisper models are cached.
 * Uses the same location as python-installer.
 */
export function getModelsDir(): string {
  return getWhisperCacheDir();
}

/**
 * Get the path to a specific model file.
 * Python Whisper caches models in a 'whisper' subdirectory as .pt files.
 */
export function getModelPath(modelName: string): string {
  const actualModel = MODEL_ALIASES[modelName] || modelName;

  // Python Whisper stores models in: XDG_CACHE_HOME/whisper/modelname.pt
  const modelsDir = getModelsDir();
  const whisperDir = path.join(modelsDir, 'whisper');

  // Handle turbo model naming
  if (actualModel === 'large-v3-turbo') {
    return path.join(whisperDir, 'large-v3-turbo.pt');
  }

  return path.join(whisperDir, `${actualModel}.pt`);
}

/**
 * Check if a model has been downloaded.
 */
export function isModelDownloaded(modelName: string): boolean {
  try {
    const modelPath = getModelPath(modelName);
    return fs.existsSync(modelPath);
  } catch {
    return false;
  }
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Get actual file size of a downloaded model.
 */
function getActualModelSize(modelName: string): string | null {
  try {
    const modelPath = getModelPath(modelName);
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      return formatFileSize(stats.size);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List all available models with their info.
 * Shows which models are downloaded and their actual sizes.
 */
export function listModels(): ModelInfo[] {
  const result: ModelInfo[] = [];

  for (const [name, info] of Object.entries(MODELS)) {
    // Skip English-only variants in the main list for cleaner UI
    if (name.includes('.en')) continue;

    const downloaded = isModelDownloaded(name);
    const actualSize = downloaded ? getActualModelSize(name) : null;

    result.push({
      name,
      size: actualSize || info.size,
      quality: info.quality,
      speed: info.speed,
      downloaded,
      vram: info.vram,
    });
  }

  // Sort by quality
  result.sort((a, b) => a.quality - b.quality);

  return result;
}

/**
 * Download a Whisper model using Python.
 * This triggers the Python Whisper model download via the Python bridge.
 */
export async function downloadModel(
  modelName: string,
  onProgress?: (progress: ModelDownloadProgress) => void
): Promise<{ success: boolean; model: string; path: string }> {
  const actualModel = MODEL_ALIASES[modelName] || modelName;
  const modelInfo = MODELS[actualModel];

  if (!modelInfo) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  const pythonPath = getPythonPath();
  if (!fs.existsSync(pythonPath)) {
    throw new Error('Python environment not installed. Please run setup first.');
  }

  const modelsDir = getModelsDir();
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  // Set up environment for Python Whisper to use our cache directory
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    XDG_CACHE_HOME: modelsDir,
    WHISPER_CACHE_DIR: modelsDir,
  };

  return new Promise((resolve, reject) => {
    onProgress?.({
      status: 'downloading',
      model: actualModel,
      percent: 0,
      downloaded: '0 MB',
      total: modelInfo.size,
      remainingTime: '',
    });

    // Download model using Python
    const proc = spawn(
      pythonPath,
      ['-c', `import whisper; whisper.load_model('${actualModel}'); print('Model downloaded successfully')`],
      { env, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    let lastProgress = 0;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // Try to parse download progress from Whisper's output
      const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch && percentMatch[1]) {
        const percent = Math.min(100, parseFloat(percentMatch[1]));
        if (percent > lastProgress) {
          lastProgress = percent;
          onProgress?.({
            status: 'downloading',
            model: actualModel,
            percent: Math.round(percent),
            downloaded: '',
            total: modelInfo.size,
            remainingTime: '',
          });
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;

      // Progress info sometimes comes on stderr
      const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch && percentMatch[1]) {
        const percent = Math.min(100, parseFloat(percentMatch[1]));
        if (percent > lastProgress) {
          lastProgress = percent;
          onProgress?.({
            status: 'downloading',
            model: actualModel,
            percent: Math.round(percent),
            downloaded: '',
            total: modelInfo.size,
            remainingTime: '',
          });
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const modelPath = getModelPath(actualModel);
        resolve({
          success: true,
          model: actualModel,
          path: modelPath,
        });
      } else {
        reject(new Error(`Model download failed: ${stderr || 'Unknown error'}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Delete a downloaded model.
 */
export function deleteModel(modelName: string): { success: boolean; error?: string } {
  try {
    const modelPath = getModelPath(modelName);
    const modelsDir = getModelsDir();

    // Security check: ensure path is within models directory
    const resolvedPath = path.resolve(modelPath);
    const resolvedModelsDir = path.resolve(modelsDir);

    if (!resolvedPath.startsWith(resolvedModelsDir)) {
      return { success: false, error: 'Invalid model path' };
    }

    if (fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath);
      return { success: true };
    }
    return { success: false, error: 'Model not found' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// SYSTEM CHECKS
// ============================================================================

/** FFmpeg search paths for macOS */
const FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  'ffmpeg',
];

/**
 * Check if FFmpeg is installed and available.
 * Required for audio conversion before transcription.
 */
export async function checkFFmpeg(): Promise<boolean> {
  for (const p of FFMPEG_PATHS) {
    try {
      if (path.isAbsolute(p) && !fs.existsSync(p)) {
        continue;
      }

      const works = await new Promise<boolean>((resolve) => {
        const proc = spawn(p, ['-version']);
        const timeout = setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 5000);

        proc.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code === 0);
        });
      });

      if (works) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Check GPU availability for hardware acceleration.
 */
export function checkGpuStatus(): GpuInfo {
  return detectGpuStatus();
}
