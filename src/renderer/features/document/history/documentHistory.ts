/**
 * Document History Integration
 *
 * Phase D: Integrates DocumentState persistence with the existing
 * history service. Provides utilities for:
 *
 * - Saving document state with history items
 * - Restoring document state from history
 * - Migrating legacy history items to new format
 */

import type { DocumentState } from '../../../../shared/documentModel';
import type { HistoryItem } from '../../../../shared/types';
import {
  compactSerialize,
  compactDeserialize,
} from '../serialization';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended history item with serialized document state.
 */
export interface HistoryItemWithState extends HistoryItem {
  /** Serialized document state (compact format) */
  documentStateJson?: string;
}

/**
 * Options for saving to history.
 */
export interface SaveToHistoryOptions {
  /** Whether to include event log (default: true) */
  includeEventLog?: boolean;
  /** Maximum events to store (default: 100) */
  maxEvents?: number;
}

/**
 * Result from restoring history.
 */
export interface RestoreFromHistoryResult {
  success: boolean;
  state?: DocumentState;
  error?: string;
  /** Whether the history item uses legacy format (no documentState) */
  isLegacy?: boolean;
  /** HTML content for legacy items */
  legacyHtml?: string;
}

// ============================================================================
// SAVE TO HISTORY
// ============================================================================

/**
 * Create history item data with serialized document state.
 */
export function createHistoryItemWithState(
  baseItem: Omit<HistoryItem, 'id'>,
  documentState: DocumentState | null,
  options: SaveToHistoryOptions = {}
): Omit<HistoryItemWithState, 'id'> {
  const { includeEventLog = true, maxEvents = 100 } = options;

  let documentStateJson: string | undefined;

  if (documentState) {
    documentStateJson = compactSerialize(documentState, {
      includeEventLog,
      maxEvents,
    });
  }

  return {
    ...baseItem,
    documentStateJson,
  };
}

/**
 * Update an existing history item with new document state.
 */
export function updateHistoryItemState(
  item: HistoryItem,
  documentState: DocumentState,
  options: SaveToHistoryOptions = {}
): HistoryItemWithState {
  const { includeEventLog = true, maxEvents = 100 } = options;

  const documentStateJson = compactSerialize(documentState, {
    includeEventLog,
    maxEvents,
  });

  return {
    ...item,
    documentStateJson,
    // Also update the HTML for backward compatibility
    documentHtml: undefined, // Will be generated on demand
  };
}

// ============================================================================
// RESTORE FROM HISTORY
// ============================================================================

/**
 * Restore document state from a history item.
 */
export function restoreFromHistoryItem(
  item: HistoryItem | HistoryItemWithState
): RestoreFromHistoryResult {
  // Check for new format first (serialized DocumentState)
  const extendedItem = item as HistoryItemWithState;
  if (extendedItem.documentStateJson) {
    const result = compactDeserialize(extendedItem.documentStateJson);
    if (result.success && result.state) {
      return {
        success: true,
        state: result.state,
        isLegacy: false,
      };
    }
    return {
      success: false,
      error: result.error || 'Failed to deserialize document state',
      isLegacy: false,
    };
  }

  // Check for documentState in sermonDocument (from Python pipeline)
  if (item.sermonDocument?.documentState) {
    return {
      success: true,
      state: item.sermonDocument.documentState,
      isLegacy: false,
    };
  }

  // Fall back to legacy HTML format
  if (item.documentHtml) {
    return {
      success: true,
      isLegacy: true,
      legacyHtml: item.documentHtml,
    };
  }

  // No document data available
  return {
    success: false,
    error: 'No document state or HTML available in history item',
    isLegacy: true,
  };
}

/**
 * Check if a history item has document state.
 */
export function hasDocumentState(item: HistoryItem | HistoryItemWithState): boolean {
  const extendedItem = item as HistoryItemWithState;
  return !!(
    extendedItem.documentStateJson ||
    item.sermonDocument?.documentState ||
    item.documentHtml
  );
}

/**
 * Check if a history item uses the new format (DocumentState).
 */
export function hasNewFormatState(item: HistoryItem | HistoryItemWithState): boolean {
  const extendedItem = item as HistoryItemWithState;
  return !!(extendedItem.documentStateJson || item.sermonDocument?.documentState);
}

// ============================================================================
// MIGRATION
// ============================================================================

/**
 * Migrate a legacy history item to use DocumentState.
 * Note: This requires converting HTML to AST, which may lose some formatting.
 */
export function migrateHistoryItem(
  item: HistoryItem,
  convertHtmlToState: (html: string) => DocumentState | null
): HistoryItemWithState | null {
  // Already has new format
  if (hasNewFormatState(item)) {
    return item as HistoryItemWithState;
  }

  // Try to convert from HTML
  if (item.documentHtml) {
    const state = convertHtmlToState(item.documentHtml);
    if (state) {
      return updateHistoryItemState(item, state);
    }
  }

  // Cannot migrate
  return null;
}

// ============================================================================
// STORAGE SIZE UTILITIES
// ============================================================================

/**
 * Estimate the storage size of a history item in bytes.
 */
export function estimateStorageSize(item: HistoryItemWithState): number {
  const json = JSON.stringify(item);
  // UTF-16 encoding: 2 bytes per character
  return json.length * 2;
}

/**
 * Prune event log to fit within storage constraints.
 */
export function pruneEventLog(
  documentState: DocumentState,
  maxEvents: number
): DocumentState {
  if (documentState.eventLog.length <= maxEvents) {
    return documentState;
  }

  return {
    ...documentState,
    eventLog: documentState.eventLog.slice(-maxEvents),
    // Clear undo/redo since events were pruned
    undoStack: [],
    redoStack: [],
  };
}

/**
 * Calculate the storage size of the event log.
 */
export function eventLogSize(eventLog: DocumentState['eventLog']): number {
  const json = JSON.stringify(eventLog);
  return json.length * 2;
}
