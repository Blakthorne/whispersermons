/**
 * Quote-Aware Sermon Editor
 *
 * Wraps SermonEditor to add in-document quote editing features:
 * - Visual quote rendering with metadata
 * - Drag-based boundary editing (QuoteBoundaryEditor)
 * - Right-click context menu
 *
 * AST-ONLY ARCHITECTURE:
 * - DocumentState is the single source of truth
 * - All content flows through the AST (no HTML state)
 * - Changes propagate: TipTap edit → tipTapJsonToAst → onAstChange → Context
 */

import React, { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import type { SermonDocument } from '../../../../types';
import type { DocumentState, DocumentRootNode } from '../../../../../shared/documentModel';
import { QuoteBoundaryEditor } from '../../../quote-review/components/QuoteBoundaryEditor';
import { useQuoteReview, useEditorActionsOptional } from '../../../../contexts';
import { useDocumentMutations } from '../../../document/hooks/useDocumentMutations';
import { SermonEditor } from './SermonEditor';
import './QuoteAwareSermonEditor.css';

export interface QuoteAwareSermonEditorProps {
  /** Sermon document data from pipeline processing */
  document: SermonDocument | null;
  /** Optional document state (AST) - THE SOURCE OF TRUTH for quote-aware rendering */
  documentState?: DocumentState;
  /** Callback when AST changes (debounced) - replaces onHtmlChange */
  onAstChange?: (newRoot: DocumentRootNode) => void;
}

/**
 * Quote-aware sermon editor with in-document editing features.
 *
 * Note: Action buttons (save, copy, undo, redo, review quotes) are now handled
 * by UnifiedEditorActions in RightPanel for consistency across editor modes.
 */
export function QuoteAwareSermonEditor({
  document,
  documentState,
  onAstChange,
}: QuoteAwareSermonEditorProps): React.JSX.Element {
  const quoteReview = useQuoteReview();
  const editorActions = useEditorActionsOptional();
  const mutations = useDocumentMutations();
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; quoteId: string } | null>(
    null
  );

  // State to force editor refresh after structural mutations
  const [mutationTrigger, setMutationTrigger] = useState<number>(0);

  // Use focusedQuoteId from context instead of local state
  const focusedQuoteId = quoteReview?.review.focusedQuoteId || null;

  // Get all quotes from documentState if available
  const quotes = useMemo(() => {
    if (!documentState?.root) return [];

    const extractedQuotes: Array<{
      id: string;
      text: string;
      reference?: string;
      isVerified: boolean;
    }> = [];

    function traverse(node: any): void {
      if (node.type === 'passage' && node.id) {
        const text = node.children?.map((child: any) => child.content || '').join('') || '';
        extractedQuotes.push({
          id: node.id,
          text,
          reference: node.metadata?.reference?.normalizedReference,
          isVerified: node.metadata?.userVerified || false,
        });
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(traverse);
      }
    }

    traverse(documentState.root);
    return extractedQuotes;
  }, [documentState]);

  // Handle verify toggle for focused quote - update both context and editor
  const handleVerifyQuote = useCallback(() => {
    if (focusedQuoteId) {
      const quote = quotes.find((q) => q.id === focusedQuoteId);
      if (quote) {
        const newVerifiedState = !quote.isVerified;
        // Update context state
        quoteReview?.updateQuote(focusedQuoteId, {
          isReviewed: newVerifiedState,
        });
        // Update editor state
        editorActions?.quoteActions.toggleQuoteVerification(focusedQuoteId, newVerifiedState);
      }
    }
  }, [focusedQuoteId, quotes, quoteReview, editorActions]);

  // Feature 2a: Sync context focus to Editor focus (visual highlight)
  useEffect(() => {
    if (focusedQuoteId && editorActions) {
      editorActions.quoteActions.focusQuote(focusedQuoteId);
    }
  }, [focusedQuoteId, editorActions, mutationTrigger]);

  // Feature 2b: Quote click detection for focus
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) {
      return;
    }

    const handleQuoteClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const biblePassage = target.closest('.bible-passage[data-node-id]') as HTMLElement;

      if (biblePassage) {
        const quoteId = biblePassage.getAttribute('data-node-id');
        if (quoteId) {
          quoteReview?.setFocusedQuote(quoteId);
        }
      } else {
        // Clicked outside quote - clear focus
        quoteReview?.setFocusedQuote(null);
      }
    };

    container.addEventListener('click', handleQuoteClick);
    return () => container.removeEventListener('click', handleQuoteClick);
  }, []);

  // Feature 4: Right-click context menu
  useEffect(() => {
    // Guard against missing document/window (SSR or testing environments)
    if (typeof window === 'undefined' || !window.document) {
      return;
    }

    const container = editorContainerRef.current;
    if (!container) {
      return;
    }

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const biblePassage = target.closest('.bible-passage[data-node-id]') as HTMLElement;

      if (biblePassage) {
        e.preventDefault();
        const quoteId = biblePassage.getAttribute('data-node-id');
        if (quoteId) {
          setContextMenu({ x: e.clientX, y: e.clientY, quoteId });
        }
      }
    };

    const handleCloseContextMenu = () => setContextMenu(null);

    container.addEventListener('contextmenu', handleContextMenu);
    window.document.addEventListener('click', handleCloseContextMenu);
    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      window.document.removeEventListener('click', handleCloseContextMenu);
    };
  }, []);

  // Feature 5: Keyboard shortcuts
  useEffect(() => {
    // Guard against missing document/window (SSR or testing environments)
    if (typeof window === 'undefined' || !window.document) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete - Remove focused quote (update both context and editor)
      if (e.key === 'Delete' && focusedQuoteId) {
        e.preventDefault();
        // Delete from editor first
        editorActions?.quoteActions.deleteQuote(focusedQuoteId);
        // Then remove from context
        quoteReview?.removeQuote(focusedQuoteId);
        quoteReview?.setFocusedQuote(null);
      }

      // Escape - Close panels and clear focus
      if (e.key === 'Escape') {
        quoteReview?.setFocusedQuote(null);
        setContextMenu(null);
        if (quoteReview?.boundaryDrag.isDragging) {
          quoteReview.exitBoundaryEditMode();
        }
      }

      // Cmd+Shift+V - Verify focused quote
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'v' && focusedQuoteId) {
        e.preventDefault();
        handleVerifyQuote();
      }
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusedQuoteId, quoteReview, editorActions, handleVerifyQuote]);

  // Handle context menu actions - update both context and editor
  const handleContextMenuAction = useCallback(
    (action: string, quoteId: string) => {
      setContextMenu(null);
      quoteReview?.setFocusedQuote(quoteId);

      switch (action) {
        case 'verify': {
          // Update context state
          quoteReview?.updateQuote(quoteId, { isReviewed: true });
          // Update editor state
          editorActions?.quoteActions.toggleQuoteVerification(quoteId, true);
          break;
        }
        case 'edit-bounds':
          quoteReview?.enterBoundaryEditMode(quoteId);
          editorActions?.quoteActions.focusQuote(quoteId);
          break;
        case 'delete':
          // Delete from editor first
          editorActions?.quoteActions.deleteQuote(quoteId);
          // Then remove from context
          quoteReview?.removeQuote(quoteId);
          quoteReview?.setFocusedQuote(null);
          break;
        case 'lookup':
          // Open verse lookup modal
          break;
        case 'toggle-non-biblical': {
          const quote = quotes.find((q) => q.id === quoteId);
          if (quote) {
            const newNonBiblicalState = !quote.isVerified; // Assuming isVerified tracks this
            quoteReview?.updateQuote(quoteId, { isNonBiblical: newNonBiblicalState });
            editorActions?.quoteActions.toggleQuoteNonBiblical(quoteId, newNonBiblicalState);
          }
          break;
        }
      }
    },
    [quoteReview, editorActions, quotes]
  );

  // Render base SermonEditor with quote features overlay
  return (
    <div ref={editorContainerRef} className="quote-aware-sermon-editor">
      <SermonEditor
        document={document}
        documentState={documentState}
        onAstChange={onAstChange}
        externalUpdateTrigger={mutationTrigger}
      />

      {/* Feature 3: Boundary editing for focused quote */}
      {focusedQuoteId &&
        quoteReview?.boundaryEdit.isActive &&
        (() => {
          // Find the quote element in the DOM
          const quoteElement = editorContainerRef.current?.querySelector(
            `.bible-passage[data-node-id="${focusedQuoteId}"]`
          ) as HTMLElement | null;
          const quoteData = quotes.find((q) => q.id === focusedQuoteId);

          if (!quoteElement || !quoteData) return null;

          return (
            <QuoteBoundaryEditor
              quoteElement={quoteElement}
              quoteText={quoteData.text}
              isActive={quoteReview.boundaryEdit.isActive}
              onBoundaryChange={(newText, startOffset, endOffset, paragraphIds) => {
                if (mutations.canMutate) {
                  // Log exact params for debugging
                  console.log('[QuoteAwareSermonEditor] Confirm boundary change:', {
                    quoteId: focusedQuoteId,
                    startOffset,
                    endOffset,
                    newTextPreview: newText.substring(0, 20) + '...',
                    paragraphIds,
                  });

                  const result = mutations.changePassageBoundary(focusedQuoteId, {
                    newStartOffset: startOffset,
                    newEndOffset: endOffset,
                    newContent: newText,
                    paragraphsToMerge: paragraphIds, // Pass the paragraph IDs to merge
                  });

                  // Log result
                  console.log('[QuoteAwareSermonEditor] Mutation Result:', result);

                  // If successful, we must update the AST and force a refresh of the editor
                  // because this is a structural change that TipTap/SermonEditor would otherwise ignore
                  // (since it normally ignores external updates to same root ID to prevent loops)
                  if (result?.success && result.state && onAstChange) {
                    onAstChange(result.state.root);
                    setMutationTrigger(Date.now());
                  }
                } else {
                  console.warn('[QuoteAwareSermonEditor] Cannot mutate: mutator not available');
                }
              }}
              onEditStart={() => {
                quoteReview.startBoundaryDrag(focusedQuoteId, 'start', 0);
              }}
              onEditEnd={() => {
                quoteReview.commitBoundaryChange();
                quoteReview.exitBoundaryEditMode();
              }}
              onCrossParagraphDrag={(direction, targetParagraph) => {
                // Update drag preview state if needed (optional)
              }}
            />
          );
        })()}

      {/* Feature 4: Context menu for quotes */}
      {contextMenu && (
        <div
          className="quote-context-menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 2000,
          }}
        >
          <button
            className="quote-context-menu-item"
            onClick={() => handleContextMenuAction('verify', contextMenu.quoteId)}
          >
            ✓ Verify Quote
          </button>
          <button
            className="quote-context-menu-item"
            onClick={() => handleContextMenuAction('edit-bounds', contextMenu.quoteId)}
          >
            ↔ Edit Boundaries
          </button>
          <button
            className="quote-context-menu-item"
            onClick={() => handleContextMenuAction('lookup', contextMenu.quoteId)}
          >
            🔍 Lookup Verse
          </button>
          <button
            className="quote-context-menu-item"
            onClick={() => handleContextMenuAction('toggle-non-biblical', contextMenu.quoteId)}
          >
            ⚠ Toggle Non-Biblical
          </button>
          <div className="quote-context-menu-divider" />
          <button
            className="quote-context-menu-item danger"
            onClick={() => handleContextMenuAction('delete', contextMenu.quoteId)}
          >
            🗑 Delete Quote
          </button>
        </div>
      )}
    </div>
  );
}

export default QuoteAwareSermonEditor;
