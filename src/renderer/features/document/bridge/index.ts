/**
 * TipTap-AST Bridge Module
 *
 * Phase D: Provides bidirectional conversion between TipTap editor
 * content (JSON/HTML) and DocumentState AST.
 *
 * This bridge allows the existing TipTap editor to work with the new
 * structured document model, enabling:
 * - Rich text editing of sermon content
 * - Preservation of quote metadata and structure
 * - Seamless transitions between editor and structured views
 *
 * @example
 * ```typescript
 * import { astToTipTapJson, tipTapJsonToAst, astToHtml } from './bridge';
 *
 * // Convert AST to TipTap JSON for editor
 * const json = astToTipTapJson(documentState.root);
 * editor.commands.setContent(json);
 *
 * // Convert TipTap JSON back to AST
 * const updatedRoot = tipTapJsonToAst(editor.getJSON());
 * ```
 */

export {
  astToTipTapJson,
  tipTapJsonToAst,
  astToHtml,
  htmlToAst,
  type TipTapNode,
  type TipTapMark,
  type TipTapDocument,
  type ConversionOptions,
  type ConversionResult,
} from './astTipTapConverter';

export {
  syncEditorWithMutations,
  syncMutationsWithEditor,
  createEditorSyncHandler,
  type EditorSyncOptions,
  type SyncResult,
} from './editorSync';
