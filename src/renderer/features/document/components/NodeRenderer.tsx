/**
 * NodeRenderer - Generic renderer that dispatches to specific renderers
 *
 * This component takes any DocumentNode and renders the appropriate
 * specialized component based on node type.
 *
 * Node types: document, paragraph, text, quote, interjection
 * Headings and lists are formatting on ParagraphNode (headingLevel, listStyle)
 */

import React from 'react';
import type { DocumentNode } from '../../../../shared/documentModel';
import {
  isTextNode,
  isParagraphNode,
  isPassageNode,
  isInterjectionNode,
} from '../../../../shared/documentModel';
import { TextRenderer } from './TextRenderer';
import { ParagraphRenderer } from './ParagraphRenderer';
import { QuoteBlockRenderer } from './QuoteBlockRenderer';
import { InterjectionRenderer } from './InterjectionRenderer';

export interface NodeRendererProps {
  /** The node to render */
  node: DocumentNode;
  /** Optional className for styling */
  className?: string;
  /** Options for quote rendering */
  quoteOptions?: Omit<React.ComponentProps<typeof QuoteBlockRenderer>, 'node' | 'className'>;
}

/**
 * Renders any DocumentNode by dispatching to the appropriate renderer.
 *
 * Valid node types:
 * - document: Root container (not rendered directly)
 * - paragraph: Text container, may have headingLevel or listStyle formatting
 * - text: Leaf text content with optional marks
 * - quote: Scripture/source quote block
 * - interjection: Editorial notes [in brackets]
 */
export function NodeRenderer({
  node,
  className,
  quoteOptions,
}: NodeRendererProps): React.JSX.Element | null {
  if (isTextNode(node)) {
    return <TextRenderer node={node} className={className} />;
  }

  if (isParagraphNode(node)) {
    // ParagraphRenderer handles headingLevel and listStyle formatting
    return <ParagraphRenderer node={node} className={className} quoteOptions={quoteOptions} />;
  }

  if (isPassageNode(node)) {
    return <QuoteBlockRenderer node={node} className={className} {...quoteOptions} />;
  }

  if (isInterjectionNode(node)) {
    return <InterjectionRenderer node={node} className={className} />;
  }

  // Document root or unknown types - log warning
  // TypeScript exhaustive narrowing considers this unreachable, but handle gracefully
  const nodeType = (node as { type?: string }).type;
  if (nodeType !== 'document') {
    console.warn(`NodeRenderer: Unhandled node type: ${nodeType}`);
  }

  return null;
}

export default NodeRenderer;
