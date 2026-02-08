/**
 * Python Environment Installer Service
 *
 * Manages downloading and installing an embedded Python environment
 * with all required dependencies for WhisperSermons sermon processing.
 *
 * Uses python-build-standalone for a self-contained Python distribution.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { extract } from 'tar';

// ============================================================================
// CONFIGURATION
// ============================================================================

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Python-build-standalone release info
// Using Python 3.11 for best compatibility with ML libraries
const PYTHON_VERSION = '3.11.9';
const PYTHON_BUILD_DATE = '20240814';

// Platform-specific download URLs
const getPythonDownloadUrl = (): string => {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const platform = process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu';
  return `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-${arch}-${platform}-install_only.tar.gz`;
};

// Installation directories
const getInstallDir = (): string => {
  if (isDev) {
    return path.join(process.cwd(), 'python-env');
  }
  return path.join(app.getPath('userData'), 'python-env');
};

const getPythonPath = (): string => {
  const installDir = getInstallDir();
  return path.join(installDir, 'python', 'bin', 'python3');
};

const getPipPath = (): string => {
  const installDir = getInstallDir();
  return path.join(installDir, 'python', 'bin', 'pip3');
};

const getWhisperCacheDir = (): string => {
  if (isDev) {
    return path.join(process.cwd(), 'models');
  }
  return path.join(app.getPath('userData'), 'models');
};



const getPythonScriptsDir = (): string => {
  if (isDev) {
    return path.join(process.cwd(), 'src', 'python');
  }
  // In production, Python scripts are bundled in resources
  return path.join(process.resourcesPath, 'python');
};

// ============================================================================
// TYPES
// ============================================================================

export interface InstallProgress {
  stage: 'python' | 'packages' | 'models' | 'complete';
  stageName: string;
  percent: number;
  message: string;
  error?: string;
}

export interface PythonStatus {
  installed: boolean;
  pythonPath?: string;
  pythonVersion?: string;
  packagesInstalled: boolean;
  modelsDownloaded: boolean;
  device?: 'mlx' | 'cpu';
}

type ProgressCallback = (progress: InstallProgress) => void;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Download a file with progress reporting
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number, downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);

    https
      .get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(destPath);
            downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (onProgress && totalSize > 0) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            onProgress(percent, downloadedSize, totalSize);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlinkSync(destPath);
        reject(err);
      });
  });
}

/**
 * Extract a tar.gz archive
 */
async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  await pipeline(fs.createReadStream(archivePath), createGunzip(), extract({ cwd: destDir }));
}

/**
 * Run a command and return output
 */
function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

// ============================================================================
// INSTALLATION FUNCTIONS
// ============================================================================

/**
 * Check if Python environment is fully installed
 */
export async function checkPythonStatus(): Promise<PythonStatus> {
  const status: PythonStatus = {
    installed: false,
    packagesInstalled: false,
    modelsDownloaded: false,
  };

  const pythonPath = getPythonPath();

  // Check Python installation
  if (existsSync(pythonPath)) {
    status.installed = true;
    status.pythonPath = pythonPath;

    try {
      const version = await runCommand(pythonPath, ['--version']);
      status.pythonVersion = version.trim();
    } catch {
      // Python exists but can't run
      status.installed = false;
    }
  }

  // Check packages
  if (status.installed) {
    try {
      await runCommand(pythonPath, ['-c', 'import mlx_whisper; import mlx_embeddings']);
      status.packagesInstalled = true;
    } catch {
      status.packagesInstalled = false;
    }
  }

  // Check device — always MLX on Apple Silicon (the only supported platform)
  if (status.packagesInstalled) {
    try {
      await runCommand(pythonPath, ['-c', 'import mlx.core']);
      status.device = 'mlx';
    } catch {
      status.device = 'cpu';
    }
  }

  // Check Whisper models (MLX format in HuggingFace Hub cache)
  const modelsDir = getWhisperCacheDir();
  const hfCacheDir = path.join(modelsDir, 'huggingface', 'hub');
  status.modelsDownloaded = existsSync(hfCacheDir) && 
    fs.readdirSync(hfCacheDir).some(dir => dir.startsWith('models--mlx-community--whisper'));

  return status;
}

/**
 * Install Python environment
 */
export async function installPython(onProgress: ProgressCallback): Promise<void> {
  const installDir = getInstallDir();
  const downloadPath = path.join(installDir, 'python.tar.gz');
  const pythonUrl = getPythonDownloadUrl();

  onProgress({
    stage: 'python',
    stageName: 'Downloading Python',
    percent: 0,
    message: 'Starting download...',
  });

  // Create install directory
  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true });
  }

  // Download Python
  await downloadFile(pythonUrl, downloadPath, (percent) => {
    onProgress({
      stage: 'python',
      stageName: 'Downloading Python',
      percent: Math.round(percent * 0.7), // Download is 70% of this stage
      message: `Downloading Python ${PYTHON_VERSION}...`,
    });
  });

  onProgress({
    stage: 'python',
    stageName: 'Extracting Python',
    percent: 70,
    message: 'Extracting archive...',
  });

  // Extract
  await extractTarGz(downloadPath, installDir);

  // Cleanup download
  fs.unlinkSync(downloadPath);

  onProgress({
    stage: 'python',
    stageName: 'Python installed',
    percent: 100,
    message: 'Python installation complete',
  });
}

/**
 * Install Python packages
 */
export async function installPackages(onProgress: ProgressCallback): Promise<void> {
  const pythonPath = getPythonPath();
  const pipPath = getPipPath();
  const requirementsPath = path.join(getPythonScriptsDir(), 'requirements.txt');

  onProgress({
    stage: 'packages',
    stageName: 'Installing packages',
    percent: 0,
    message: 'Upgrading pip...',
  });

  try {
    // Upgrade pip first
    await runCommand(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip']);

    onProgress({
      stage: 'packages',
      stageName: 'Installing packages',
      percent: 10,
      message: 'Installing MLX and mlx-whisper...',
    });

    // Install mlx-whisper first (includes mlx as dependency)
    await runCommand(pipPath, ['install', 'mlx-whisper']);
    
    // Verify mlx-whisper installation
    await runCommand(pythonPath, ['-c', 'import mlx_whisper']);

    onProgress({
      stage: 'packages',
      stageName: 'Installing packages',
      percent: 40,
      message: 'Installing mlx-embeddings for semantic analysis...',
    });

    // Install remaining packages from requirements
    // (includes mlx-embeddings for paragraph segmentation & tag extraction)
    await runCommand(pipPath, ['install', '-r', requirementsPath]);
    
    // Verify critical packages
    await runCommand(pythonPath, ['-c', 'import mlx_whisper; import mlx_embeddings']);

    onProgress({
      stage: 'packages',
      stageName: 'Installing packages',
      percent: 70,
      message: 'Pre-downloading embedding model...',
    });

    // Pre-download EmbeddingGemma-300m-4bit model to avoid delay on first transcription
    const hfHome = path.join(getWhisperCacheDir(), 'huggingface');
    await runCommand(pythonPath, [
      '-c',
      `import os; os.environ['HF_HOME'] = '${hfHome.replace(/\\/g, '/')}'; from mlx_embeddings.utils import load; load('mlx-community/embeddinggemma-300m-4bit')`,
    ]);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Package installation failed: ${errorMsg}`);
  }

  onProgress({
    stage: 'packages',
    stageName: 'Packages installed',
    percent: 100,
    message: 'All packages installed',
  });
}

/**
 * Download default Whisper model (MLX format from HuggingFace Hub)
 */
export async function downloadWhisperModel(
  modelName: string = 'base',
  onProgress: ProgressCallback
): Promise<void> {
  const pythonPath = getPythonPath();
  const modelsDir = getWhisperCacheDir();

  if (!existsSync(modelsDir)) {
    mkdirSync(modelsDir, { recursive: true });
  }

  // Map model names to HuggingFace repo IDs
  const modelRepoMap: Record<string, string> = {
    tiny: 'mlx-community/whisper-tiny',
    base: 'mlx-community/whisper-base-mlx',
    small: 'mlx-community/whisper-small-mlx',
    medium: 'mlx-community/whisper-medium-mlx',
    'large-v3': 'mlx-community/whisper-large-v3-mlx',
    'large-v3-turbo': 'mlx-community/whisper-large-v3-turbo',
  };

  const hfRepo = modelRepoMap[modelName] || `mlx-community/whisper-${modelName}`;

  onProgress({
    stage: 'models',
    stageName: 'Downloading Whisper model',
    percent: 0,
    message: `Downloading ${modelName} model (MLX format)...`,
  });

  const hfHome = path.join(modelsDir, 'huggingface');

  // Use huggingface_hub to download the model
  await runCommand(pythonPath, [
    '-c',
    `
import os
os.environ['HF_HOME'] = '${hfHome.replace(/\\/g, '/')}'
from huggingface_hub import snapshot_download
snapshot_download('${hfRepo}')
print('Model downloaded successfully')
`,
  ]);

  onProgress({
    stage: 'models',
    stageName: 'Model downloaded',
    percent: 100,
    message: `${modelName} model ready`,
  });
}

/**
 * Full installation process
 */
export async function installAll(onProgress: ProgressCallback): Promise<void> {
  const status = await checkPythonStatus();

  // Step 1: Install Python if needed
  if (!status.installed) {
    await installPython(onProgress);
  }

  // Step 2: Install packages if needed
  if (!status.packagesInstalled) {
    await installPackages(onProgress);
  }

  // Step 3: Download default model if needed
  if (!status.modelsDownloaded) {
    await downloadWhisperModel('base', onProgress);
  }

  onProgress({
    stage: 'complete',
    stageName: 'Setup complete',
    percent: 100,
    message: 'WhisperSermons is ready to use!',
  });
}

// ============================================================================
// EXPORTS FOR IPC
// ============================================================================

export { getInstallDir, getPythonPath, getPipPath, getWhisperCacheDir, getPythonScriptsDir };
