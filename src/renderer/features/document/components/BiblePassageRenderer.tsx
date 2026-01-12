/**
 * BiblePassageRenderer - Renders a BiblePassageNode
 *
 * Renders Bible quotes with:
 * - Confidence-based styling
 * - Reference attribution
 * - Interjection handling
 * - Verification status indicator
 */

import React from 'react';
import type { PassageNode, ConfidenceLevel } from '../../../../shared/documentModel';
import { isTextNode, isInterjectionNode } from '../../../../shared/documentModel';
import { TextRenderer } from './TextRenderer';
import { InterjectionRenderer } from './InterjectionRenderer';

export interface BiblePassageRendererProps {
  /** The quote block node to render */
  node: PassageNode;
  /** Optional className for styling */
  className?: string;
  /** Whether to show the reference attribution (default: true) */
  showReference?: boolean;
  /** Whether to show the translation badge (default: true) */
  showTranslation?: boolean;
  /** Whether to show confidence indicator via styling (default: true) */
  showConfidence?: boolean;
  /** Whether to show verification status (default: true) */
  showVerification?: boolean;
  /** Custom reference formatter */
  formatReference?: (ref: string) => React.ReactNode;
}

/**
 * Get CSS class modifier for confidence level.
 */
function getConfidenceClass(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'document-bible-passage--high-confidence';
    case 'medium':
      return 'document-bible-passage--medium-confidence';
    case 'low':
      return 'document-bible-passage--low-confidence';
    default:
      return '';
  }
}

/**
 * Renders a BiblePassageNode as a blockquote element.
 */
export function BiblePassageRenderer({
  node,
  className,
  showConfidence = true,
  showVerification = true,
}: BiblePassageRendererProps): React.JSX.Element {
  const { metadata } = node;
  const { detection, userVerified } = metadata;

  // Build class names
  const classNames = ['document-bible-passage'];
  if (showConfidence && detection?.confidenceLevel) {
    classNames.push(getConfidenceClass(detection.confidenceLevel));
  }
  if (showVerification && userVerified) {
    classNames.push('document-bible-passage--verified');
  }
  if (className) {
    classNames.push(className);
  }

  // Render children (text and interjections)
  const renderChildren = (): React.ReactNode => {
    return node.children.map((child: any) => {
      if (isTextNode(child)) {
        return <TextRenderer key={child.id} node={child} />;
      }
      if (isInterjectionNode(child)) {
        return <InterjectionRenderer key={child.id} node={child} />;
      }
      return null;
    });
  };

  return (
    <div
      className={classNames.join(' ')}
      data-node-id={node.id}
      data-confidence={detection?.confidence?.toFixed(2) ?? '0.00'}
    >
      <div className="document-quote-content">&ldquo;{renderChildren()}&rdquo;</div>
    </div>
  );
}

export default BiblePassageRenderer;
