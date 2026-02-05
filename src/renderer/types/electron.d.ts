import type {
  TranscriptionProgress,
  TranscriptionOptions,
  TranscriptionResult,
  ModelDownloadProgress,
  SaveFileOptions,
  SaveFileResult,
  GpuInfo,
  ModelInfo,
  SelectedFile,
  AppInfo,
  MemoryUsage,
  Unsubscribe,
  UpdateStatus,
  PipelineStage,
  SermonDocument,
} from './index';

export interface ModelsListResponse {
  models: ModelInfo[];
}

export interface CancelResult {
  success: boolean;
  message?: string;
}

export interface WhisperCheckResult {
  available: boolean;
  whisperPath?: string;
  backend?: string;
  gpu?: GpuInfo;
  error?: string;
}

// Python environment types
export interface PythonStatus {
  installed: boolean;
  packagesInstalled: boolean;
  modelsDownloaded: boolean;
  error?: string;
}

export interface PythonInstallProgress {
  stage: 'python' | 'packages' | 'models' | 'complete';
  progress: number;
  message: string;
}

export interface PipelineProgress {
  currentStage: PipelineStage;
  overallProgress: number;
  stageProgress: number;
  message: string;
}

import type { WhisperAdvancedSettings } from '../features/preferences/types';

export interface ExtendedTranscriptionOptions extends TranscriptionOptions {
  testMode?: boolean;
  advancedSettings?: WhisperAdvancedSettings;
}

/**
 * Result from Python transcription pipeline.
 * 
 * AST-ONLY ARCHITECTURE: The sermonDocument.documentState contains the AST
 * which is the single source of truth. HTML is generated on-demand when needed.
 */
export interface SermonTranscriptionResult extends TranscriptionResult {
  sermonDocument?: SermonDocument;
}

export interface ElectronAPI {
  openFile: () => Promise<string | null>;
  openMultipleFiles: () => Promise<string[] | null>;
  saveFile: (options: SaveFileOptions) => Promise<SaveFileResult>;
  getFileInfo: (filePath: string) => Promise<SelectedFile | null>;
  getPathForFile: (file: File) => string;
  listModels: () => Promise<ModelsListResponse>;
  deleteModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
  getGpuStatus: () => Promise<GpuInfo>;
  checkFFmpeg: () => Promise<boolean>;
  downloadModel: (modelName: string) => Promise<{ success: boolean; model: string; path: string }>;
  onModelDownloadProgress: (callback: (data: ModelDownloadProgress) => void) => Unsubscribe;
  startTranscription: (options: TranscriptionOptions) => Promise<SermonTranscriptionResult>;
  cancelTranscription: () => Promise<CancelResult>;
  onTranscriptionProgress: (callback: (data: TranscriptionProgress) => void) => Unsubscribe;

  // Python-based transcription with optional sermon processing
  startPythonTranscription: (
    options: ExtendedTranscriptionOptions
  ) => Promise<SermonTranscriptionResult>;
  cancelPythonTranscription: () => Promise<CancelResult>;
  onPipelineProgress: (callback: (data: PipelineProgress) => void) => Unsubscribe;

  // Python environment management
  checkPythonStatus: () => Promise<PythonStatus>;
  installPython: () => Promise<{ success: boolean; error?: string }>;
  downloadPythonModel: (
    modelName: string
  ) => Promise<{ success: boolean; model: string; error?: string }>;
  checkPythonDependencies: () => Promise<{ available: boolean; missing: string[] }>;
  onPythonInstallProgress: (callback: (data: PythonInstallProgress) => void) => Unsubscribe;
  onPythonModelProgress: (
    callback: (data: { progress: number; message: string }) => void
  ) => Unsubscribe;

  getAppInfo: () => Promise<AppInfo>;
  getMemoryUsage: () => Promise<MemoryUsage>;
  trackEvent: (
    eventName: string,
    properties?: Record<string, string | number | boolean>
  ) => Promise<void>;
  onDevToolsStateChanged: (callback: (isOpen: boolean) => void) => Unsubscribe;
  openExternal: (url: string) => Promise<void>;
  onMenuOpenFile: (callback: () => void) => Unsubscribe;
  onMenuSaveFile: (callback: () => void) => Unsubscribe;
  onMenuCopyTranscription: (callback: () => void) => Unsubscribe;
  onMenuStartTranscription: (callback: () => void) => Unsubscribe;
  onMenuCancelTranscription: (callback: () => void) => Unsubscribe;
  onMenuToggleHistory: (callback: () => void) => Unsubscribe;
  onMenuOpenPreferences: (callback: () => void) => Unsubscribe;
  checkForUpdates: () => Promise<{ success: boolean; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => void;
  onUpdateStatus: (callback: (data: UpdateStatus) => void) => Unsubscribe;

  // Bible API
  getBibleBookNames: () => Promise<BibleBookInfo[]>;
  lookupBibleVerse: (reference: string, translation?: string) => Promise<BibleLookupResult>;
}

// Bible API types
export interface BibleBookInfo {
  name: string;
  abbreviations: string[];
}

export interface BibleLookupResult {
  success: boolean;
  verseText?: string;
  normalizedReference?: string;
  book?: string;
  chapter?: number;
  verseStart?: number | null;
  verseEnd?: number | null;
  translation?: string;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export { };
