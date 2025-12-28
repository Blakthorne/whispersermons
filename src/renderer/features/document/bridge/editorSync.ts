/**
 * Editor Sync Module
 *
 * Provides utilities for synchronizing changes between the TipTap editor
 * and the DocumentMutator. This enables:
 *
 * - Applying document mutations to the editor
 * - Converting editor changes to document events
 * - Maintaining consistency between both representations
 */

import type { Editor } from '@tiptap/core';
import type {
  DocumentNode,
  NodeId,
} from '../../../../shared/documentModel';
import type { DocumentMutator } from '../DocumentMutator';
import { astToTipTapJson, tipTapJsonToAst, type TipTapDocument } from './astTipTapConverter';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for editor synchronization.
 */
export interface EditorSyncOptions {
  /** Whether to debounce sync operations (default: true) */
  debounce?: boolean;
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
  /** Whether to sync on every change (default: false) */
  syncOnChange?: boolean;
  /** Callback when sync completes */
  onSync?: (result: SyncResult) => void;
  /** Callback when sync fails */
  onError?: (error: Error) => void;
}

/**
 * Result from a sync operation.
 */
export interface SyncResult {
  success: boolean;
  /** Number of changes synced */
  changesApplied: number;
  /** Direction of sync */
  direction: 'editor-to-document' | 'document-to-editor';
  /** New document version */
  version?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Change detection result.
 */
interface ChangeDetection {
  hasChanges: boolean;
  addedNodes: NodeId[];
  removedNodes: NodeId[];
  modifiedNodes: NodeId[];
}

// ============================================================================
// SYNC OPERATIONS
// ============================================================================

/**
 * Sync mutations from the document to the editor.
 * Use this after applying mutations via DocumentMutator.
 */
export function syncEditorWithMutations(
  editor: Editor,
  mutator: DocumentMutator,
  options: EditorSyncOptions = {}
): SyncResult {
  const { onError } = options;

  try {
    const state = mutator.getState();
    const result = astToTipTapJson(state.root);

    if (!result.success || !result.data) {
      const error = new Error(result.error || 'Failed to convert AST to TipTap');
      onError?.(error);
      return {
        success: false,
        changesApplied: 0,
        direction: 'document-to-editor',
        error: result.error,
      };
    }

    // Update editor content
    editor.commands.setContent(result.data);

    return {
      success: true,
      changesApplied: 1,
      direction: 'document-to-editor',
      version: state.version,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(err);
    return {
      success: false,
      changesApplied: 0,
      direction: 'document-to-editor',
      error: err.message,
    };
  }
}

/**
 * Sync changes from the editor to the document.
 * Use this after user edits in the editor.
 *
 * Note: This is a simplified implementation that replaces the entire document.
 * For more granular change tracking, consider implementing operational transforms.
 */
export function syncMutationsWithEditor(
  editor: Editor,
  mutator: DocumentMutator,
  options: EditorSyncOptions = {}
): SyncResult {
  const { onError } = options;

  try {
    const json = editor.getJSON() as TipTapDocument;
    const result = tipTapJsonToAst(json);

    if (!result.success || !result.data) {
      const error = new Error(result.error || 'Failed to convert TipTap to AST');
      onError?.(error);
      return {
        success: false,
        changesApplied: 0,
        direction: 'editor-to-document',
        error: result.error,
      };
    }

    // For now, we detect changes and apply them as a batch
    // In the future, this could use more granular change detection
    const currentState = mutator.getState();
    const changes = detectChanges(currentState.root, result.data);

    if (!changes.hasChanges) {
      return {
        success: true,
        changesApplied: 0,
        direction: 'editor-to-document',
        version: currentState.version,
      };
    }

    // Apply changes as a batch operation
    // Note: For a more sophisticated implementation, we would generate
    // specific events for each change (text_changed, node_created, etc.)
    // For now, we use a simple content replacement approach

    let changesApplied = 0;

    // Process modified text nodes
    for (const nodeId of changes.modifiedNodes) {
      const oldNode = currentState.nodeIndex[nodeId];
      if (oldNode && oldNode.node.type === 'text') {
        // Find corresponding node in new tree
        const newContent = findTextContent(result.data, nodeId);
        if (newContent !== null) {
          const updateResult = mutator.updateText(nodeId, newContent);
          if (updateResult.success) {
            changesApplied++;
          }
        }
      }
    }

    return {
      success: true,
      changesApplied,
      direction: 'editor-to-document',
      version: mutator.getVersion(),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(err);
    return {
      success: false,
      changesApplied: 0,
      direction: 'editor-to-document',
      error: err.message,
    };
  }
}

/**
 * Create a sync handler that can be attached to the editor.
 * Returns cleanup function.
 */
export function createEditorSyncHandler(
  editor: Editor,
  mutator: DocumentMutator,
  options: EditorSyncOptions = {}
): () => void {
  const { debounce = true, debounceMs = 300, syncOnChange = false, onSync, onError } = options;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const handleUpdate = () => {
    if (!syncOnChange) return;

    if (debounce) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        const result = syncMutationsWithEditor(editor, mutator, { onError });
        onSync?.(result);
      }, debounceMs);
    } else {
      const result = syncMutationsWithEditor(editor, mutator, { onError });
      onSync?.(result);
    }
  };

  editor.on('update', handleUpdate);

  // Return cleanup function
  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    editor.off('update', handleUpdate);
  };
}

// ============================================================================
// CHANGE DETECTION
// ============================================================================

/**
 * Detect changes between two document trees.
 */
function detectChanges(
  oldRoot: DocumentNode,
  newRoot: DocumentNode
): ChangeDetection {
  const oldNodeIds = collectNodeIds(oldRoot);
  const newNodeIds = collectNodeIds(newRoot);

  const addedNodes: NodeId[] = [];
  const removedNodes: NodeId[] = [];
  const modifiedNodes: NodeId[] = [];

  // Find added and modified nodes
  for (const id of newNodeIds) {
    if (!oldNodeIds.has(id)) {
      addedNodes.push(id);
    } else {
      // Check if node content changed
      // This is a simplified check; a full implementation would compare content
      modifiedNodes.push(id);
    }
  }

  // Find removed nodes
  for (const id of oldNodeIds) {
    if (!newNodeIds.has(id)) {
      removedNodes.push(id);
    }
  }

  return {
    hasChanges: addedNodes.length > 0 || removedNodes.length > 0 || modifiedNodes.length > 0,
    addedNodes,
    removedNodes,
    modifiedNodes,
  };
}

/**
 * Collect all node IDs from a tree.
 */
function collectNodeIds(node: DocumentNode, ids: Set<NodeId> = new Set()): Set<NodeId> {
  ids.add(node.id);

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectNodeIds(child, ids);
    }
  }

  return ids;
}

/**
 * Find text content for a node in a tree.
 */
function findTextContent(root: DocumentNode, nodeId: NodeId): string | null {
  if (root.id === nodeId && root.type === 'text') {
    return (root as { content: string }).content;
  }

  if ('children' in root && Array.isArray(root.children)) {
    for (const child of root.children) {
      const result = findTextContent(child, nodeId);
      if (result !== null) {
        return result;
      }
    }
  }

  return null;
}
