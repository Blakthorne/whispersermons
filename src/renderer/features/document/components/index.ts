/**
 * Document Components - barrel export
 *
 * Node renderers for the 5 AST node types:
 * - document (DocumentRenderer)
 * - paragraph (ParagraphRenderer - also handles headingLevel/listStyle formatting)
 * - text (TextRenderer)
 * - quote (BiblePassageRenderer)
 * - interjection (InterjectionRenderer)
 *
 * Also includes the DocumentMetadataPanel for editing document properties.
 */

export { DocumentRenderer } from './DocumentRenderer';
export type { DocumentRendererProps } from './DocumentRenderer';

export { NodeRenderer } from './NodeRenderer';
export type { NodeRendererProps } from './NodeRenderer';

export { ParagraphRenderer } from './ParagraphRenderer';
export type { ParagraphRendererProps } from './ParagraphRenderer';

export { TextRenderer } from './TextRenderer';
export type { TextRendererProps } from './TextRenderer';

export { BiblePassageRenderer } from './BiblePassageRenderer';
export type { BiblePassageRendererProps } from './BiblePassageRenderer';

export { InterjectionRenderer } from './InterjectionRenderer';
export type { InterjectionRendererProps } from './InterjectionRenderer';

// Metadata editing panel
export { DocumentMetadataPanel, EditableTextField, TagsInput } from './DocumentMetadataPanel';
export type {
  DocumentMetadataPanelProps,
  EditableTextFieldProps,
  TagsInputProps,
} from './DocumentMetadataPanel';
