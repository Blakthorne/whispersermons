/**
 * useNode Hook
 *
 * Provides access to individual nodes and traversal utilities.
 * Specialized hook for working with specific nodes.
 */

import { useCallback, useMemo } from 'react';
import { useDocumentContext } from '../DocumentContext';
import type { NodeWithPath } from '../DocumentManager';
import type {
  DocumentNode,
  NodeId,
} from '../../../../shared/documentModel';
import {
  isTextNode,
  isParagraphNode,
  isQuoteBlockNode,
  isInterjectionNode,
  hasChildren,
} from '../../../../shared/documentModel';

/**
 * Return type for useNode hook with a specific node.
 */
export interface UseNodeResult<T extends DocumentNode = DocumentNode> {
  /** The node (null if not found) */
  node: T | null;

  /** Whether the node exists */
  exists: boolean;

  /** Node path from root */
  path: NodeId[];

  /** Parent node ID */
  parentId: NodeId | null;

  /** Parent node */
  parent: DocumentNode | null;

  /** Sibling nodes (including this node) */
  siblings: DocumentNode[];

  /** Index in parent's children */
  index: number;

  /** Previous sibling (if exists) */
  previousSibling: DocumentNode | null;

  /** Next sibling (if exists) */
  nextSibling: DocumentNode | null;

  /** Text content of this node */
  text: string;

  /** Type guards */
  isText: boolean;
  isParagraph: boolean;
  isQuoteBlock: boolean;
  isInterjection: boolean;
  hasChildren: boolean;
}

/**
 * Hook for accessing a specific node by ID.
 *
 * @param nodeId - The node ID to access
 * @returns Node information and utilities
 *
 * @example
 * ```tsx
 * function NodeDetails({ nodeId }: { nodeId: NodeId }) {
 *   const {
 *     node,
 *     exists,
 *     parent,
 *     isQuoteBlock,
 *     text,
 *   } = useNode(nodeId);
 *
 *   if (!exists) {
 *     return <div>Node not found</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <p>Type: {node.type}</p>
 *       <p>Text: {text}</p>
 *       {isQuoteBlock && <QuoteDetails quote={node as QuoteBlockNode} />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useNode<T extends DocumentNode = DocumentNode>(
  nodeId: NodeId | null | undefined
): UseNodeResult<T> {
  const context = useDocumentContext();

  // Get node with path info
  const nodeWithPath = useMemo((): NodeWithPath | null => {
    if (!nodeId || !context.manager) return null;
    return context.getNodeWithPath(nodeId) ?? null;
  }, [nodeId, context]);

  // Get parent node
  const parent = useMemo((): DocumentNode | null => {
    if (!nodeWithPath?.parentId || !context.manager) return null;
    return context.getNodeById(nodeWithPath.parentId) ?? null;
  }, [nodeWithPath, context]);

  // Get siblings
  const siblings = useMemo((): DocumentNode[] => {
    if (!parent || !hasChildren(parent)) return [];
    return parent.children;
  }, [parent]);

  // Get sibling navigation
  const { previousSibling, nextSibling } = useMemo(() => {
    if (!nodeWithPath || siblings.length === 0) {
      return { previousSibling: null, nextSibling: null };
    }

    const idx = nodeWithPath.index;
    return {
      previousSibling: idx > 0 ? siblings[idx - 1] : null,
      nextSibling: idx < siblings.length - 1 ? siblings[idx + 1] : null,
    };
  }, [nodeWithPath, siblings]);

  // Get text content
  const text = useMemo((): string => {
    if (!nodeId) return '';
    return context.getNodeText(nodeId);
  }, [nodeId, context]);

  // Type guards
  const node = nodeWithPath?.node ?? null;
  const nodeIsText = node ? isTextNode(node) : false;
  const nodeIsParagraph = node ? isParagraphNode(node) : false;
  const nodeIsQuoteBlock = node ? isQuoteBlockNode(node) : false;
  const nodeIsInterjection = node ? isInterjectionNode(node) : false;
  const nodeHasChildren = node ? hasChildren(node) : false;

  return {
    node: node as T | null,
    exists: node !== null,
    path: nodeWithPath?.path ?? [],
    parentId: nodeWithPath?.parentId ?? null,
    parent: parent ?? null,
    siblings,
    index: nodeWithPath?.index ?? -1,
    previousSibling: previousSibling ?? null,
    nextSibling: nextSibling ?? null,
    text,
    isText: nodeIsText,
    isParagraph: nodeIsParagraph,
    isQuoteBlock: nodeIsQuoteBlock,
    isInterjection: nodeIsInterjection,
    hasChildren: nodeHasChildren,
  };
}

/**
 * Hook for traversing and finding nodes.
 *
 * @example
 * ```tsx
 * function NodeSearch() {
 *   const { findByType, findByPredicate, traverse } = useNodeTraversal();
 *
 *   const allQuotes = findByType('quote_block');
 *   const highConfidenceQuotes = findByPredicate(
 *     (node) => node.type === 'quote_block' &&
 *               node.metadata.detection.confidence > 0.8
 *   );
 * }
 * ```
 */
export function useNodeTraversal() {
  const context = useDocumentContext();

  // Find nodes by type
  const findByType = useCallback(
    <T extends DocumentNode['type']>(type: T): Extract<DocumentNode, { type: T }>[] => {
      if (!context.manager) return [];

      const results: Extract<DocumentNode, { type: T }>[] = [];
      context.manager.traverse((node) => {
        if (node.type === type) {
          results.push(node as Extract<DocumentNode, { type: T }>);
        }
      });
      return results;
    },
    [context.manager]
  );

  // Find nodes by predicate
  const findByPredicate = useCallback(
    (predicate: (node: DocumentNode) => boolean): NodeWithPath[] => {
      if (!context.manager) return [];
      return context.manager.findNodes(predicate);
    },
    [context.manager]
  );

  // Traverse with callback
  const traverse = useCallback(
    (
      callback: (node: DocumentNode, path: NodeId[], parentId: NodeId | null) => void | false
    ): void => {
      if (!context.manager) return;
      context.manager.traverse(callback);
    },
    [context.manager]
  );

  // Get all nodes flat
  const getAllNodes = useCallback((): NodeWithPath[] => {
    if (!context.manager) return [];
    return context.manager.findNodes(() => true);
  }, [context.manager]);

  return {
    findByType,
    findByPredicate,
    traverse,
    getAllNodes,
  };
}

export default useNode;
