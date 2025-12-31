import type {
  HistoryItem,
  SelectedFile,
  TranscriptionSettings,
  OutputFormat,
  QueueItem,
  SermonDocument,
} from '../types';
import type { Theme } from '../hooks';
import type { PipelineProgress } from '../services/electronAPI';

/** Document save state for UI indicators */
export type DocumentSaveState = 'saved' | 'unsaved' | 'saving';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

export interface HistoryContextValue {
  history: HistoryItem[];
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  toggleHistory: () => void;
  clearHistory: () => void;
  removeHistoryItem: (itemId: string) => void;
  selectHistoryItem: (item: HistoryItem) => void;
  updateHistoryItem: (itemId: string, updates: Partial<HistoryItem>) => void;
  /** ID of the currently selected history item (if viewing from history) */
  currentHistoryItemId: string | null;
}

export interface TranscriptionStateContextValue {
  selectedFile: SelectedFile | null;
  settings: TranscriptionSettings;
  isTranscribing: boolean;
  transcription: string;
  error: string | null;
  modelDownloaded: boolean;
  copySuccess: boolean;
  queue: QueueItem[];
  selectedQueueItemId: string | null;
  /** Sermon document from sermon processing pipeline */
  sermonDocument: SermonDocument | null;
  /** HTML content from WYSIWYG editor (for persistence) */
  documentHtml: string | null;
  /** Pipeline progress for sermon processing */
  pipelineProgress: PipelineProgress | null;
  /** Current save state of the document */
  documentSaveState: DocumentSaveState;
  /** Timestamp of last successful save */
  lastSavedAt: Date | null;
  /** Whether the app is running in development mode */
  isDev: boolean;
  /** The ID of the node currently visible at the top of the viewport (for scroll sync) */
  visibleNodeId: string | null;
}

export interface TranscriptionActionsContextValue {
  setSelectedFile: (file: SelectedFile | null) => void;
  setSettings: (settings: TranscriptionSettings) => void;
  setModelDownloaded: (downloaded: boolean) => void;
  handleTranscribe: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleSave: (format?: OutputFormat) => Promise<void>;
  handleCopy: () => Promise<void>;
  handleFilesSelect: (files: SelectedFile[]) => void;
  removeFromQueue: (id: string) => void;
  clearCompletedFromQueue: () => void;
  selectQueueItem: (id: string) => void;
  /** Set sermon document from processing pipeline */
  setSermonDocument: (doc: SermonDocument | null) => void;
  /** Update HTML content from editor */
  setDocumentHtml: (html: string | null) => void;
  /** Save current editor edits to history */
  saveEdits: () => void;
  /** Set the ID of the currently visible node (for scroll sync) */
  setVisibleNodeId: (nodeId: string | null) => void;
}

export interface TranscriptionContextValue
  extends TranscriptionStateContextValue, TranscriptionActionsContextValue { }
