/**
 * Document Feature - Hybrid AST + Event Log Architecture
 *
 * This module provides the client-side infrastructure for rendering
 * and consuming structured document state from the Python processing pipeline.
 *
 * Phase B (Read Path) exports:
 * - DocumentManager: State management class
 * - DocumentContext/Provider: React context for document state
 * - Hooks: useDocument, useQuotes, useNode for consuming state
 * - Components: Renderer components for displaying the AST
 *
 * Phase C (Write Path) exports:
 * - Event Factory: Functions to create document events
 * - Document Reducer: Pure function for applying events to state
 * - DocumentMutator: High-level mutation API with undo/redo
 * - Mutation Hooks: useDocumentMutations, useUndoRedo
 *
 * Phase D (Editor Integration) exports:
 * - Serialization: State persistence utilities
 * - TipTap Bridge: AST <-> TipTap JSON conversion
 * - History Integration: Save/restore with history service
 * - Integration Hook: useDocumentEditor for full editor integration
 *
 * @example
 * ```tsx
 * import {
 *   DocumentProvider,
 *   DocumentRenderer,
 *   useDocument,
 *   useQuotes,
 *   useDocumentMutations,
 *   useUndoRedo,
 *   useDocumentEditor,
 * } from '../features/document';
 *
 * function SermonView({ sermonDocument }) {
 *   return (
 *     <DocumentProvider sermonDocument={sermonDocument}>
 *       <DocumentRenderer showMetadata showStatistics />
 *       <EditToolbar />
 *     </DocumentProvider>
 *   );
 * }
 *
 * function EditToolbar() {
 *   const { verifyQuote, updateText } = useDocumentMutations();
 *   const { canUndo, canRedo, undo, redo } = useUndoRedo();
 *   // ...
 * }
 *
 * // With TipTap editor integration
 * function EditorView({ editor, historyItem }) {
 *   const { state, isDirty, save, statistics } = useDocumentEditor({
 *     editor,
 *     historyItem,
 *   });
 *   // ...
 * }
 * ```
 */

// --- Core ---
export { DocumentManager, createDocumentManager } from './DocumentManager';
export type {
  DocumentStatistics,
  NodeWithPath,
  TextExtractionOptions,
  LegacyConversionResult,
} from './DocumentManager';

// --- Context ---
export { DocumentContext, DocumentProvider, useDocumentContext, useDocumentContextSafe } from './DocumentContext';
export type { DocumentContextValue, DocumentProviderProps } from './DocumentContext';

// --- Hooks (Read Path - Phase B) ---
export { useDocument, useDocumentSafe } from './hooks/useDocument';
export type { UseDocumentResult } from './hooks/useDocument';

export { useQuotes } from './hooks/useQuotes';
export type { UseQuotesResult, EnrichedQuote, QuoteFilterOptions } from './hooks/useQuotes';

export { useNode, useNodeTraversal } from './hooks/useNode';
export type { UseNodeResult } from './hooks/useNode';

// --- Hooks (Write Path - Phase C) ---
export { useDocumentMutations } from './hooks/useDocumentMutations';
export type { UseDocumentMutationsResult } from './hooks/useDocumentMutations';

export { useUndoRedo } from './hooks/useUndoRedo';
export type { UseUndoRedoResult, UseUndoRedoOptions } from './hooks/useUndoRedo';

// --- Components ---
export {
  DocumentRenderer,
  NodeRenderer,
  ParagraphRenderer,
  TextRenderer,
  QuoteBlockRenderer,
  InterjectionRenderer,
  HeadingRenderer,
} from './components';
export type {
  DocumentRendererProps,
  NodeRendererProps,
  ParagraphRendererProps,
  TextRendererProps,
  QuoteBlockRendererProps,
  InterjectionRendererProps,
  HeadingRendererProps,
} from './components';

// --- Events (Write Path - Phase C) ---
export * from './events';

// --- Reducer (Write Path - Phase C) ---
export { applyEvent, applyEvents } from './reducer';
export type { ApplyEventResult, ReducerOptions } from './reducer';

// --- Mutator (Write Path - Phase C) ---
export { DocumentMutator, createDocumentMutator } from './DocumentMutator';
export type {
  MutationResult,
  CreateQuoteOptions,
  StateChangeCallback,
} from './DocumentMutator';

// --- Serialization (Phase D) ---
export {
  serializeDocumentState,
  deserializeDocumentState,
  compactSerialize,
  compactDeserialize,
  validateDocumentState,
} from './serialization';
export type {
  SerializedDocumentState,
  CompactDocumentState,
  SerializationOptions,
  DeserializationResult,
  ValidationResult,
} from './serialization';

// --- TipTap Bridge (Phase D) ---
export {
  astToTipTapJson,
  tipTapJsonToAst,
  astToHtml,
  htmlToAst,
} from './bridge';
export type {
  TipTapNode,
  TipTapDocument,
  ConversionOptions,
  ConversionResult,
} from './bridge';

// --- History Integration (Phase D) ---
export {
  createHistoryItemWithState,
  updateHistoryItemState,
  restoreFromHistoryItem,
  hasDocumentState,
  hasNewFormatState,
  migrateHistoryItem,
  estimateStorageSize,
  pruneEventLog,
  eventLogSize,
} from './history';
export type {
  HistoryItemWithState,
  SaveToHistoryOptions,
  RestoreFromHistoryResult,
} from './history';

// --- Integration Hook (Phase D) ---
export { useDocumentEditor } from './hooks/useDocumentEditor';
export type {
  UseDocumentEditorConfig,
  UseDocumentEditorResult,
} from './hooks/useDocumentEditor';
