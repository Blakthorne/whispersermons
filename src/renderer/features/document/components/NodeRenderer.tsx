/**
 * NodeRenderer - Generic renderer that dispatches to specific renderers
 *
 * This component takes any DocumentNode and renders the appropriate
 * specialized component based on node type.
 */

import React from 'react';
import type { DocumentNode } from '../../../../shared/documentModel';
import {
  isTextNode,
  isParagraphNode,
  isQuoteBlockNode,
  isInterjectionNode,
  isHeadingNode,
} from '../../../../shared/documentModel';
import { TextRenderer } from './TextRenderer';
import { ParagraphRenderer } from './ParagraphRenderer';
import { QuoteBlockRenderer } from './QuoteBlockRenderer';
import { InterjectionRenderer } from './InterjectionRenderer';
import { HeadingRenderer } from './HeadingRenderer';

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
    return <ParagraphRenderer node={node} className={className} quoteOptions={quoteOptions} />;
  }

  if (isQuoteBlockNode(node)) {
    return <QuoteBlockRenderer node={node} className={className} {...quoteOptions} />;
  }

  if (isInterjectionNode(node)) {
    return <InterjectionRenderer node={node} className={className} />;
  }

  if (isHeadingNode(node)) {
    return <HeadingRenderer node={node} className={className} />;
  }

  // Document root or unknown types - log warning
  if (node.type !== 'document') {
    console.warn(`NodeRenderer: Unhandled node type: ${node.type}`);
  }

  return null;
}

export default NodeRenderer;
