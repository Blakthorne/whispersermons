/**
 * Document Serialization Module
 *
 * Phase D: Provides utilities for serializing and deserializing DocumentState
 * to/from JSON for localStorage persistence and history storage.
 *
 * Key features:
 * - Compact serialization (removes derived indexes, keeps only essential data)
 * - Full serialization (preserves complete state including indexes)
 * - Validation and schema migration for backward compatibility
 * - Safe deserialization with error handling
 *
 * @example
 * ```typescript
 * import {
 *   serializeDocumentState,
 *   deserializeDocumentState,
 *   compactSerialize,
 * } from '../features/document/serialization';
 *
 * // Save to localStorage
 * const serialized = serializeDocumentState(state);
 * localStorage.setItem('document', serialized);
 *
 * // Load from localStorage
 * const restored = deserializeDocumentState(localStorage.getItem('document'));
 * ```
 */

export {
  serializeDocumentState,
  deserializeDocumentState,
  compactSerialize,
  compactDeserialize,
  validateDocumentState,
  type SerializedDocumentState,
  type CompactDocumentState,
  type SerializationOptions,
  type DeserializationResult,
  type ValidationResult,
} from './stateSerializer';

export {
  serializeEvent,
  deserializeEvent,
  serializeEventLog,
  deserializeEventLog,
} from './eventSerializer';
