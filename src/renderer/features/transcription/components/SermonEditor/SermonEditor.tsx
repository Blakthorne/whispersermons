import React, { useCallback, useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import { Quote } from 'lucide-react';
import type { SermonDocument, OutputFormat } from '../../../../types';
import type { DocumentState } from '../../../../../shared/documentModel';
import { astToTipTapJson } from '../../../document/bridge/astTipTapConverter';
import { SermonToolbar } from './SermonToolbar';
import { Button } from '../../../../components/ui/Button';
import { useQuoteReviewOptional, useEditorActionsOptional, useAppTranscription } from '../../../../contexts';
import { QuoteBlockExtension } from './extensions/QuoteBlockExtension';
import { InterjectionMark } from './extensions/InterjectionMark';
import './SermonEditor.css';

/** Document save state for UI indicators */
export type DocumentSaveState = 'saved' | 'unsaved' | 'saving';

export interface SermonEditorProps {
  /** Sermon document data from pipeline processing */
  document: SermonDocument | null;
  /** Optional document state (AST) for quote-aware rendering */
  documentState?: DocumentState;
  /** Optional initial HTML content (for restoring from history) */
  initialHtml?: string;
  /** Callback when user exports the document */
  onSave: (format: OutputFormat) => void;
  /** Callback when copy button is clicked */
  onCopy: () => void;
  /** Whether copy was successful */
  copySuccess: boolean;
  /** Callback when HTML content changes (for persisting editor state) */
  onHtmlChange?: (html: string) => void;
  /** Callback when user clicks Save Edits button */
  onSaveEdits?: () => void;
  /** Current save state of the document */
  saveState?: DocumentSaveState;
  /** Timestamp of last successful save */
  lastSaved?: Date | null;
}

/**
 * Rich text WYSIWYG editor for sermon documents.
 * Uses TipTap editor with sermon-specific metadata display.
 * Supports optional DocumentState (AST) for quote-aware rendering.
 */
function SermonEditor({
  document,
  documentState,
  initialHtml,
  onSave,
  onCopy,
  copySuccess,
  onHtmlChange,
  onSaveEdits,
  saveState = 'saved',
  lastSaved,
}: SermonEditorProps): React.JSX.Element {
  const { visibleNodeId, setVisibleNodeId } = useAppTranscription();
  const isSelfScrollingRef = React.useRef(false);

  // Memoize extensions to prevent duplicate warnings
  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: false, // Disable built-in heading as we override it
      paragraph: false, // Disable built-in paragraph as we override it
    }),
    Paragraph.extend({
      addAttributes() {
        return {
          nodeId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-node-id'),
            renderHTML: (attrs) => {
              if (!attrs.nodeId) return {};
              return { 'data-node-id': attrs.nodeId };
            },
          },
        };
      },
    }),
    Heading.extend({
      addAttributes() {
        return {
          nodeId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-node-id'),
            renderHTML: (attrs) => {
              if (!attrs.nodeId) return {};
              return { 'data-node-id': attrs.nodeId };
            },
          },
        };
      },
    }).configure({
      levels: [1, 2, 3],
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'sermon-link',
      },
    }),
    Highlight.configure({
      multicolor: true,
      HTMLAttributes: {
        class: 'scripture-highlight',
      },
    }),
    Underline,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    QuoteBlockExtension,
    InterjectionMark,
  ], []);

  // Convert sermon document to TipTap content
  const defaultContent = useMemo(() => {
    // Priority 1: Use initialHtml if provided (for history restoration)
    if (initialHtml) {
      return initialHtml;
    }

    // Priority 2: Use documentState (AST) if available for quote-aware rendering
    // Only use AST if it has meaningful content (children nodes)
    if (documentState?.root && documentState.root.children.length > 0) {
      const result = astToTipTapJson(documentState.root, {
        preserveIds: true,
        includeMetadata: true,
        includeInterjections: true,
      });

      if (result.success && result.data) {
        return result.data;
      }
    }

    // Priority 3: Fallback to document.body if no AST or AST conversion failed
    if (!document) {
      return '<p>No sermon content available. Start by processing an audio file with "Process as sermon" enabled.</p>';
    }

    // Build HTML from sermon document
    let html = '';

    // Title - centered by default
    if (document.title) {
      html += `<h1 style="text-align: center">${escapeHtml(document.title)}</h1>`;
    }

    // Primary Reference (renamed from Scripture) - use plural if semicolon present
    if (document.biblePassage) {
      const hasMultiple = document.biblePassage.includes(';');
      const label = hasMultiple ? 'Primary References' : 'Primary Reference';
      html += `<p><strong>${label}:</strong> ${escapeHtml(document.biblePassage)}</p>`;
    }

    // References from the Sermon (renamed from References) - use semicolons, no highlighting
    if (document.references.length > 0) {
      const refsHtml = document.references.map((ref) => escapeHtml(ref)).join('; ');
      html += `<p><strong>References from the Sermon:</strong> ${refsHtml}</p>`;
    }

    // Tags section (below References from the Sermon) - comma-delimited, no hashtags
    if (document.tags.length > 0) {
      const tagsHtml = document.tags.map((tag) => escapeHtml(tag)).join(', ');
      html += `<p><strong>Tags:</strong> ${tagsHtml}</p>`;
    }

    // Speaker section (below Tags) - from audio metadata authors field
    if (document.speaker) {
      html += `<p><strong>Speaker:</strong> ${escapeHtml(document.speaker)}</p>`;
    }

    // Separator
    html += '<hr />';

    // Body content (preserve paragraphs)
    if (document.body) {
      const paragraphs = document.body.split('\n\n');
      paragraphs.forEach((para) => {
        const trimmed = para.trim();
        if (trimmed) {
          html += `<p>${escapeHtml(trimmed)}</p>`;
        }
      });
    }

    return html || '<p>Empty sermon document.</p>';
  }, [document, documentState, initialHtml]);

  const editor = useEditor({
    extensions,
    content: defaultContent,
    editable: true,
    onUpdate: ({ editor }) => {
      if (onHtmlChange) {
        onHtmlChange(editor.getHTML());
      }
    },
    // Prevent SSR hydration issues
    immediatelyRender: false,
  });

  // Register editor with EditorActionsContext for external components to use
  const editorActions = useEditorActionsOptional();
  useEffect(() => {
    if (editorActions) {
      editorActions.registerEditor(editor);
    }
    return () => {
      if (editorActions) {
        editorActions.registerEditor(null);
      }
    };
  }, [editor, editorActions]);

  const quoteReview = useQuoteReviewOptional();
  const quoteCount = quoteReview?.quotes.length || document?.processingMetadata?.quoteCount || 0;
  const isQuotePanelOpen = quoteReview?.review.panelOpen ?? false;

  // Update content when document changes
  useEffect(() => {
    if (editor && !initialHtml && document) {
      // Only update if document changed and we don't have initial HTML
      // (initialHtml means we're restoring from history)
      editor.commands.setContent(defaultContent);
    }
  }, [document, editor, defaultContent, initialHtml]);

  // Sync scroll from AST panel (visibleNodeId) to TipTap
  // Tracks which ID we last successfully scrolled to
  const lastSuccessfullyScrolledIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    let timer: any;
    let retryTimer: any;

    const performScrollSync = (retryCount = 0) => {
      if (!editor || !visibleNodeId || isSelfScrollingRef.current) return;

      const element = editor.view.dom.querySelector(`[data-node-id="${visibleNodeId}"]`) as HTMLElement;
      const container = editor.view.dom.closest('.sermon-editor-content') as HTMLElement;

      if (element && container) {
        isSelfScrollingRef.current = true;
        
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;
        const targetScrollTop = container.scrollTop + relativeTop - (containerRect.height / 2) + (elementRect.height / 2);
        
        container.scrollTo({
          top: targetScrollTop,
          behavior: retryCount > 0 ? 'auto' : 'smooth' // Use instant jump if it was a delayed sync for better feel
        });
        
        lastSuccessfullyScrolledIdRef.current = visibleNodeId;

        timer = setTimeout(() => {
          isSelfScrollingRef.current = false;
        }, 500);
      } else if (retryCount < 5) {
        // If element not found, it might still be rendering. Retry a few times.
        retryTimer = setTimeout(() => performScrollSync(retryCount + 1), 100 * (retryCount + 1));
      }
    };

    // Only trigger if the ID changed or if we haven't successfully scrolled to the current ID yet
    if (visibleNodeId !== lastSuccessfullyScrolledIdRef.current) {
      performScrollSync();
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [visibleNodeId, editor]);

  // Track scroll using IntersectionObserver to update visibleNodeId
  useEffect(() => {
    if (!editor || isSelfScrollingRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // CRITICAL: Check the ref inside the callback
        if (isSelfScrollingRef.current) return;

        // Find the topmost visible entry
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visibleEntries.length > 0) {
          const topEntry = visibleEntries[0];
          if (topEntry) {
            const nodeId = topEntry.target.getAttribute('data-node-id');
            if (nodeId && nodeId !== visibleNodeId) {
              isSelfScrollingRef.current = true;
              setVisibleNodeId(nodeId);
              setTimeout(() => {
                isSelfScrollingRef.current = false;
              }, 150);
            }
          }
        }
      },
      {
        root: editor.view.dom.parentElement,
        threshold: 0.1,
      }
    );

    // Observe all blocks with node IDs
    const registerBlocks = () => {
      const blocks = editor.view.dom.querySelectorAll('[data-node-id]');
      blocks.forEach((block) => observer.observe(block));
    };

    registerBlocks();

    // Re-register if content changes
    const mutationObserver = new MutationObserver(registerBlocks);
    mutationObserver.observe(editor.view.dom, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [editor, visibleNodeId, setVisibleNodeId]);

  // Sync HTML content to parent on initial load and content changes
  useEffect(() => {
    if (editor && onHtmlChange) {
      // Call onHtmlChange with initial content so exports work without editing
      onHtmlChange(editor.getHTML());
    }
  }, [editor, onHtmlChange]);

  // Get plain text for word count
  const textContent = editor?.getText() || '';
  const wordCount = textContent.trim() ? textContent.trim().split(/\s+/).length : 0;

  const hasContent = textContent.length > 0;

  // Get HTML content for copy/save operations
  const getHtmlContent = useCallback((): string => {
    return editor?.getHTML() || '';
  }, [editor]);

  const getPlainText = useCallback((): string => {
    return editor?.getText() || '';
  }, [editor]);

  // Format relative time for last saved
  const formatLastSaved = (date: Date | null | undefined): string => {
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
  };

  // Determine button text and icon based on save state
  const getSaveButtonContent = (): { text: string; icon: React.ReactNode } => {
    if (saveState === 'saving') {
      return {
        text: 'Saving...',
        icon: (
          <svg
            className="save-spinner"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ),
      };
    }
    if (saveState === 'saved') {
      return {
        text: 'Saved',
        icon: (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ),
      };
    }
    // unsaved state
    return {
      text: 'Save Edits',
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
      ),
    };
  };

  const { text: saveButtonText, icon: saveButtonIcon } = getSaveButtonContent();

  return (
    <div className="sermon-editor-container">
      {/* Action buttons header */}
      <div className="sermon-actions-header">
        <div className="sermon-actions-left">
          <span className="sermon-word-count">{wordCount.toLocaleString()} words</span>
          {/* Document State Indicator */}
          {onSaveEdits && (
            <div className={`document-state-indicator state-${saveState}`}>
              {saveState === 'unsaved' && (
                <>
                  <span className="state-dot" aria-hidden="true" />
                  <span className="state-text">Unsaved changes</span>
                </>
              )}
              {saveState === 'saving' && (
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
                  <span className="state-text">Saving...</span>
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
          )}
        </div>
        <div className="sermon-actions-right">
          {quoteReview && quoteCount > 0 && (
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
              active={isQuotePanelOpen}
              icon={<Quote size={16} />}
              title={`${isQuotePanelOpen ? 'Hide' : 'Show'} Quote Review Panel`}
              className="review-quotes-toggle"
            >
              Review Quotes{' '}
              {quoteCount > 0 && <span className="quote-count-badge">{quoteCount}</span>}
            </Button>
          )}

          {onSaveEdits && (
            <Button
              variant={saveState === 'unsaved' ? 'primary' : 'secondary'}
              size="sm"
              onClick={onSaveEdits}
              disabled={!hasContent || saveState === 'saving' || saveState === 'saved'}
              className={`save-edits-btn save-state-${saveState}`}
              title={
                saveState === 'saved'
                  ? 'All changes saved'
                  : saveState === 'saving'
                    ? 'Saving changes...'
                    : 'Save Edits to History'
              }
              icon={saveButtonIcon}
            >
              {saveButtonText}
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={onCopy}
            disabled={!hasContent}
            className={copySuccess ? 'copied' : ''}
            title="Copy to Clipboard"
          >
            {copySuccess ? '✓ Copied!' : 'Copy'}
          </Button>

          <div className="sermon-save-dropdown">
            <Button variant="primary" size="sm" disabled={!hasContent} title="Save Document">
              Save As...
            </Button>
            <div className="sermon-save-menu">
              <button onClick={() => onSave('txt')} type="button">
                Plain Text (.txt)
              </button>
              <button onClick={() => onSave('md')} type="button">
                Markdown (.md)
              </button>
              <button onClick={() => onSave('docx')} type="button">
                Word Document (.docx)
              </button>
              <button onClick={() => onSave('pdf')} type="button">
                PDF (.pdf)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <SermonToolbar editor={editor} getHtmlContent={getHtmlContent} getPlainText={getPlainText} />

      {/* Editor content */}
      <div className="sermon-editor-content editable">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// Helper function to escape HTML entities
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m] || m);
}

export { SermonEditor };
