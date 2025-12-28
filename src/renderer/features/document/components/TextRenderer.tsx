/**
 * TextRenderer - Renders a TextNode
 *
 * Simple component that renders plain text content.
 */

import React from 'react';
import type { TextNode } from '../../../../shared/documentModel';

export interface TextRendererProps {
  /** The text node to render */
  node: TextNode;
  /** Optional className for styling */
  className?: string;
}

/**
 * Renders a TextNode as a span element.
 */
export function TextRenderer({ node, className }: TextRendererProps): React.JSX.Element {
  return (
    <span
      className={className ? `document-text ${className}` : 'document-text'}
      data-node-id={node.id}
    >
      {node.content}
    </span>
  );
}

export default TextRenderer;
