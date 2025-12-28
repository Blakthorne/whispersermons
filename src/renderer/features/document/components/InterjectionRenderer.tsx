/**
 * InterjectionRenderer - Renders an InterjectionNode
 *
 * Interjections are inline comments/reactions within quotes
 * (e.g., "amen?", "a what?", "glory!").
 */

import React from 'react';
import type { InterjectionNode } from '../../../../shared/documentModel';

export interface InterjectionRendererProps {
  /** The interjection node to render */
  node: InterjectionNode;
  /** Optional className for styling */
  className?: string;
  /** Whether to show brackets around the text (default: handled by CSS) */
  showBrackets?: boolean;
}

/**
 * Renders an InterjectionNode as an inline element.
 */
export function InterjectionRenderer({
  node,
  className,
  showBrackets = false,
}: InterjectionRendererProps): React.JSX.Element {
  const baseClass = 'document-interjection';
  const fullClass = className ? `${baseClass} ${className}` : baseClass;

  return (
    <span className={fullClass} data-node-id={node.id} title="Interjection">
      {showBrackets ? `[${node.content}]` : node.content}
    </span>
  );
}

export default InterjectionRenderer;
