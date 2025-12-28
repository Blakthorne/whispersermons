/**
 * Event Serializer
 *
 * Handles serialization and deserialization of DocumentEvents.
 * Events are already JSON-compatible, but this module provides
 * validation and type safety.
 */

import type { DocumentEvent, EventId } from '../../../../shared/documentModel';

/**
 * Serialize a single event to JSON string.
 */
export function serializeEvent(event: DocumentEvent): string {
  return JSON.stringify(event);
}

/**
 * Deserialize a JSON string to a DocumentEvent.
 * Returns null if parsing fails or event is invalid.
 */
export function deserializeEvent(json: string): DocumentEvent | null {
  try {
    const parsed = JSON.parse(json);
    if (!isValidEvent(parsed)) {
      return null;
    }
    return parsed as DocumentEvent;
  } catch {
    return null;
  }
}

/**
 * Serialize an array of events to JSON string.
 */
export function serializeEventLog(events: DocumentEvent[]): string {
  return JSON.stringify(events);
}

/**
 * Deserialize a JSON string to an array of DocumentEvents.
 * Returns empty array if parsing fails. Invalid events are filtered out.
 */
export function deserializeEventLog(json: string): DocumentEvent[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidEvent) as DocumentEvent[];
  } catch {
    return [];
  }
}

/**
 * Validate that a parsed object is a valid DocumentEvent.
 */
function isValidEvent(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const event = obj as Record<string, unknown>;

  // Check required base event fields
  if (typeof event.id !== 'string' || !event.id.startsWith('evt-')) {
    return false;
  }
  if (typeof event.type !== 'string') {
    return false;
  }
  if (typeof event.timestamp !== 'string') {
    return false;
  }
  if (typeof event.resultingVersion !== 'number') {
    return false;
  }
  if (typeof event.source !== 'string') {
    return false;
  }

  // Validate based on event type
  return isValidEventType(event.type as string);
}

/**
 * List of valid event types.
 */
const VALID_EVENT_TYPES = [
  'node_created',
  'node_deleted',
  'node_moved',
  'text_changed',
  'content_replaced',
  'quote_created',
  'quote_removed',
  'quote_metadata_updated',
  'quote_verified',
  'interjection_added',
  'interjection_removed',
  'nodes_joined',
  'node_split',
  'paragraph_merged',
  'paragraph_split',
  'document_created',
  'document_metadata_updated',
  'document_imported',
  'batch',
  'undo',
  'redo',
] as const;

function isValidEventType(type: string): boolean {
  return VALID_EVENT_TYPES.includes(type as typeof VALID_EVENT_TYPES[number]);
}

/**
 * Extract event IDs from an event log.
 */
export function extractEventIds(events: DocumentEvent[]): EventId[] {
  return events.map((e) => e.id);
}

/**
 * Filter events by type.
 */
export function filterEventsByType<T extends DocumentEvent['type']>(
  events: DocumentEvent[],
  type: T
): Extract<DocumentEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<DocumentEvent, { type: T }>[];
}

/**
 * Get the latest version from an event log.
 */
export function getLatestVersion(events: DocumentEvent[]): number {
  if (events.length === 0) {
    return 0;
  }
  return Math.max(...events.map((e) => e.resultingVersion));
}
