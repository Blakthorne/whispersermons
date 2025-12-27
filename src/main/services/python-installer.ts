/**
 * Python Environment Installer Service
 *
 * Manages downloading and installing an embedded Python environment
 * with all required dependencies for WhisperDesk sermon processing.
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
// @ts-expect-error - tar package doesn't have type declarations
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
  device?: 'mps' | 'cuda' | 'cpu';
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
      await runCommand(pythonPath, ['-c', 'import whisper; import sentence_transformers; import keybert']);
      status.packagesInstalled = true;
    } catch {
      status.packagesInstalled = false;
    }
  }

  // Check device (MPS/CUDA/CPU)
  if (status.packagesInstalled) {
    try {
      const deviceCheck = await runCommand(pythonPath, [
        '-c',
        'import torch; print("mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu"))',
      ]);
      status.device = deviceCheck.trim() as 'mps' | 'cuda' | 'cpu';
    } catch {
      status.device = 'cpu';
    }
  }

  // Check Whisper models
  const modelsDir = getWhisperCacheDir();
  const modelFiles = ['base.pt', 'medium.pt'];
  status.modelsDownloaded = modelFiles.some((f) => existsSync(path.join(modelsDir, f)));

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

  // Upgrade pip first
  await runCommand(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip']);

  onProgress({
    stage: 'packages',
    stageName: 'Installing packages',
    percent: 10,
    message: 'Installing PyTorch...',
  });

  // Install PyTorch first (large download)
  await runCommand(pipPath, ['install', 'torch', 'torchvision', 'torchaudio']);

  onProgress({
    stage: 'packages',
    stageName: 'Installing packages',
    percent: 50,
    message: 'Installing Whisper and ML packages...',
  });

  // Install from requirements
  await runCommand(pipPath, ['install', '-r', requirementsPath]);

  onProgress({
    stage: 'packages',
    stageName: 'Installing packages',
    percent: 90,
    message: 'Downloading NLTK data...',
  });

  // Download NLTK data
  await runCommand(pythonPath, [
    '-c',
    "import nltk; nltk.download('averaged_perceptron_tagger_eng', quiet=True); nltk.download('punkt_tab', quiet=True)",
  ]);

  onProgress({
    stage: 'packages',
    stageName: 'Packages installed',
    percent: 100,
    message: 'All packages installed',
  });
}

/**
 * Download default Whisper model
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

  onProgress({
    stage: 'models',
    stageName: 'Downloading Whisper model',
    percent: 0,
    message: `Downloading ${modelName} model...`,
  });

  // Use Whisper's download function
  await runCommand(pythonPath, [
    '-c',
    `
import os
os.environ['XDG_CACHE_HOME'] = '${modelsDir.replace(/\\/g, '/')}'
import whisper
whisper.load_model('${modelName}')
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
    message: 'WhisperDesk is ready to use!',
  });
}

// ============================================================================
// EXPORTS FOR IPC
// ============================================================================

export { getInstallDir, getPythonPath, getPipPath, getWhisperCacheDir, getPythonScriptsDir };
