# WhisperDesk Document Model - AI Coding Instructions

## Architecture Overview

WhisperDesk uses a **Hybrid AST + Event Log** architecture for sermon document editing. This system provides:

- **Stable node identities** for reliable undo/redo and collaboration
- **Event sourcing** for complete edit history
- **TipTap bridge** for WYSIWYG editing compatibility
- **Quote metadata preservation** across edits

### Core Design Principles

1. **AST is Source of Truth**: The document tree (`DocumentState.root`) is the canonical representation
2. **Events are Immutable**: All mutations produce events that can be replayed
3. **Indexes are Derived**: `nodeIndex`, `quoteIndex`, and `extracted` are rebuilt from the tree
4. **TipTap is a View**: The editor syncs bidirectionally with the AST

## Key Types (src/shared/documentModel.ts)

### Node Types

```typescript
// Base node with stable identity
interface BaseNode {
  id: NodeId; // Branded string type for type safety
  type: string;
  createdAt?: string;
  updatedAt?: string;
}

// Document root - top-level container
interface DocumentRootNode extends BaseNode {
  type: 'document';
  version: number;
  title?: string;
  biblePassage?: string;
  children: DocumentNode[];
}

// Content nodes
interface ParagraphNode extends BaseNode {
  type: 'paragraph';
  children: (TextNode | InterjectionNode)[];
}

interface QuoteBlockNode extends BaseNode {
  type: 'quote_block';
  reference: string; // e.g., "John 3:16"
  book: string; // e.g., "John"
  confidence: number; // 0-1 detection confidence
  verseText: string; // The actual quote text
  children: TextNode[];
}

interface HeadingNode extends BaseNode {
  type: 'heading';
  level: 1 | 2 | 3;
  children: TextNode[];
}

// Leaf nodes
interface TextNode extends BaseNode {
  type: 'text';
  content: string;
  marks?: TextMark[];
}

interface InterjectionNode extends BaseNode {
  type: 'interjection';
  content: string; // e.g., "Amen", "Hallelujah"
  originalIndex: number; // Position in original transcript
}
```

### Document State

```typescript
interface DocumentState {
  version: number;
  root: DocumentRootNode;
  eventLog: DocumentEvent[];
  undoStack: DocumentEvent[][];
  redoStack: DocumentEvent[][];
  nodeIndex: Record<NodeId, NodeIndexEntry>;
  quoteIndex: QuoteIndex;
  extracted: { references: string[]; tags: string[] };
  lastModified: string;
  createdAt: string;
}
```

### Event Types

```typescript
type DocumentEvent =
  | NodeCreatedEvent
  | NodeDeletedEvent
  | NodeMovedEvent
  | TextChangedEvent
  | QuoteConvertedEvent
  | QuoteUnconvertedEvent
  | MetadataChangedEvent
  | BatchEvent;

// All events have:
interface BaseEvent {
  id: EventId;
  type: string;
  timestamp: string;
  resultingVersion: number;
  source: 'system' | 'user' | 'import';
}
```

## Module Organization (src/renderer/features/document/)

```
document/
├── index.ts                 # Barrel exports
├── types/
│   └── index.ts            # Re-exports from shared/documentModel
├── state/
│   ├── documentReducer.ts  # Pure state transitions
│   └── DocumentManager.ts  # Singleton state manager
├── events/
│   └── eventFactory.ts     # Type-safe event creation
├── mutations/
│   └── DocumentMutator.ts  # High-level mutation API
├── serialization/
│   ├── eventSerializer.ts  # Event JSON handling
│   └── stateSerializer.ts  # Full/compact state serialization
├── bridge/
│   ├── astTipTapConverter.ts # AST ↔ TipTap conversion
│   └── editorSync.ts       # Sync coordination
├── history/
│   └── documentHistory.ts  # History persistence
├── hooks/
│   ├── useDocumentState.ts # React state binding
│   ├── useDocumentMutator.ts # Mutation hook
│   └── useDocumentEditor.ts # Combined editor hook
└── components/
    └── ...                 # UI components
```

## Common Patterns

### Creating a New Document

```typescript
import { createDocumentState, createDocumentRootNode } from '@/features/document';

// From scratch
const root = createDocumentRootNode([], {
  title: 'Sermon Title',
  biblePassage: 'John 3:16',
});
const state = createDocumentState(root);

// From existing content (e.g., Python processor output)
const state = createDocumentState(existingRoot);
```

### Using the Mutator Hook

```typescript
import { useDocumentMutator } from '@/features/document';

function MyComponent() {
  const { state, mutator, canUndo, canRedo } = useDocumentMutator(initialState);

  // Add a paragraph
  const handleAddParagraph = () => {
    mutator.insertParagraph(parentId, index, 'New paragraph text');
  };

  // Update text
  const handleTextChange = (nodeId: NodeId, newText: string) => {
    mutator.updateText(nodeId, newText);
  };

  // Convert to quote
  const handleConvertToQuote = (nodeId: NodeId) => {
    mutator.convertToQuote(nodeId, {
      reference: 'John 3:16',
      book: 'John',
      confidence: 0.95,
    });
  };

  // Undo/Redo
  const handleUndo = () => mutator.undo();
  const handleRedo = () => mutator.redo();
}
```

### Working with Node IDs

```typescript
import { createNodeId, isNodeId } from '@/features/document';

// Create a new ID (uses nanoid internally)
const newId = createNodeId(); // e.g., "node_abc123xyz"

// Validate an ID
if (isNodeId(someString)) {
  // TypeScript now knows someString is NodeId
}

// Find a node by ID
const entry = state.nodeIndex[nodeId];
if (entry) {
  const node = entry.node;
  const parentId = entry.parentId;
  const path = entry.path; // Array of ancestor IDs
}
```

### Serialization for Storage

```typescript
import {
  fullSerialize,
  fullDeserialize,
  compactSerialize,
  compactDeserialize,
} from '@/features/document';

// Full serialization (preserves everything including indexes)
const json = fullSerialize(state);
const restored = fullDeserialize(json);

// Compact serialization (smaller, rebuilds indexes on load)
const compactJson = compactSerialize(state);
const restoredCompact = compactDeserialize(compactJson);
```

### History Integration

```typescript
import {
  createHistoryItemWithState,
  restoreFromHistoryItem,
  hasDocumentState,
} from '@/features/document';

// Save to history
const historyData = createHistoryItemWithState(baseHistoryItem, documentState);

// Restore from history
const result = restoreFromHistoryItem(historyItem);
if (result.success && result.state) {
  // Use result.state
} else if (result.isLegacy && result.legacyHtml) {
  // Fall back to HTML conversion
}
```

### TipTap Bridge

```typescript
import { astToTipTapJson, tipTapJsonToAst, astToHtml, htmlToAst } from '@/features/document';

// Convert AST to TipTap for editing
const tipTapResult = astToTipTapJson(state.root);
if (tipTapResult.success) {
  editor.commands.setContent(tipTapResult.data);
}

// Convert TipTap back to AST after editing
const astResult = tipTapJsonToAst(editor.getJSON());
if (astResult.success) {
  // Sync changes back to state
}

// HTML conversion (for export/import)
const htmlResult = astToHtml(state.root);
const fromHtmlResult = htmlToAst(htmlString);
```

## Event Factory Usage

Always use the event factory for creating events - never construct event objects manually:

```typescript
import {
  createNodeCreatedEvent,
  createTextChangedEvent,
  createQuoteConvertedEvent,
  createBatchEvent,
} from '@/features/document';

// Creating events
const event = createNodeCreatedEvent({
  node: newParagraphNode,
  parentId: 'root-1' as NodeId,
  index: 0,
  resultingVersion: state.version + 1,
  source: 'user',
});

// Batch multiple operations
const batchEvent = createBatchEvent({
  events: [event1, event2, event3],
  resultingVersion: state.version + 1,
  source: 'user',
});
```

## Testing Patterns

### Test Helper Functions

Each test file should define local helper functions for creating test fixtures:

```typescript
// DO: Define helpers locally in test files
function createTextNode(id: string, content: string): TextNode {
  return {
    id: id as NodeId,
    type: 'text',
    content,
  };
}

function createParagraphNode(id: string, children: TextNode[]): ParagraphNode {
  return {
    id: id as NodeId,
    type: 'paragraph',
    children,
  };
}

// DON'T: Import test helpers from production code
// The events module exports are for production use only
```

### Testing Events

```typescript
describe('Document Events', () => {
  it('should create valid NodeCreatedEvent', () => {
    const textNode = createTextNode('text-1', 'Hello');
    const paragraph = createParagraphNode('para-1', [textNode]);

    const event = createNodeCreatedEvent({
      node: paragraph,
      parentId: 'root-1' as NodeId,
      index: 0,
      resultingVersion: 1,
      source: 'user',
    });

    expect(event.type).toBe('node_created');
    expect(event.node).toBe(paragraph);
    expect(event.parentId).toBe('root-1');
  });
});
```

### Testing State Transitions

```typescript
describe('Document Reducer', () => {
  it('should handle node creation', () => {
    const initialState = createTestDocumentState();
    const event = createNodeCreatedEvent({ ... });

    const newState = documentReducer(initialState, event);

    expect(newState.version).toBe(initialState.version + 1);
    expect(newState.nodeIndex[event.node.id]).toBeDefined();
  });
});
```

## Important Constraints

### Node ID Stability

- **Never** change a node's ID after creation
- **Never** reuse IDs from deleted nodes
- Use `createNodeId()` for all new nodes

### Event Immutability

- Events are **append-only** in the event log
- **Never** modify events after creation
- Undo/redo uses event groups, not event modification

### Index Consistency

- **Always** update indexes through the reducer
- **Never** manually modify `nodeIndex` or `quoteIndex`
- Indexes are rebuilt on deserialization

### TipTap Sync Direction

- For user edits: TipTap → AST (via `tipTapJsonToAst`)
- For programmatic changes: AST → TipTap (via `astToTipTapJson`)
- **Never** sync both directions simultaneously (causes loops)

## Integration with Python Backend

The Python backend (`src/python/`) produces the initial document structure:

```python
# Python outputs DocumentState-compatible JSON
{
    "root": {
        "id": "root-...",
        "type": "document",
        "version": 1,
        "title": "...",
        "children": [...]
    },
    "eventLog": [],
    "nodeIndex": {...},
    "quoteIndex": {...},
    ...
}
```

The renderer receives this via IPC and initializes the document state:

```typescript
// In transcription completion handler
const pythonOutput = await window.electronAPI.transcribe(...);
if (pythonOutput.sermonDocument?.documentState) {
  const state = pythonOutput.sermonDocument.documentState;
  // Initialize editor with state
}
```

## Debugging Tips

### Inspect Document State

```typescript
// Log full state (be careful with large documents)
console.log('Document State:', JSON.stringify(state, null, 2));

// Log specific node
const entry = state.nodeIndex[nodeId];
console.log('Node:', entry?.node);
console.log('Parent:', entry?.parentId);
console.log('Path:', entry?.path);
```

### Trace Event Flow

```typescript
// Log events as they're applied
const event = createNodeCreatedEvent({...});
console.log('Applying event:', event.type, event.id);
const newState = documentReducer(state, event);
console.log('New version:', newState.version);
```

### Validate State Integrity

```typescript
import { validateDocumentState } from '@/features/document';

const validation = validateDocumentState(state);
if (!validation.valid) {
  console.error('Invalid state:', validation.errors);
}
```

## File Locations Quick Reference

| Concern          | File                                                          |
| ---------------- | ------------------------------------------------------------- |
| Type definitions | `src/shared/documentModel.ts`                                 |
| State reducer    | `src/renderer/features/document/state/documentReducer.ts`     |
| Event factory    | `src/renderer/features/document/events/eventFactory.ts`       |
| Mutation API     | `src/renderer/features/document/mutations/DocumentMutator.ts` |
| React hooks      | `src/renderer/features/document/hooks/`                       |
| Serialization    | `src/renderer/features/document/serialization/`               |
| TipTap bridge    | `src/renderer/features/document/bridge/`                      |
| History utils    | `src/renderer/features/document/history/`                     |
| Tests            | `src/renderer/features/document/__tests__/`                   |

## Related Documentation

- Main project instructions: `.github/copilot-instructions.md`
- Type definitions: `src/shared/documentModel.ts` (comprehensive JSDoc)
- Test files: Serve as usage examples for each module
