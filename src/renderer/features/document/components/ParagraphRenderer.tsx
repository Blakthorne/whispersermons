/**
 * ParagraphRenderer - Renders a ParagraphNode
 *
 * Renders paragraph content including nested nodes
 * (text, quotes, interjections, etc.).
 */

import React from 'react';
import type { ParagraphNode, DocumentNode } from '../../../../shared/documentModel';
import { isTextNode, isInterjectionNode, isQuoteBlockNode } from '../../../../shared/documentModel';
import { TextRenderer } from './TextRenderer';
import { InterjectionRenderer } from './InterjectionRenderer';
import { QuoteBlockRenderer } from './QuoteBlockRenderer';

export interface ParagraphRendererProps {
  /** The paragraph node to render */
  node: ParagraphNode;
  /** Optional className for styling */
  className?: string;
  /** Options passed to child renderers */
  quoteOptions?: Omit<React.ComponentProps<typeof QuoteBlockRenderer>, 'node' | 'className'>;
}

/**
 * Render a single child node.
 */
function renderChild(
  child: DocumentNode,
  quoteOptions?: ParagraphRendererProps['quoteOptions']
): React.ReactNode {
  if (isTextNode(child)) {
    return <TextRenderer key={child.id} node={child} />;
  }

  if (isInterjectionNode(child)) {
    return <InterjectionRenderer key={child.id} node={child} />;
  }

  if (isQuoteBlockNode(child)) {
    return <QuoteBlockRenderer key={child.id} node={child} {...quoteOptions} />;
  }

  // Unknown node type - render nothing but log warning
  console.warn(`Unknown node type in paragraph: ${child.type}`);
  return null;
}

/**
 * Renders a ParagraphNode as a p element.
 */
export function ParagraphRenderer({
  node,
  className,
  quoteOptions,
}: ParagraphRendererProps): React.JSX.Element {
  const baseClass = 'document-paragraph';
  const fullClass = className ? `${baseClass} ${className}` : baseClass;

  return (
    <p className={fullClass} data-node-id={node.id}>
      {node.children.map((child) => renderChild(child, quoteOptions))}
    </p>
  );
}

export default ParagraphRenderer;
