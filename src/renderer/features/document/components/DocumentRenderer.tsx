/**
 * DocumentRenderer - Main component for rendering a DocumentState
 *
 * This is the primary read-only rendering component for the Hybrid AST
 * architecture. It renders the full document tree with proper styling
 * and structure.
 *
 * Features:
 * - Renders full AST structure
 * - Handles legacy body-only format
 * - Shows metadata header (optional)
 * - Shows statistics bar (optional)
 * - Supports theming
 */

import React from 'react';
import { useDocument } from '../hooks';
import { NodeRenderer } from './NodeRenderer';
import type { QuoteBlockRenderer } from './QuoteBlockRenderer';
import type { DocumentNode } from '../../../../shared/documentModel';
import './DocumentRenderer.css';

export interface DocumentRendererProps {
  /** Optional className for the container */
  className?: string;
  /** Whether to show the metadata header (title, passage) */
  showMetadata?: boolean;
  /** Whether to show the statistics bar */
  showStatistics?: boolean;
  /** Options for quote rendering */
  quoteOptions?: Omit<React.ComponentProps<typeof QuoteBlockRenderer>, 'node' | 'className'>;
  /** Placeholder content when no document is loaded */
  emptyPlaceholder?: React.ReactNode;
}

/**
 * Default placeholder when no document is loaded.
 */
function DefaultPlaceholder(): React.JSX.Element {
  return (
    <div className="document-renderer-placeholder">
      <p>No document loaded.</p>
      <p className="document-renderer-placeholder-hint">
        Process an audio file with "Process as sermon" enabled to see the structured document view.
      </p>
    </div>
  );
}

/**
 * Statistics bar component.
 */
function StatisticsBar(): React.JSX.Element {
  const { statistics } = useDocument();

  if (!statistics) return <></>;

  return (
    <div className="document-stats">
      <span className="document-stat">
        <span className="document-stat-value">{statistics.wordCount.toLocaleString()}</span>
        <span> words</span>
      </span>
      <span className="document-stat">
        <span className="document-stat-value">{statistics.paragraphCount}</span>
        <span> paragraphs</span>
      </span>
      <span className="document-stat">
        <span className="document-stat-value">{statistics.passageCount}</span>
        <span> passages</span>
      </span>
      {statistics.interjectionCount > 0 && (
        <span className="document-stat">
          <span className="document-stat-value">{statistics.interjectionCount}</span>
          <span> interjections</span>
        </span>
      )}
    </div>
  );
}

/**
 * Metadata header component.
 */
function MetadataHeader(): React.JSX.Element {
  const { title, biblePassage } = useDocument();

  if (!title && !biblePassage) return <></>;

  return (
    <header className="document-metadata">
      {title && <h1 className="document-title">{title}</h1>}
      {biblePassage && (
        <p className="document-bible-passage">
          <span className="document-bible-passage-label">Primary Reference: </span>
          {biblePassage}
        </p>
      )}
    </header>
  );
}

/**
 * Main document content renderer.
 */
function DocumentContent({
  quoteOptions,
}: {
  quoteOptions?: DocumentRendererProps['quoteOptions'];
}): React.JSX.Element {
  const { root } = useDocument();

  if (!root) return <></>;

  // Render top-level children
  const renderChild = (child: DocumentNode): React.ReactNode => {
    return <NodeRenderer key={child.id} node={child} quoteOptions={quoteOptions} />;
  };

  return <>{root.children.map(renderChild)}</>;
}

/**
 * Main DocumentRenderer component.
 *
 * @example
 * ```tsx
 * <DocumentProvider sermonDocument={sermonDoc}>
 *   <DocumentRenderer
 *     showMetadata
 *     showStatistics
 *     quoteOptions={{ showTranslation: true }}
 *   />
 * </DocumentProvider>
 * ```
 */
export function DocumentRenderer({
  className,
  showMetadata = true,
  showStatistics = true,
  quoteOptions,
  emptyPlaceholder,
}: DocumentRendererProps): React.JSX.Element {
  const { hasDocument, isLegacy } = useDocument();

  // Build container class
  const containerClasses = ['document-renderer', 'document-renderer--readonly'];
  if (isLegacy) {
    containerClasses.push('document-renderer--legacy');
  }
  if (className) {
    containerClasses.push(className);
  }

  // Show placeholder if no document
  if (!hasDocument) {
    return (
      <div className={containerClasses.join(' ')}>{emptyPlaceholder ?? <DefaultPlaceholder />}</div>
    );
  }

  return (
    <article className={containerClasses.join(' ')}>
      {showMetadata && <MetadataHeader />}
      {showStatistics && <StatisticsBar />}
      <div className="document-body">
        <DocumentContent quoteOptions={quoteOptions} />
      </div>
    </article>
  );
}

export default DocumentRenderer;
