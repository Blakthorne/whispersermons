/**
 * State Serializer
 *
 * Handles serialization and deserialization of DocumentState.
 * Provides both full and compact serialization modes:
 *
 * - **Full**: Preserves all fields including indexes (faster restore)
 * - **Compact**: Only stores root + eventLog (smaller, requires rebuild)
 *
 * The compact format is recommended for localStorage to minimize storage.
 * Full format is useful for debugging or when restore speed is critical.
 */

import type {
  DocumentState,
  DocumentRootNode,
  DocumentEvent,
  NodeIndex,
  PassageIndex,
  ExtractedReferences,
  DocumentNode,
  NodeId,
  PassageNode,
} from '../../../../shared/documentModel';
import { isPassageNode, hasChildren } from '../../../../shared/documentModel';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Full serialized state (preserves everything).
 */
export interface SerializedDocumentState {
  /** Schema version for migration */
  schemaVersion: number;
  /** The full document state */
  state: DocumentState;
}

/**
 * Compact serialized state (minimal, requires rebuild).
 */
export interface CompactDocumentState {
  /** Schema version for migration */
  schemaVersion: number;
  /** Root node (the AST) */
  root: DocumentRootNode;
  /** Current version number */
  version: number;
  /** Event log for undo/redo */
  eventLog: DocumentEvent[];
  /** Undo stack */
  undoStack: string[];
  /** Redo stack */
  redoStack: string[];
  /** Last modified timestamp */
  lastModified: string;
  /** Creation timestamp */
  createdAt: string;
}

/**
 * Options for serialization.
 */
export interface SerializationOptions {
  /** Whether to pretty-print JSON (default: false) */
  pretty?: boolean;
  /** Whether to include event log (default: true) */
  includeEventLog?: boolean;
  /** Maximum events to include (default: unlimited) */
  maxEvents?: number;
}

/**
 * Result from deserialization.
 */
export interface DeserializationResult {
  /** Whether deserialization was successful */
  success: boolean;
  /** The deserialized state (if successful) */
  state?: DocumentState;
  /** Error message (if failed) */
  error?: string;
  /** Whether migration was applied */
  migrated?: boolean;
  /** Original schema version */
  originalVersion?: number;
}

/**
 * Result from validation.
 */
export interface ValidationResult {
  /** Whether state is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
  /** List of validation warnings */
  warnings: string[];
}

// ============================================================================
// CURRENT SCHEMA VERSION
// ============================================================================

const CURRENT_SCHEMA_VERSION = 1;

// ============================================================================
// FULL SERIALIZATION
// ============================================================================

/**
 * Serialize DocumentState to JSON string (full format).
 */
export function serializeDocumentState(
  state: DocumentState,
  options: SerializationOptions = {}
): string {
  const { pretty = false, includeEventLog = true, maxEvents } = options;

  let eventLog = state.eventLog;
  if (!includeEventLog) {
    eventLog = [];
  } else if (maxEvents !== undefined && maxEvents < eventLog.length) {
    // Keep most recent events
    eventLog = eventLog.slice(-maxEvents);
  }

  const serialized: SerializedDocumentState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    state: {
      ...state,
      eventLog,
    },
  };

  return pretty ? JSON.stringify(serialized, null, 2) : JSON.stringify(serialized);
}

/**
 * Deserialize JSON string to DocumentState (full format).
 */
export function deserializeDocumentState(json: string | null): DeserializationResult {
  if (!json) {
    return { success: false, error: 'No data provided' };
  }

  try {
    const parsed = JSON.parse(json);

    // Handle legacy format (no schemaVersion wrapper)
    if (!parsed.schemaVersion) {
      // Try to treat as raw DocumentState
      const validation = validateDocumentState(parsed);
      if (validation.valid) {
        return {
          success: true,
          state: parsed as DocumentState,
          migrated: true,
          originalVersion: 0,
        };
      }
      return { success: false, error: 'Invalid legacy format: ' + validation.errors.join(', ') };
    }

    const serialized = parsed as SerializedDocumentState;

    // Apply migrations if needed
    const migratedState = migrateState(serialized);

    // Validate
    const validation = validateDocumentState(migratedState);
    if (!validation.valid) {
      return { success: false, error: 'Validation failed: ' + validation.errors.join(', ') };
    }

    return {
      success: true,
      state: migratedState,
      migrated: serialized.schemaVersion !== CURRENT_SCHEMA_VERSION,
      originalVersion: serialized.schemaVersion,
    };
  } catch (error) {
    return {
      success: false,
      error: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// COMPACT SERIALIZATION
// ============================================================================

/**
 * Serialize DocumentState to compact JSON string.
 * Only stores essential data; indexes can be rebuilt.
 */
export function compactSerialize(
  state: DocumentState,
  options: SerializationOptions = {}
): string {
  const { pretty = false, includeEventLog = true, maxEvents } = options;

  let eventLog = state.eventLog;
  if (!includeEventLog) {
    eventLog = [];
  } else if (maxEvents !== undefined && maxEvents < eventLog.length) {
    eventLog = eventLog.slice(-maxEvents);
  }

  const compact: CompactDocumentState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    root: state.root,
    version: state.version,
    eventLog,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    lastModified: state.lastModified,
    createdAt: state.createdAt,
  };

  return pretty ? JSON.stringify(compact, null, 2) : JSON.stringify(compact);
}

/**
 * Deserialize compact JSON string and rebuild indexes.
 */
export function compactDeserialize(json: string | null): DeserializationResult {
  if (!json) {
    return { success: false, error: 'No data provided' };
  }

  try {
    const parsed = JSON.parse(json);

    // Detect if this is compact format
    if (parsed.root && !parsed.state) {
      const compact = parsed as CompactDocumentState;

      // Rebuild indexes
      const nodeIndex = buildNodeIndex(compact.root);
      const passageIndex = buildPassageIndex(compact.root, nodeIndex);
      const extracted = buildExtracted(compact.root, nodeIndex);

      const state: DocumentState = {
        version: compact.version,
        root: compact.root,
        eventLog: compact.eventLog || [],
        undoStack: compact.undoStack || [],
        redoStack: compact.redoStack || [],
        nodeIndex,
        passageIndex,
        extracted,
        lastModified: compact.lastModified || new Date().toISOString(),
        createdAt: compact.createdAt || new Date().toISOString(),
      };

      return {
        success: true,
        state,
        migrated: compact.schemaVersion !== CURRENT_SCHEMA_VERSION,
        originalVersion: compact.schemaVersion,
      };
    }

    // Fall back to full deserialization
    return deserializeDocumentState(json);
  } catch (error) {
    return {
      success: false,
      error: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// INDEX REBUILDING
// ============================================================================

/**
 * Build NodeIndex from root node.
 */
export function buildNodeIndex(root: DocumentRootNode): NodeIndex {
  const index: NodeIndex = {};

  function traverse(node: DocumentNode, parentId: NodeId | null, path: NodeId[]) {
    index[node.id] = { node, parentId, path };

    if (hasChildren(node)) {
      const newPath = [...path, node.id];
      for (const child of (node as { children: DocumentNode[] }).children) {
        traverse(child, node.id, newPath);
      }
    }
  }

  traverse(root, null, []);
  return index;
}

/**
 * Build PassageIndex from root node.
 */
export function buildPassageIndex(_root: DocumentRootNode, nodeIndex: NodeIndex): PassageIndex {
  const byReference: { [reference: string]: NodeId[] } = {};
  const byBook: { [book: string]: NodeId[] } = {};
  const all: NodeId[] = [];

  for (const entry of Object.values(nodeIndex)) {
    if (isPassageNode(entry.node)) {
      const passage = entry.node as PassageNode;
      all.push(passage.id);

      // Index by reference
      const ref = passage.metadata.reference?.normalizedReference ?? 'Unknown';
      if (!byReference[ref]) {
        byReference[ref] = [];
      }
      byReference[ref].push(passage.id);

      // Index by book
      const book = passage.metadata.reference?.book ?? 'Unknown';
      if (!byBook[book]) {
        byBook[book] = [];
      }
      byBook[book].push(passage.id);
    }
  }

  return { byReference, byBook, all };
}

/**
 * Build ExtractedReferences from root node.
 */
export function buildExtracted(
  _root: DocumentRootNode,
  nodeIndex: NodeIndex
): ExtractedReferences {
  const references: string[] = [];
  const tags: string[] = [];

  for (const entry of Object.values(nodeIndex)) {
    if (isPassageNode(entry.node)) {
      const passage = entry.node as PassageNode;
      const ref = passage.metadata.reference?.normalizedReference;
      if (ref && !references.includes(ref)) {
        references.push(ref);
      }
    }
  }

  // Note: Tags are typically stored at document level, not extracted from quotes
  // This maintains backward compatibility with the legacy format

  return { references, tags };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a DocumentState object.
 */
export function validateDocumentState(state: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['State must be an object'], warnings: [] };
  }

  const s = state as Record<string, unknown>;

  // Required fields
  if (typeof s.version !== 'number') {
    errors.push('Missing or invalid version');
  }

  if (!s.root || typeof s.root !== 'object') {
    errors.push('Missing or invalid root');
  } else {
    const root = s.root as Record<string, unknown>;
    if (root.type !== 'document') {
      errors.push('Root type must be "document"');
    }
    if (typeof root.id !== 'string') {
      errors.push('Root must have string id');
    }
  }

  if (!s.nodeIndex || typeof s.nodeIndex !== 'object') {
    warnings.push('Missing nodeIndex (will be rebuilt)');
  }

  if (!s.passageIndex || typeof s.passageIndex !== 'object') {
    warnings.push('Missing passageIndex (will be rebuilt)');
  }

  if (!s.eventLog || !Array.isArray(s.eventLog)) {
    warnings.push('Missing or invalid eventLog (will be empty)');
  }

  if (typeof s.lastModified !== 'string') {
    warnings.push('Missing lastModified (will use current time)');
  }

  if (typeof s.createdAt !== 'string') {
    warnings.push('Missing createdAt (will use current time)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// MIGRATION
// ============================================================================

/**
 * Apply schema migrations to bring state up to current version.
 */
function migrateState(serialized: SerializedDocumentState): DocumentState {
  const state = serialized.state;
  // schemaVersion is available for future migrations:
  // const version = serialized.schemaVersion;

  // Apply migrations in order
  // Currently at version 1, no migrations needed yet

  // Future migrations would look like:
  // if (version < 2) {
  //   state = migrateV1toV2(state);
  // }

  return state;
}
