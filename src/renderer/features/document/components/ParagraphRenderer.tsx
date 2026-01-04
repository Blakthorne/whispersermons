/**
 * ParagraphRenderer - Renders a ParagraphNode
 *
 * Renders paragraph content including nested nodes (text, quotes, interjections).
 * Also handles formatting properties:
 * - headingLevel: Renders as h1/h2/h3 element
 * - listStyle: Renders as list item in bullet/ordered list
 */

import React from 'react';
import type { ParagraphNode, DocumentNode } from '../../../../shared/documentModel';
import { isTextNode, isInterjectionNode, isPassageNode } from '../../../../shared/documentModel';
import { TextRenderer } from './TextRenderer';
import { InterjectionRenderer } from './InterjectionRenderer';
import { BiblePassageRenderer } from './BiblePassageRenderer';

export interface ParagraphRendererProps {
  /** The paragraph node to render */
  node: ParagraphNode;
  /** Optional className for styling */
  className?: string;
  /** Options passed to child renderers */
  quoteOptions?: Omit<React.ComponentProps<typeof BiblePassageRenderer>, 'node' | 'className'>;
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

  if (isPassageNode(child)) {
    return <BiblePassageRenderer key={child.id} node={child} {...quoteOptions} />;
  }

  // Unknown node type - render nothing but log warning
  console.warn(`Unknown node type in paragraph: ${child.type}`);
  return null;
}

/**
 * Renders a ParagraphNode.
 *
 * Rendering varies based on formatting properties:
 * - With headingLevel: renders as h1/h2/h3
 * - With listStyle: renders as li (parent component wraps in ul/ol)
 * - Plain: renders as p
 */
export function ParagraphRenderer({
  node,
  className,
  quoteOptions,
}: ParagraphRendererProps): React.JSX.Element {
  const children = node.children.map((child) => renderChild(child, quoteOptions));

  // Handle heading formatting
  if (node.headingLevel) {
    const HeadingTag = `h${node.headingLevel}` as 'h1' | 'h2' | 'h3';
    const baseClass = 'document-heading';
    const levelClass = `document-heading--level-${node.headingLevel}`;
    const alignClass = node.textAlign ? `text-align-${node.textAlign}` : '';
    const fullClass = [baseClass, levelClass, alignClass, className].filter(Boolean).join(' ');

    return (
      <HeadingTag className={fullClass} data-node-id={node.id}>
        {children}
      </HeadingTag>
    );
  }

  // Handle list item formatting
  if (node.listStyle) {
    const baseClass = 'document-list-item';
    const styleClass = `document-list-item--${node.listStyle}`;
    const depthClass = node.listDepth ? `document-list-item--depth-${node.listDepth}` : '';
    const alignClass = node.textAlign ? `text-align-${node.textAlign}` : '';
    const fullClass = [baseClass, styleClass, depthClass, alignClass, className]
      .filter(Boolean)
      .join(' ');

    return (
      <li
        className={fullClass}
        data-node-id={node.id}
        data-list-number={node.listNumber}
        value={node.listStyle === 'ordered' ? node.listNumber : undefined}
      >
        {children}
      </li>
    );
  }

  // Plain paragraph
  const baseClass = 'document-paragraph';
  const alignClass = node.textAlign ? `text-align-${node.textAlign}` : '';
  const fullClass = [baseClass, alignClass, className].filter(Boolean).join(' ');

  return (
    <p className={fullClass} data-node-id={node.id}>
      {children}
    </p>
  );
}

export default ParagraphRenderer;
