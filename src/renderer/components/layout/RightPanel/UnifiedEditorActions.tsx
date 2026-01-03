/**
 * UnifiedEditorActions - Shared action bar for editor modes
 *
 * Provides consistent actions across Editor and AST modes:
 * - Undo/Redo (AST-level, not TipTap-specific)
 * - Copy to clipboard
 * - Export/Save As
 * - Review Quotes toggle (disabled in AST mode)
 *
 * This component replaces the per-editor action buttons with a unified
 * experience that works regardless of which editor mode is active.
 */

import React from 'react';
import { Undo2, Redo2, Quote } from 'lucide-react';
import { Button } from '../../ui';
import { useAppTranscription, useQuoteReviewOptional } from '../../../contexts';
import type { DocumentSaveState } from '../../../contexts/types';
import './UnifiedEditorActions.css';

export type EditorMode = 'editor' | 'ast';

export interface UnifiedEditorActionsProps {
  /** Current active editor mode */
  activeMode: EditorMode;
  /** Word count to display */
  wordCount: number;
  /** Current document save state */
  saveState: DocumentSaveState;
  /** Timestamp of last successful save */
  lastSaved: Date | null;
  /** Whether content exists for copy/save operations */
  hasContent: boolean;
  /** Quote count for the review quotes button */
  quoteCount: number;
}

/**
 * Format relative time for last saved indicator
 */
function formatLastSaved(date: Date | null | undefined): string {
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  if (diffSecs < 10) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export function UnifiedEditorActions({
  activeMode,
  wordCount,
  saveState,
  lastSaved,
  hasContent,
  quoteCount,
}: UnifiedEditorActionsProps): React.JSX.Element {
  const { handleSave, handleCopy, copySuccess, canUndo, canRedo, handleUndo, handleRedo } =
    useAppTranscription();

  const quoteReview = useQuoteReviewOptional();
  const isQuotePanelOpen = quoteReview?.review.panelOpen ?? false;

  // Review Quotes is disabled in AST mode
  const isReviewQuotesEnabled = activeMode === 'editor' && quoteCount > 0;

  return (
    <div className="unified-editor-actions">
      <div className="unified-actions-left">
        {/* Undo/Redo buttons */}
        <div className="undo-redo-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            disabled={!canUndo}
            icon={<Undo2 size={16} />}
            title="Undo (⌘Z)"
            aria-label="Undo"
            className="undo-btn"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRedo}
            disabled={!canRedo}
            icon={<Redo2 size={16} />}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            className="redo-btn"
          />
        </div>

        <div className="action-divider" />

        {/* Word count */}
        <span className="word-count">{wordCount.toLocaleString()} words</span>

        {/* Document State Indicator */}
        <div className={`document-state-indicator state-${saveState}`}>
          {(saveState === 'saving' || saveState === 'auto-saving') && (
            <>
              <svg
                className="state-spinner"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span className="state-text">
                {saveState === 'auto-saving' ? 'Auto-saving...' : 'Saving...'}
              </span>
            </>
          )}
          {saveState === 'saved' && lastSaved && (
            <>
              <svg
                className="state-check"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="state-text">Saved {formatLastSaved(lastSaved)}</span>
            </>
          )}
        </div>
      </div>

      <div className="unified-actions-right">
        {/* Review Quotes button - disabled in AST mode */}
        {quoteReview && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!isQuotePanelOpen) {
                quoteReview.setReviewModeActive(true);
                quoteReview.setPanelOpen(true);
              } else {
                quoteReview.setPanelOpen(false);
              }
            }}
            disabled={!isReviewQuotesEnabled}
            active={isQuotePanelOpen && isReviewQuotesEnabled}
            icon={<Quote size={16} />}
            title={
              activeMode === 'ast'
                ? 'Review Quotes is disabled in AST mode'
                : `${isQuotePanelOpen ? 'Hide' : 'Show'} Quote Review Panel`
            }
            className="review-quotes-toggle"
          >
            Review Quotes{' '}
            {quoteCount > 0 && <span className="quote-count-badge">{quoteCount}</span>}
          </Button>
        )}

        {/* Copy button */}
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          disabled={!hasContent}
          className={copySuccess ? 'copied' : ''}
          title="Copy to Clipboard"
        >
          {copySuccess ? '✓ Copied!' : 'Copy'}
        </Button>

        {/* Save As dropdown */}
        <div className="save-dropdown">
          <Button variant="primary" size="sm" disabled={!hasContent} title="Save Document">
            Export
          </Button>
          <div className="save-menu">
            <button onClick={() => handleSave('txt')} type="button">
              Plain Text (.txt)
            </button>
            <button onClick={() => handleSave('md')} type="button">
              Markdown (.md)
            </button>
            <button onClick={() => handleSave('docx')} type="button">
              Word Document (.docx)
            </button>
            <button onClick={() => handleSave('pdf')} type="button">
              PDF (.pdf)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UnifiedEditorActions;
