/**
 * QuoteBlockRenderer - Renders a QuoteBlockNode
 *
 * Renders Bible quotes with:
 * - Confidence-based styling
 * - Reference attribution
 * - Interjection handling
 * - Verification status indicator
 */

import React from 'react';
import type { QuoteBlockNode, ConfidenceLevel } from '../../../../shared/documentModel';
import { isTextNode, isInterjectionNode } from '../../../../shared/documentModel';
import { TextRenderer } from './TextRenderer';
import { InterjectionRenderer } from './InterjectionRenderer';

export interface QuoteBlockRendererProps {
  /** The quote block node to render */
  node: QuoteBlockNode;
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
      return 'document-quote-block--high-confidence';
    case 'medium':
      return 'document-quote-block--medium-confidence';
    case 'low':
      return 'document-quote-block--low-confidence';
    default:
      return '';
  }
}

/**
 * Renders a QuoteBlockNode as a blockquote element.
 */
export function QuoteBlockRenderer({
  node,
  className,
  showReference = true,
  showTranslation = true,
  showConfidence = true,
  showVerification = true,
  formatReference,
}: QuoteBlockRendererProps): React.JSX.Element {
  const { metadata } = node;
  const { reference, detection, userVerified } = metadata;

  // Build class names
  const classNames = ['document-quote-block'];
  if (showConfidence) {
    classNames.push(getConfidenceClass(detection.confidenceLevel));
  }
  if (showVerification && userVerified) {
    classNames.push('document-quote-block--verified');
  }
  if (className) {
    classNames.push(className);
  }

  // Render children (text and interjections)
  const renderChildren = (): React.ReactNode => {
    return node.children.map((child) => {
      if (isTextNode(child)) {
        return <TextRenderer key={child.id} node={child} />;
      }
      if (isInterjectionNode(child)) {
        return <InterjectionRenderer key={child.id} node={child} />;
      }
      return null;
    });
  };

  // Format reference text
  const referenceText = reference.normalizedReference;
  const referenceNode = formatReference ? formatReference(referenceText) : referenceText;

  return (
    <blockquote
      className={classNames.join(' ')}
      data-node-id={node.id}
      data-reference={referenceText}
      data-confidence={detection.confidence.toFixed(2)}
    >
      <div className="document-quote-content">{renderChildren()}</div>

      {showReference && (
        <cite className="document-quote-reference">
          <span className="document-quote-reference-link">{referenceNode}</span>
          {showTranslation && detection.translation && (
            <span className="document-quote-translation">({detection.translation})</span>
          )}
        </cite>
      )}
    </blockquote>
  );
}

export default QuoteBlockRenderer;
