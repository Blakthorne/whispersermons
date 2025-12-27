import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  TranscriptionOptions,
  SaveFileOptions,
  ModelDownloadProgress,
  TranscriptionProgress,
  UpdateStatus,
  PipelineStage,
} from '../shared/types';

// Extended options for Python transcription with sermon processing
interface ExtendedTranscriptionOptions extends TranscriptionOptions {
  processAsSermon?: boolean;
}

// Python environment status
interface PythonStatus {
  installed: boolean;
  packagesInstalled: boolean;
  modelsDownloaded: boolean;
  error?: string;
}

// Python installation progress
interface PythonInstallProgress {
  stage: 'python' | 'packages' | 'models';
  progress: number;
  message: string;
}

// Pipeline progress for sermon processing
interface PipelineProgress {
  currentStage: PipelineStage;
  overallProgress: number;
  stageProgress: number;
  message: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openMultipleFiles: () => ipcRenderer.invoke('dialog:openMultipleFiles'),
  saveFile: (options: SaveFileOptions) => ipcRenderer.invoke('dialog:saveFile', options),

  getFileInfo: (filePath: string) => ipcRenderer.invoke('file:getInfo', filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  listModels: () => ipcRenderer.invoke('models:list'),
  getGpuStatus: () => ipcRenderer.invoke('models:gpuStatus'),
  checkFFmpeg: () => ipcRenderer.invoke('system:checkFFmpeg'),
  downloadModel: (modelName: string) => ipcRenderer.invoke('models:download', modelName),
  deleteModel: (modelName: string) => ipcRenderer.invoke('models:delete', modelName),
  onModelDownloadProgress: (callback: (data: ModelDownloadProgress) => void) => {
    ipcRenderer.on('models:downloadProgress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('models:downloadProgress');
  },

  startTranscription: (options: TranscriptionOptions) =>
    ipcRenderer.invoke('transcribe:start', options),
  cancelTranscription: () => ipcRenderer.invoke('transcribe:cancel'),
  onTranscriptionProgress: (callback: (data: TranscriptionProgress) => void) => {
    ipcRenderer.on('transcribe:progress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('transcribe:progress');
  },

  // Python-based transcription with optional sermon processing
  startPythonTranscription: (options: ExtendedTranscriptionOptions) =>
    ipcRenderer.invoke('transcribe:startPython', options),
  cancelPythonTranscription: () => ipcRenderer.invoke('transcribe:cancelPython'),
  onPipelineProgress: (callback: (data: PipelineProgress) => void) => {
    ipcRenderer.on('transcribe:pipelineProgress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('transcribe:pipelineProgress');
  },

  // Python environment management
  checkPythonStatus: (): Promise<PythonStatus> => ipcRenderer.invoke('python:checkStatus'),
  installPython: () => ipcRenderer.invoke('python:install'),
  downloadPythonModel: (modelName: string) => ipcRenderer.invoke('python:downloadModel', modelName),
  checkPythonDependencies: () => ipcRenderer.invoke('python:checkDependencies'),
  onPythonInstallProgress: (callback: (data: PythonInstallProgress) => void) => {
    ipcRenderer.on('python:installProgress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('python:installProgress');
  },
  onPythonModelProgress: (callback: (data: { progress: number; message: string }) => void) => {
    ipcRenderer.on('python:modelProgress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('python:modelProgress');
  },

  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getMemoryUsage: () => ipcRenderer.invoke('app:getMemoryUsage'),
  trackEvent: (eventName: string, properties?: Record<string, string | number | boolean>) =>
    ipcRenderer.invoke('analytics:track', eventName, properties),

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  onMenuOpenFile: (callback: () => void) => {
    ipcRenderer.on('menu:openFile', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:openFile');
  },
  onMenuSaveFile: (callback: () => void) => {
    ipcRenderer.on('menu:saveFile', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:saveFile');
  },
  onMenuCopyTranscription: (callback: () => void) => {
    ipcRenderer.on('menu:copyTranscription', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:copyTranscription');
  },
  onMenuStartTranscription: (callback: () => void) => {
    ipcRenderer.on('menu:startTranscription', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:startTranscription');
  },
  onMenuCancelTranscription: (callback: () => void) => {
    ipcRenderer.on('menu:cancelTranscription', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:cancelTranscription');
  },
  onMenuToggleHistory: (callback: () => void) => {
    ipcRenderer.on('menu:toggleHistory', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:toggleHistory');
  },

  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback: (data: UpdateStatus) => void) => {
    ipcRenderer.on('update:status', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('update:status');
  },
});
