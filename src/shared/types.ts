export interface SelectedFile {
  name: string;
  path: string;
  size?: number;
}

// Import document model types for SermonDocument
import type { DocumentState } from './documentModel';

export type WhisperModelName =
  | 'tiny'
  | 'tiny.en'
  | 'base'
  | 'base.en'
  | 'small'
  | 'small.en'
  | 'medium'
  | 'medium.en'
  | 'large-v3'
  | 'large-v3-turbo';

export type LanguageCode =
  | 'auto'
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'ar'
  | 'hi';

export type OutputFormat = 'vtt' | 'srt' | 'txt' | 'json' | 'docx' | 'pdf' | 'md';

export interface TranscriptionSettings {
  model: WhisperModelName;
  language: LanguageCode;
  processAsSermon: boolean;
}

// ============================================================================
// SERMON PROCESSING TYPES
// ============================================================================

/**
 * Result from sermon processing pipeline
 */
export interface SermonDocument {
  /** Title extracted from audio metadata */
  title?: string;
  /** Main Bible passage from audio metadata comment field */
  biblePassage?: string;
  /** Extracted scripture references */
  references: string[];
  /** Extracted keyword tags */
  tags: string[];
  /** Processed body text with paragraphs and Bible quotes */
  body: string;
  /** Raw transcript before processing */
  rawTranscript: string;
  /**
   * Structured document state (new AST-based model)
   * Contains the full document tree with stable node IDs, quote metadata,
   * interjection positions, and event log for undo/redo.
   * 
   * This field is optional for backward compatibility with older transcriptions.
   */
  documentState?: DocumentState;
  /**
   * Processing metadata with timing and statistics
   */
  processingMetadata?: {
    stageTimes: Record<string, number>;
    totalTime: number;
    quoteCount: number;
    paragraphCount: number;
    interjectionCount: number;
  };
  /**
   * Error message if AST building failed (legacy output still available)
   */
  astError?: string;
}

/**
 * Pipeline stage progress
 */
export interface PipelineStage {
  id: number;
  name: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  percent: number;
  message?: string;
}

/**
 * Pipeline stages for sermon processing
 */
export const SERMON_PIPELINE_STAGES: readonly { id: number; name: string }[] = [
  { id: 1, name: 'Transcribing audio' },
  { id: 2, name: 'Extracting metadata' },
  { id: 3, name: 'Processing Bible quotes' },
  { id: 4, name: 'Segmenting paragraphs' },
  { id: 5, name: 'Extracting tags' },
  { id: 6, name: 'Building document model' },
] as const;

export type QualityLevel = 1 | 2 | 3 | 4 | 5;

export interface ModelInfo {
  name: string;
  size: string;
  speed: string;
  quality: QualityLevel;
  downloaded: boolean;
  vram?: string;
}

export interface GpuInfo {
  available: boolean;
  type: 'metal' | 'cuda' | 'cpu';
  name: string;
}

export interface ModelDownloadProgress {
  status: 'downloading' | 'complete' | 'error';
  model: string;
  percent?: number;
  downloaded?: string;
  total?: string;
  remainingTime?: string;
  error?: string;
}

export interface TranscriptionProgress {
  percent: number;
  status: string;
}

export interface TranscriptionOptions {
  filePath: string;
  model: WhisperModelName;
  language: LanguageCode;
  outputFormat: OutputFormat;
}

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  cancelled?: boolean;
  error?: string;
}

export type QueueItemStatus = 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';

export interface QueueItem {
  id: string;
  file: SelectedFile;
  status: QueueItemStatus;
  progress: TranscriptionProgress;
  result?: TranscriptionResult;
  error?: string;
  startTime?: number;
  endTime?: number;
}

export interface HistoryItem {
  id: string;
  fileName: string;
  filePath: string;
  model: WhisperModelName;
  language: LanguageCode;
  format?: OutputFormat;
  date: string;
  duration: number;
  preview: string;
  fullText: string;
  /** Whether this was processed as a sermon */
  isSermon?: boolean;
  /** Sermon document data (if isSermon) */
  sermonDocument?: SermonDocument;
  /** HTML content from WYSIWYG editor for restoring state */
  documentHtml?: string;
}

export interface SaveFileOptions {
  defaultName: string;
  content: string;
  format: OutputFormat;
  /** HTML content from sermon editor (used instead of content for sermon exports) */
  html?: string;
  /** Whether this is a sermon document */
  isSermon?: boolean;
}

export interface SaveFileResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

export interface AppInfo {
  isDev: boolean;
  version: string;
  platform: NodeJS.Platform;
  osVersion?: string;
}

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  isTranscribing: boolean;
}

export interface LanguageOption {
  value: LanguageCode;
  label: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
] as const;

export interface OutputFormatOption {
  value: OutputFormat;
  label: string;
  ext: string;
}

export const OUTPUT_FORMATS: readonly OutputFormatOption[] = [
  { value: 'vtt', label: 'VTT Subtitles', ext: '.vtt' },
  { value: 'srt', label: 'SRT Subtitles', ext: '.srt' },
  { value: 'txt', label: 'Plain Text', ext: '.txt' },
] as const;

export const SUPPORTED_EXTENSIONS = [
  // Audio
  'mp3',
  'wav',
  'm4a',
  'flac',
  'ogg',
  'wma',
  'aac',
  'aiff',
  // Video
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wmv',
  'flv',
  'm4v',
] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export type Unsubscribe = () => void;

export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export const QUALITY_STARS: readonly string[] = [
  '★☆☆☆☆',
  '★★☆☆☆',
  '★★★☆☆',
  '★★★★☆',
  '★★★★★',
] as const;

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: UpdateProgress;
  error?: string;
}
