/**
 * DocumentManager - Client-side state manager for the Hybrid AST + Event Log architecture.
 *
 * This class provides the "Read Path" for consuming DocumentState from Python processing.
 * It handles:
 * - Node lookups by ID (O(1) via nodeIndex)
 * - Passage lookups by reference or book (Bible passages)
 * - Tree traversal utilities
 * - Backward compatibility with legacy body-only format
 * - Statistics and word count
 *
 * The DocumentManager is read-only in Phase B. Phase C will add mutation methods.
 *
 * AST Node Types: document, paragraph, text, passage, interjection
 * Headings are paragraphs with headingLevel (1-3)
 * Lists are paragraphs with listStyle/listNumber/listDepth
 * Block quotes (visual) are paragraphs with isBlockQuote
 */

import type {
  DocumentState,
  DocumentRootNode,
  DocumentNode,
  ParagraphNode,
  TextNode,
  PassageNode,
  InterjectionNode,
  NodeId,
  NodeIndex,
  PassageMetadata,
} from '../../../shared/documentModel';

import {
  isTextNode as checkIsTextNode,
  isPassageNode as checkIsPassageNode,
  isInterjectionNode as checkIsInterjectionNode,
  hasChildren as checkHasChildren,
  isParagraphNode as checkIsParagraphNode,
  isHeadingParagraph as checkIsHeadingParagraph,
  isListItemParagraph as checkIsListItemParagraph,
} from '../../../shared/documentModel';

/**
 * Statistics about the document.
 */
export interface DocumentStatistics {
  /** Total word count */
  wordCount: number;
  /** Total character count (excluding whitespace) */
  characterCount: number;
  /** Number of paragraphs */
  paragraphCount: number;
  /** Number of passages (Bible passages) */
  passageCount: number;
  /** Number of verified passages */
  verifiedPassageCount: number;
  /** Number of interjections */
  interjectionCount: number;
  /** Number of headings */
  headingCount: number;
}

/**
 * Node with path information for traversal results.
 */
export interface NodeWithPath<T extends DocumentNode = DocumentNode> {
  /** The node */
  node: T;
  /** Path from root (array of node IDs) */
  path: NodeId[];
  /** Parent node ID (null for root) */
  parentId: NodeId | null;
  /** Index in parent's children array */
  index: number;
}

/**
 * Options for text extraction.
 */
export interface TextExtractionOptions {
  /** Include interjections in text output */
  includeInterjections?: boolean;
  /** Include passage metadata as annotations */
  includePassageAnnotations?: boolean;
  /** Separator between paragraphs */
  paragraphSeparator?: string;
}

/**
 * Result from legacy conversion.
 */
export interface LegacyConversionResult {
  /** The converted DocumentState */
  documentState: DocumentState;
  /** Whether this was converted from legacy format */
  isLegacyConversion: boolean;
  /** Original body text if legacy */
  originalBody?: string;
}

/**
 * Creates a UUID v4.
 */
function createUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * DocumentManager - Read-only state manager for DocumentState.
 */
export class DocumentManager {
  private readonly state: DocumentState;
  private readonly isLegacy: boolean;
  private cachedStatistics: DocumentStatistics | null = null;

  /**
   * Create a new DocumentManager.
   *
   * @param documentState - The DocumentState to manage (or null for legacy fallback)
   * @param legacyBody - Optional legacy body text for backward compatibility
   */
  constructor(documentState: DocumentState | undefined | null, legacyBody?: string) {
    if (documentState) {
      this.state = documentState;
      this.isLegacy = false;
    } else if (legacyBody) {
      // Convert legacy body-only format to DocumentState
      this.state = this.convertLegacyToDocumentState(legacyBody);
      this.isLegacy = true;
    } else {
      // Create empty document
      this.state = this.createEmptyDocumentState();
      this.isLegacy = false;
    }
  }

  // ============================================================================
  // BASIC ACCESSORS
  // ============================================================================

  /**
   * Get the full DocumentState.
   */
  getState(): DocumentState {
    return this.state;
  }

  /**
   * Get the root document node.
   */
  getRoot(): DocumentRootNode {
    return this.state.root;
  }

  /**
   * Get the current version.
   */
  getVersion(): number {
    return this.state.version;
  }

  /**
   * Check if this document was converted from legacy format.
   */
  getIsLegacy(): boolean {
    return this.isLegacy;
  }

  /**
   * Get document title.
   */
  getTitle(): string | undefined {
    return this.state.root.title;
  }

  /**
   * Get main Bible passage.
   */
  getBiblePassage(): string | undefined {
    return this.state.root.biblePassage;
  }

  /**
   * Get speaker/author.
   */
  getSpeaker(): string | undefined {
    return this.state.root.speaker;
  }

  // ============================================================================
  // NODE LOOKUPS (O(1) via index)
  // ============================================================================

  /**
   * Get a node by ID.
   *
   * @param nodeId - The node ID to look up
   * @returns The node if found, undefined otherwise
   */
  getNodeById(nodeId: NodeId): DocumentNode | undefined {
    const entry = this.state.nodeIndex[nodeId];
    return entry?.node;
  }

  /**
   * Get a node with path information.
   *
   * @param nodeId - The node ID to look up
   * @returns NodeWithPath if found, undefined otherwise
   */
  getNodeWithPath(nodeId: NodeId): NodeWithPath | undefined {
    const entry = this.state.nodeIndex[nodeId];
    if (!entry) return undefined;

    // Calculate index in parent's children
    let index = 0;
    if (entry.parentId) {
      const parent = this.getNodeById(entry.parentId);
      if (parent && checkHasChildren(parent)) {
        index = parent.children.findIndex((child) => child.id === nodeId);
      }
    }

    return {
      node: entry.node,
      path: entry.path,
      parentId: entry.parentId,
      index,
    };
  }

  /**
   * Get the parent of a node.
   *
   * @param nodeId - The node ID
   * @returns The parent node if found, undefined otherwise
   */
  getParent(nodeId: NodeId): DocumentNode | undefined {
    const entry = this.state.nodeIndex[nodeId];
    if (!entry || !entry.parentId) return undefined;
    return this.getNodeById(entry.parentId);
  }

  /**
   * Get siblings of a node (including the node itself).
   *
   * @param nodeId - The node ID
   * @returns Array of sibling nodes, empty if not found
   */
  getSiblings(nodeId: NodeId): DocumentNode[] {
    const parent = this.getParent(nodeId);
    if (!parent || !checkHasChildren(parent)) return [];
    return parent.children;
  }

  // ============================================================================
  // PASSAGE LOOKUPS (via passageIndex) - Bible Passages
  // ============================================================================

  /**
   * Get all passages in document order.
   *
   * @returns Array of PassageNode
   */
  getAllPassages(): PassageNode[] {
    return this.state.passageIndex.all
      .map((id) => this.getNodeById(id))
      .filter((node): node is PassageNode => node !== undefined && checkIsPassageNode(node));
  }

  /**
   * Get a passage by ID.
   *
   * @param passageId - The passage node ID
   * @returns PassageNode if found, undefined otherwise
   */
  getPassageById(passageId: NodeId): PassageNode | undefined {
    const node = this.getNodeById(passageId);
    return node && checkIsPassageNode(node) ? node : undefined;
  }

  /**
   * Get passages by normalized reference.
   *
   * @param reference - The normalized reference string (e.g., "Matthew 5:3")
   * @returns Array of PassageNode
   */
  getPassagesByReference(reference: string): PassageNode[] {
    const ids = this.state.passageIndex.byReference[reference] || [];
    return ids
      .map((id) => this.getNodeById(id))
      .filter((node): node is PassageNode => node !== undefined && checkIsPassageNode(node));
  }

  /**
   * Get passages by book name.
   *
   * @param book - The book name (e.g., "Matthew")
   * @returns Array of PassageNode
   */
  getPassagesByBook(book: string): PassageNode[] {
    const ids = this.state.passageIndex.byBook[book] || [];
    return ids
      .map((id) => this.getNodeById(id))
      .filter((node): node is PassageNode => node !== undefined && checkIsPassageNode(node));
  }

  /**
   * Get passage metadata by passage ID.
   *
   * @param passageId - The passage node ID
   * @returns PassageMetadata if found, undefined otherwise
   */
  getPassageMetadata(passageId: NodeId): PassageMetadata | undefined {
    const passage = this.getPassageById(passageId);
    return passage?.metadata;
  }

  // ============================================================================
  // TREE TRAVERSAL
  // ============================================================================

  /**
   * Get all nodes of a specific type.
   *
   * @param type - The node type to filter by
   * @returns Array of nodes matching the type
   */
  getNodesByType<T extends DocumentNode['type']>(
    type: T
  ): Extract<DocumentNode, { type: T }>[] {
    const results: Extract<DocumentNode, { type: T }>[] = [];

    const traverse = (node: DocumentNode): void => {
      if (node.type === type) {
        results.push(node as Extract<DocumentNode, { type: T }>);
      }
      if (checkHasChildren(node)) {
        node.children.forEach(traverse);
      }
    };

    traverse(this.state.root);
    return results;
  }

  /**
   * Get all paragraphs.
   */
  getParagraphs(): ParagraphNode[] {
    return this.getNodesByType('paragraph');
  }

  /**
   * Get all text nodes.
   */
  getTextNodes(): TextNode[] {
    return this.getNodesByType('text');
  }

  /**
   * Get all interjections.
   */
  getInterjections(): InterjectionNode[] {
    return this.getNodesByType('interjection');
  }

  /**
   * Get all headings (paragraphs with headingLevel).
   */
  getHeadings(): (ParagraphNode & { headingLevel: 1 | 2 | 3 })[] {
    const result: (ParagraphNode & { headingLevel: 1 | 2 | 3 })[] = [];
    this.traverse((node) => {
      if (checkIsParagraphNode(node) && checkIsHeadingParagraph(node)) {
        result.push(node);
      }
    });
    return result;
  }

  /**
   * Get all list items (paragraphs with listStyle).
   */
  getListItems(): (ParagraphNode & { listStyle: 'bullet' | 'ordered' })[] {
    const result: (ParagraphNode & { listStyle: 'bullet' | 'ordered' })[] = [];
    this.traverse((node) => {
      if (checkIsParagraphNode(node) && checkIsListItemParagraph(node)) {
        result.push(node);
      }
    });
    return result;
  }

  /**
   * Traverse the document tree depth-first.
   *
   * @param callback - Function called for each node
   * @param root - Optional starting node (defaults to document root)
   */
  traverse(
    callback: (node: DocumentNode, path: NodeId[], parentId: NodeId | null) => void | false,
    root?: DocumentNode
  ): void {
    const startNode = root || this.state.root;

    const walk = (node: DocumentNode, path: NodeId[], parentId: NodeId | null): boolean => {
      const result = callback(node, path, parentId);
      if (result === false) return false;

      if (checkHasChildren(node)) {
        const newPath = [...path, node.id];
        for (const child of node.children) {
          if (!walk(child, newPath, node.id)) return false;
        }
      }
      return true;
    };

    walk(startNode, [], null);
  }

  /**
   * Find nodes matching a predicate.
   *
   * @param predicate - Function to test each node
   * @returns Array of matching nodes with path info
   */
  findNodes(predicate: (node: DocumentNode) => boolean): NodeWithPath[] {
    const results: NodeWithPath[] = [];

    this.traverse((node, path, parentId) => {
      if (predicate(node)) {
        const parent = parentId ? this.getNodeById(parentId) : null;
        let index = 0;
        if (parent && checkHasChildren(parent)) {
          index = parent.children.findIndex((child) => child.id === node.id);
        }
        results.push({ node, path, parentId, index });
      }
    });

    return results;
  }

  // ============================================================================
  // TEXT EXTRACTION
  // ============================================================================

  /**
   * Extract plain text from the document.
   *
   * @param options - Extraction options
   * @returns Plain text content
   */
  extractText(options: TextExtractionOptions = {}): string {
    const {
      includeInterjections = true,
      includePassageAnnotations = false,
      paragraphSeparator = '\n\n',
    } = options;

    const paragraphTexts: string[] = [];

    const extractFromNode = (node: DocumentNode): string => {
      if (checkIsTextNode(node)) {
        return node.content;
      }

      if (checkIsInterjectionNode(node)) {
        return includeInterjections ? `[${node.content}]` : '';
      }

      if (checkIsPassageNode(node)) {
        const passageText = node.children.map(extractFromNode).join('');
        if (includePassageAnnotations) {
          const ref = node.metadata.reference?.normalizedReference ?? 'Unknown';
          return `"${passageText}" (${ref})`;
        }
        return passageText;
      }

      if (checkHasChildren(node)) {
        return node.children.map(extractFromNode).join('');
      }

      return '';
    };

    // Process top-level children
    for (const child of this.state.root.children) {
      const text = extractFromNode(child).trim();
      if (text) {
        paragraphTexts.push(text);
      }
    }

    return paragraphTexts.join(paragraphSeparator);
  }

  /**
   * Get the text content of a specific node.
   *
   * @param nodeId - The node ID
   * @returns Plain text content of the node and its children
   */
  getNodeText(nodeId: NodeId): string {
    const node = this.getNodeById(nodeId);
    if (!node) return '';

    const extractText = (n: DocumentNode): string => {
      if (checkIsTextNode(n)) return n.content;
      if (checkIsInterjectionNode(n)) return n.content;
      if (checkHasChildren(n)) return n.children.map(extractText).join('');
      return '';
    };

    return extractText(node);
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get document statistics.
   * Results are cached for performance.
   */
  getStatistics(): DocumentStatistics {
    if (this.cachedStatistics) return this.cachedStatistics;

    let wordCount = 0;
    let characterCount = 0;
    let paragraphCount = 0;
    let passageCount = 0;
    let verifiedPassageCount = 0;
    let interjectionCount = 0;
    let headingCount = 0;

    this.traverse((node) => {
      switch (node.type) {
        case 'text':
          const text = (node as TextNode).content;
          wordCount += text.trim().split(/\s+/).filter(Boolean).length;
          characterCount += text.replace(/\s/g, '').length;
          break;
        case 'paragraph':
          paragraphCount++;
          // Count heading-styled paragraphs separately
          if (checkIsHeadingParagraph(node)) {
            headingCount++;
          }
          break;
        case 'passage':
          passageCount++;
          const passageNode = node as PassageNode;
          if (passageNode.metadata.userVerified) {
            verifiedPassageCount++;
          }
          break;
        case 'interjection':
          interjectionCount++;
          const intText = (node as InterjectionNode).content;
          wordCount += intText.trim().split(/\s+/).filter(Boolean).length;
          characterCount += intText.replace(/\s/g, '').length;
          break;
      }
    });

    this.cachedStatistics = {
      wordCount,
      characterCount,
      paragraphCount,
      passageCount,
      verifiedPassageCount,
      interjectionCount,
      headingCount,
    };

    return this.cachedStatistics;
  }

  /**
   * Get total word count.
   */
  getWordCount(): number {
    return this.getStatistics().wordCount;
  }

  // ============================================================================
  // EXTRACTED REFERENCES (backward compatibility)
  // ============================================================================

  /**
   * Get extracted references array (for backward compatibility).
   */
  getReferences(): string[] {
    return this.state.extracted.references;
  }

  /**
   * Get extracted tags array (for backward compatibility).
   */
  getTags(): string[] {
    return this.state.extracted.tags;
  }

  // ============================================================================
  // PRIVATE: LEGACY CONVERSION
  // ============================================================================

  /**
   * Convert legacy body-only format to DocumentState.
   */
  private convertLegacyToDocumentState(body: string): DocumentState {
    const now = new Date().toISOString();
    const rootId = createUUID();

    // Split into paragraphs
    const paragraphs = body
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    // Build children
    const children: ParagraphNode[] = paragraphs.map((text) => {
      const paragraphId = createUUID();
      const textId = createUUID();

      const textNode: TextNode = {
        id: textId,
        type: 'text',
        version: 1,
        updatedAt: now,
        content: text,
      };

      return {
        id: paragraphId,
        type: 'paragraph',
        version: 1,
        updatedAt: now,
        children: [textNode],
      };
    });

    // Build root
    const root: DocumentRootNode = {
      id: rootId,
      type: 'document',
      version: 1,
      updatedAt: now,
      children,
    };

    // Build node index
    const nodeIndex: NodeIndex = {
      [rootId]: { node: root, parentId: null, path: [] },
    };

    children.forEach((paragraph) => {
      nodeIndex[paragraph.id] = {
        node: paragraph,
        parentId: rootId,
        path: [rootId],
      };

      paragraph.children.forEach((textNode) => {
        nodeIndex[textNode.id] = {
          node: textNode,
          parentId: paragraph.id,
          path: [rootId, paragraph.id],
        };
      });
    });

    return {
      version: 1,
      root,
      eventLog: [],
      undoStack: [],
      redoStack: [],
      nodeIndex,
      passageIndex: {
        byReference: {},
        byBook: {},
        all: [],
      },
      extracted: {
        references: [],
        tags: [],
      },
      lastModified: now,
      createdAt: now,
    };
  }

  /**
   * Create an empty DocumentState.
   */
  private createEmptyDocumentState(): DocumentState {
    const now = new Date().toISOString();
    const rootId = createUUID();

    const root: DocumentRootNode = {
      id: rootId,
      type: 'document',
      version: 1,
      updatedAt: now,
      children: [],
    };

    return {
      version: 1,
      root,
      eventLog: [],
      undoStack: [],
      redoStack: [],
      nodeIndex: {
        [rootId]: { node: root, parentId: null, path: [] },
      },
      passageIndex: {
        byReference: {},
        byBook: {},
        all: [],
      },
      extracted: {
        references: [],
        tags: [],
      },
      lastModified: now,
      createdAt: now,
    };
  }
}

/**
 * Create a DocumentManager from a SermonDocument.
 * This is the primary factory function for creating DocumentManagers.
 *
 * @param sermonDocument - The SermonDocument from processing pipeline
 * @returns DocumentManager instance
 */
export function createDocumentManager(sermonDocument: {
  documentState?: DocumentState;
  body?: string;
} | null): DocumentManager {
  if (!sermonDocument) {
    return new DocumentManager(null);
  }

  return new DocumentManager(sermonDocument.documentState, sermonDocument.body);
}

export default DocumentManager;
