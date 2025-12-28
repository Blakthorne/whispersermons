/**
 * Document History Module
 *
 * Phase D: Provides integration between DocumentState and the
 * existing history service.
 */

export {
  // Types
  type HistoryItemWithState,
  type SaveToHistoryOptions,
  type RestoreFromHistoryResult,
  // Save utilities
  createHistoryItemWithState,
  updateHistoryItemState,
  // Restore utilities
  restoreFromHistoryItem,
  hasDocumentState,
  hasNewFormatState,
  // Migration
  migrateHistoryItem,
  // Storage utilities
  estimateStorageSize,
  pruneEventLog,
  eventLogSize,
} from './documentHistory';
