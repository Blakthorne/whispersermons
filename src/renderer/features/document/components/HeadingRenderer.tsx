/**
 * HeadingRenderer - Renders a HeadingNode
 *
 * Renders heading content with appropriate HTML heading level.
 */

import React from 'react';
import type { HeadingNode, DocumentNode } from '../../../../shared/documentModel';
import { isTextNode } from '../../../../shared/documentModel';
import { TextRenderer } from './TextRenderer';

export interface HeadingRendererProps {
  /** The heading node to render */
  node: HeadingNode;
  /** Optional className for styling */
  className?: string;
}

/**
 * Render heading children (typically just text).
 */
function renderChildren(children: DocumentNode[]): React.ReactNode {
  return children.map((child) => {
    if (isTextNode(child)) {
      return <TextRenderer key={child.id} node={child} />;
    }
    return null;
  });
}

/**
 * Renders a HeadingNode as the appropriate h1-h6 element.
 */
export function HeadingRenderer({ node, className }: HeadingRendererProps): React.JSX.Element {
  const baseClass = 'document-heading';
  const levelClass = `document-heading--level-${node.level}`;
  const fullClass = className
    ? `${baseClass} ${levelClass} ${className}`
    : `${baseClass} ${levelClass}`;

  const HeadingTag = `h${node.level}` as keyof React.JSX.IntrinsicElements;

  return (
    <HeadingTag className={fullClass} data-node-id={node.id}>
      {renderChildren(node.children)}
    </HeadingTag>
  );
}

export default HeadingRenderer;
