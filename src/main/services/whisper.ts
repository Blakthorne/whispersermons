/**
 * Whisper Service - Model Management and Utilities
 *
 * This module provides model management for mlx-whisper.
 * Transcription is handled by python-whisper.ts.
 * Models are MLX-format models from HuggingFace Hub (mlx-community).
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
 * MLX Whisper model information.
 * Models are MLX-format models from HuggingFace Hub (mlx-community).
 * They are automatically downloaded and cached by huggingface_hub.
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
  /** HuggingFace repo ID for mlx-community model */
  hfRepo: string;
}

/**
 * Available MLX Whisper models with their characteristics.
 * These are pre-converted MLX format models from mlx-community on HuggingFace.
 */
export const MODELS: Record<string, WhisperModelInfo> = {
  tiny: {
    size: '~75 MB',
    quality: 1,
    speed: '~10x',
    vram: '~1 GB',
    hfRepo: 'mlx-community/whisper-tiny',
  },
  'tiny.en': {
    size: '~75 MB',
    quality: 1,
    speed: '~10x',
    vram: '~1 GB',
    hfRepo: 'mlx-community/whisper-tiny.en-mlx',
  },
  base: {
    size: '~140 MB',
    quality: 2,
    speed: '~7x',
    vram: '~1 GB',
    hfRepo: 'mlx-community/whisper-base-mlx',
  },
  'base.en': {
    size: '~140 MB',
    quality: 2,
    speed: '~7x',
    vram: '~1 GB',
    hfRepo: 'mlx-community/whisper-base.en-mlx',
  },
  small: {
    size: '~460 MB',
    quality: 3,
    speed: '~4x',
    vram: '~2 GB',
    hfRepo: 'mlx-community/whisper-small-mlx',
  },
  'small.en': {
    size: '~460 MB',
    quality: 3,
    speed: '~4x',
    vram: '~2 GB',
    hfRepo: 'mlx-community/whisper-small.en-mlx',
  },
  medium: {
    size: '~1.5 GB',
    quality: 4,
    speed: '~2x',
    vram: '~5 GB',
    hfRepo: 'mlx-community/whisper-medium-mlx',
  },
  'medium.en': {
    size: '~1.5 GB',
    quality: 4,
    speed: '~2x',
    vram: '~5 GB',
    hfRepo: 'mlx-community/whisper-medium-mlx',
  },
  'large-v3': {
    size: '~3.1 GB',
    quality: 5,
    speed: '~1x',
    vram: '~10 GB',
    hfRepo: 'mlx-community/whisper-large-v3-mlx',
  },
  'large-v3-turbo': {
    size: '~1.6 GB',
    quality: 5,
    speed: '~2x',
    vram: '~6 GB',
    hfRepo: 'mlx-community/whisper-large-v3-turbo',
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
 * Get the directory where models are cached.
 * MLX models are cached via HuggingFace Hub in the HF_HOME directory.
 */
export function getModelsDir(): string {
  return getWhisperCacheDir();
}

/**
 * Get the HuggingFace Hub cache directory for a specific model.
 * HuggingFace Hub stores models in: HF_HOME/hub/models--org--repo/
 */
function getHfModelCacheDir(modelName: string): string {
  const actualModel = MODEL_ALIASES[modelName] || modelName;
  const modelInfo = MODELS[actualModel];
  if (!modelInfo) return '';

  const hfHome = path.join(getModelsDir(), 'huggingface');
  // HuggingFace Hub uses 'models--org--repo' format for cache directories
  const repoParts = modelInfo.hfRepo.replace('/', '--');
  return path.join(hfHome, 'hub', `models--${repoParts}`);
}

/**
 * Check if a model has been downloaded.
 * Checks the HuggingFace Hub cache directory for the model.
 */
export function isModelDownloaded(modelName: string): boolean {
  try {
    const cacheDir = getHfModelCacheDir(modelName);
    if (!cacheDir) return false;
    // Check if the cache directory exists and has snapshot content
    if (!fs.existsSync(cacheDir)) return false;
    const snapshotsDir = path.join(cacheDir, 'snapshots');
    if (!fs.existsSync(snapshotsDir)) return false;
    // Check if there's at least one snapshot
    const snapshots = fs.readdirSync(snapshotsDir);
    return snapshots.length > 0;
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
 * Get actual total size of a downloaded model from the HF Hub cache.
 */
function getActualModelSize(modelName: string): string | null {
  try {
    const cacheDir = getHfModelCacheDir(modelName);
    if (!cacheDir || !fs.existsSync(cacheDir)) return null;

    // Calculate total size of all files in the cache directory
    let totalSize = 0;
    const walkDir = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile()) {
            totalSize += fs.statSync(fullPath).size;
          }
        }
      } catch {
        // Ignore permission errors
      }
    };
    walkDir(cacheDir);
    return totalSize > 0 ? formatFileSize(totalSize) : null;
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
 * Download a Whisper model using mlx-whisper (from HuggingFace Hub).
 * This triggers the model download via the Python bridge.
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

  // Set up environment for mlx-whisper to use our cache directory
  const hfHome = path.join(modelsDir, 'huggingface');
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    HF_HOME: hfHome,
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

    // Download model using huggingface_hub - downloads MLX model files from HuggingFace
    const hfRepo = modelInfo.hfRepo;
    const proc = spawn(
      pythonPath,
      [
        '-c',
        `from huggingface_hub import snapshot_download; snapshot_download('${hfRepo}'); print('Model downloaded successfully')`,
      ],
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
        const cacheDir = getHfModelCacheDir(actualModel);
        resolve({
          success: true,
          model: actualModel,
          path: cacheDir,
        });
      } else {
        reject(new Error(`Model download failed: ${stderr || 'Unknown error'}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Delete a downloaded model from the HuggingFace Hub cache.
 */
export function deleteModel(modelName: string): { success: boolean; error?: string } {
  try {
    const cacheDir = getHfModelCacheDir(modelName);
    const modelsDir = getModelsDir();

    if (!cacheDir) {
      return { success: false, error: 'Unknown model' };
    }

    // Security check: ensure path is within models directory
    const resolvedPath = path.resolve(cacheDir);
    const resolvedModelsDir = path.resolve(modelsDir);

    if (!resolvedPath.startsWith(resolvedModelsDir)) {
      return { success: false, error: 'Invalid model path' };
    }

    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
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
