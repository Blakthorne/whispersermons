/**
 * Document Components - barrel export
 *
 * Node renderers for the 5 AST node types:
 * - document (DocumentRenderer)
 * - paragraph (ParagraphRenderer - also handles headingLevel/listStyle formatting)
 * - text (TextRenderer)
 * - quote (QuoteBlockRenderer)
 * - interjection (InterjectionRenderer)
 */

export { DocumentRenderer } from './DocumentRenderer';
export type { DocumentRendererProps } from './DocumentRenderer';

export { NodeRenderer } from './NodeRenderer';
export type { NodeRendererProps } from './NodeRenderer';

export { ParagraphRenderer } from './ParagraphRenderer';
export type { ParagraphRendererProps } from './ParagraphRenderer';

export { TextRenderer } from './TextRenderer';
export type { TextRendererProps } from './TextRenderer';

export { QuoteBlockRenderer } from './QuoteBlockRenderer';
export type { QuoteBlockRendererProps } from './QuoteBlockRenderer';

export { InterjectionRenderer } from './InterjectionRenderer';
export type { InterjectionRendererProps } from './InterjectionRenderer';
