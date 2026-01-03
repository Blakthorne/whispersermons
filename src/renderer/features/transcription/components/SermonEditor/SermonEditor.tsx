import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Blockquote from '@tiptap/extension-blockquote';
import type { SermonDocument } from '../../../../types';
import type { DocumentState, DocumentRootNode } from '../../../../../shared/documentModel';
import {
  astToTipTapJson,
  tipTapJsonToAst,
  type TipTapDocument,
} from '../../../document/bridge/astTipTapConverter';
import { SermonToolbar } from './SermonToolbar';
import { useEditorActionsOptional, useAppTranscription } from '../../../../contexts';
import { QuoteBlockExtension } from './extensions/QuoteBlockExtension';
import { InterjectionMark } from './extensions/InterjectionMark';
import './SermonEditor.css';

/** Document save state for UI indicators (includes auto-saving) */
export type DocumentSaveState = 'saved' | 'unsaved' | 'saving' | 'auto-saving';

export interface SermonEditorProps {
  /** Sermon document data from pipeline processing */
  document: SermonDocument | null;
  /** Optional document state (AST) - THE SOURCE OF TRUTH for quote-aware rendering */
  documentState?: DocumentState;
  /** Callback when AST changes (debounced) - replaces onHtmlChange */
  onAstChange?: (newRoot: DocumentRootNode) => void;
}

/**
 * Rich text WYSIWYG editor for sermon documents.
 *
 * AST-ONLY ARCHITECTURE:
 * - The DocumentState AST is the single source of truth
 * - TipTap content is ALWAYS derived from the AST
 * - Content changes flow: TipTap edit → tipTapJsonToAst → onAstChange → Context
 * - External AST changes flow: Context → astToTipTapJson → TipTap setContent
 *
 * Note: Action buttons (save, copy, undo, redo) are now in UnifiedEditorActions
 * which is rendered by RightPanel above all editor modes.
 */
function SermonEditor({
  document,
  documentState,
  onAstChange,
}: SermonEditorProps): React.JSX.Element {
  const { visibleNodeId, setVisibleNodeId, externalAstVersion, sermonDocument } =
    useAppTranscription();
  const isSelfScrollingRef = React.useRef(false);

  // Track the last EXTERNAL AST version we've synced to TipTap
  // (We only sync back when external changes occur, not from our own TipTap edits)
  const lastSyncedExternalVersionRef = useRef<number>(externalAstVersion);

  // Track whether we're syncing from AST to TipTap (to avoid triggering onAstChange)
  const isSyncingFromAstRef = useRef<boolean>(false);

  // Memoize extensions to prevent duplicate warnings
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false, // Disable built-in heading as we override it
        paragraph: false, // Disable built-in paragraph as we override it
        blockquote: false, // Disable built-in blockquote as we override it
        undoRedo: false, // Disable TipTap's undo/redo to use our AST-based system
      }),
      Paragraph.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
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
            ...this.parent?.(),
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
      Blockquote.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
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
        HTMLAttributes: {
          class: 'visual-blockquote',
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
      QuoteBlockExtension,
      InterjectionMark,
    ],
    []
  );

  // Convert sermon document to TipTap content (AST-FIRST approach)
  // Priority: DocumentState AST → fallback to legacy document.body
  const defaultContent = useMemo(() => {
    // Priority 1: Use documentState (AST) - THE SOURCE OF TRUTH for quote-aware rendering
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

    // Priority 2: Fallback to document.body if no AST or AST conversion failed
    // This handles legacy data or fresh transcriptions without AST yet
    if (!document) {
      return '<p>No sermon content available. Start by processing an audio file with "Process as sermon" enabled.</p>';
    }

    // Build HTML from sermon document (legacy path for initial transcription)
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
  }, [document, documentState]);

  const editor = useEditor({
    extensions,
    content: defaultContent,
    editable: true,
    onUpdate: ({ editor: editorInstance }) => {
      // If we're in the middle of syncing AST→TipTap, don't trigger onAstChange
      // This prevents infinite loops when external AST changes update TipTap
      if (isSyncingFromAstRef.current) {
        return;
      }

      // Convert TipTap JSON to AST and notify parent
      // The parent (Context) will debounce this update
      if (onAstChange) {
        const tipTapJson = editorInstance.getJSON() as TipTapDocument;

        // Pass the existing documentState root for ID preservation hints
        const existingRoot = documentState?.root;
        const result = tipTapJsonToAst(tipTapJson, {}, existingRoot);

        if (result.success && result.data) {
          onAstChange(result.data);
        } else {
          console.error('[SermonEditor] AST conversion failed:', result.error);
        }
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

  // Track the document root ID to detect when we switch to a different document
  // Using root ID instead of object reference because the document object may be
  // recreated on each render even when it represents the same document
  const lastRootIdRef = useRef<string | null>(null);

  // Update content when DOCUMENT IDENTITY changes (switching to different sermon)
  // NOTE: We compare document ROOT ID to detect actual document switches.
  // Internal edits flow TipTap → AST → context, but should NOT trigger
  // content replacement (that would cause infinite loops and lost state).
  useEffect(() => {
    // Use the root ID as the stable document identifier
    const currentRootId = documentState?.root?.id || null;
    const isNewDocument = currentRootId !== lastRootIdRef.current && currentRootId !== null;

    if (editor && document && documentState?.root && isNewDocument) {
      lastRootIdRef.current = currentRootId;

      // Set the flag to prevent onUpdate from triggering onAstChange
      isSyncingFromAstRef.current = true;
      editor.commands.setContent(defaultContent);
      // Clear the flag after a brief delay to allow TipTap to settle
      requestAnimationFrame(() => {
        isSyncingFromAstRef.current = false;
      });
    }
  }, [documentState?.root?.id, editor, defaultContent, document]); // Use root ID in deps instead of document reference

  // Sync EXTERNAL AST changes to TipTap (AST → TipTap)
  // This ONLY triggers when externalAstVersion changes, indicating an external AST update
  // (e.g., from DevASTPanel applying changes, undo/redo operations)
  // Changes from TipTap itself do NOT trigger this sync (avoids infinite loop and lost formatting)
  // IMPORTANT: We use sermonDocument.documentState from CONTEXT (not documentState prop)
  // to ensure we get the latest AST that corresponds to the updated version number.
  useEffect(() => {
    // Skip if this is the initial mount or external version hasn't changed
    if (lastSyncedExternalVersionRef.current === externalAstVersion) {
      return;
    }

    // Get the documentState from context (not props) to ensure it's in sync with version
    const contextDocumentState = sermonDocument?.documentState;

    // External AST change detected - sync to TipTap
    if (editor && contextDocumentState?.root) {
      const result = astToTipTapJson(contextDocumentState.root, {
        preserveIds: true,
        includeMetadata: true,
        includeInterjections: true,
      });

      if (result.success && result.data) {
        // Set the flag to prevent onUpdate from triggering onAstChange (infinite loop prevention)
        isSyncingFromAstRef.current = true;
        editor.commands.setContent(result.data);
        // Clear the flag after a brief delay to allow TipTap to settle
        requestAnimationFrame(() => {
          isSyncingFromAstRef.current = false;
        });
      }
    }

    // Track that we've processed this external version
    lastSyncedExternalVersionRef.current = externalAstVersion;
  }, [externalAstVersion, sermonDocument, editor]);

  // Sync scroll from AST panel (visibleNodeId) to TipTap
  // Tracks which ID we last successfully scrolled to
  const lastSuccessfullyScrolledIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    let timer: any;
    let retryTimer: any;

    const performScrollSync = (retryCount = 0) => {
      if (!editor || !visibleNodeId || isSelfScrollingRef.current) return;

      const element = editor.view.dom.querySelector(
        `[data-node-id="${visibleNodeId}"]`
      ) as HTMLElement;
      const container = editor.view.dom.closest('.sermon-editor-content') as HTMLElement;

      if (element && container) {
        isSelfScrollingRef.current = true;

        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;
        const targetScrollTop =
          container.scrollTop + relativeTop - containerRect.height / 2 + elementRect.height / 2;

        container.scrollTo({
          top: targetScrollTop,
          behavior: retryCount > 0 ? 'auto' : 'smooth', // Use instant jump if it was a delayed sync for better feel
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

  // Get HTML content for copy/save operations
  const getHtmlContent = useCallback((): string => {
    return editor?.getHTML() || '';
  }, [editor]);

  const getPlainText = useCallback((): string => {
    return editor?.getText() || '';
  }, [editor]);

  return (
    <div className="sermon-editor-container">
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
