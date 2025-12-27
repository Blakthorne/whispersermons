import React, { useCallback, useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import type { SermonDocument, OutputFormat } from '../../../../types';
import { SermonToolbar } from './SermonToolbar';
import './SermonEditor.css';

export interface SermonEditorProps {
  /** Sermon document data from pipeline processing */
  document: SermonDocument | null;
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
}

/**
 * Rich text WYSIWYG editor for sermon documents.
 * Uses TipTap editor with sermon-specific metadata display.
 */
function SermonEditor({
  document,
  initialHtml,
  onSave,
  onCopy,
  copySuccess,
  onHtmlChange,
  onSaveEdits,
}: SermonEditorProps): React.JSX.Element {
  // Convert sermon document to HTML if no initialHtml provided
  const defaultContent = useMemo(() => {
    if (initialHtml) {
      return initialHtml;
    }

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
  }, [document, initialHtml]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
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
    ],
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

  // Update content when document changes
  useEffect(() => {
    if (editor && !initialHtml && document) {
      // Only update if document changed and we don't have initial HTML
      // (initialHtml means we're restoring from history)
      editor.commands.setContent(defaultContent);
    }
  }, [document, editor, defaultContent, initialHtml]);

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

  return (
    <div className="sermon-editor-container">
      {/* Action buttons header */}
      <div className="sermon-actions-header">
        <div className="sermon-actions-left">
          <span className="sermon-word-count">{wordCount.toLocaleString()} words</span>
        </div>
        <div className="sermon-actions-right">
          {onSaveEdits && (
            <button
              onClick={onSaveEdits}
              disabled={!hasContent}
              className="sermon-action-btn save-edits-btn"
              title="Save Edits to History"
              type="button"
            >
              <svg
                width="16"
                height="16"
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
              Save Edits
            </button>
          )}

          <button
            onClick={onCopy}
            disabled={!hasContent}
            className="sermon-action-btn copy-btn"
            title="Copy to Clipboard"
            type="button"
          >
            {copySuccess ? '✓ Copied!' : 'Copy'}
          </button>

          <div className="sermon-save-dropdown">
            <button
              disabled={!hasContent}
              className="sermon-action-btn export-btn"
              title="Save Document"
              type="button"
            >
              Save As...
            </button>
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
