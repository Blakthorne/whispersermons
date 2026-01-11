/**
 * Editor Actions Context
 *
 * Provides a bridge between UI components (like QuoteReviewPanel) and the TipTap
 * editor instance. This context allows components outside the editor to trigger
 * editor commands like verifying quotes, updating attributes, or deleting quotes.
 *
 * The SermonEditor registers its editor instance here, and other components
 * can call the exposed action functions which delegate to TipTap commands.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import type { Editor } from '@tiptap/react';
import type { NodeId } from '../../shared/documentModel';

// ============================================================================
// TYPES
// ============================================================================

export interface QuoteEditorActions {
  /** Verify or unverify a quote */
  toggleQuoteVerification: (quoteId: NodeId, isVerified: boolean) => boolean;
  /** Update quote reference */
  updateQuoteReference: (quoteId: NodeId, reference: string) => boolean;
  /** Mark quote as non-biblical */
  toggleQuoteNonBiblical: (quoteId: NodeId, isNonBiblical: boolean) => boolean;
  /** Delete a quote (convert back to paragraph) */
  deleteQuote: (quoteId: NodeId) => boolean;
  /** Update quote metadata attributes */
  updateQuoteAttributes: (quoteId: NodeId, attrs: Record<string, unknown>) => boolean;
  /** Update the actual text content of a quote */
  updateQuoteText: (quoteId: NodeId, text: string) => boolean;
  /** Update the interjections list for a quote */
  updateQuoteInterjections: (quoteId: NodeId, interjections: string[]) => boolean;
  /** Focus the editor on a specific quote */
  focusQuote: (quoteId: NodeId) => boolean;
  /** Check if editor is available */
  isEditorReady: () => boolean;
}

export interface EditorActionsContextValue {
  /** Quote-related editor actions */
  quoteActions: QuoteEditorActions;
  /** Register the TipTap editor instance */
  registerEditor: (editor: Editor | null) => void;
  /** Get raw editor instance (use sparingly) */
  getEditor: () => Editor | null;
}

// ============================================================================
// CONTEXT
// ============================================================================

const EditorActionsContext = createContext<EditorActionsContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface EditorActionsProviderProps {
  children: ReactNode;
}

/**
 * Helper to find a quote node position by its ID
 */
function findQuotePosition(editor: Editor, quoteId: NodeId): { pos: number; node: any } | null {
  let result: { pos: number; node: any } | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (result) return false; // Stop if found

    if (node.type.name === 'bible_passage') {
      const nodeQuoteId = node.attrs.nodeId;
      if (nodeQuoteId === quoteId) {
        result = { pos, node };
        return false;
      }
    }
    return true;
  });

  return result;
}

export function EditorActionsProvider({ children }: EditorActionsProviderProps): React.JSX.Element {
  const [editor, setEditor] = useState<Editor | null>(null);

  const registerEditor = useCallback((newEditor: Editor | null) => {
    setEditor(newEditor);
  }, []);

  const getEditor = useCallback(() => editor, [editor]);

  // ============================================================================
  // QUOTE ACTIONS
  // ============================================================================

  const toggleQuoteVerification = useCallback(
    (quoteId: NodeId, isVerified: boolean): boolean => {
      if (!editor || editor.isDestroyed) return false;

      const found = findQuotePosition(editor, quoteId);
      if (!found) return false;

      // Use a transaction to update the specific node
      const { tr } = editor.state;
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        userVerified: isVerified,
        modifiedAt: new Date().toISOString(),
      });

      editor.view.dispatch(tr);
      return true;
    },
    [editor]
  );

  const updateQuoteReference = useCallback(
    (quoteId: NodeId, reference: string): boolean => {
      if (!editor || editor.isDestroyed) return false;

      const found = findQuotePosition(editor, quoteId);
      if (!found) return false;

      // Parse reference to extract book, chapter, verse
      const match = reference.match(/^(.+?)\s+(\d+):(\d+(?:-\d+)?)$/);
      let book: string | null = null;
      let chapter: number | null = null;
      let verse: string | null = null;

      if (match && match[1] && match[2] && match[3]) {
        book = match[1];
        chapter = parseInt(match[2], 10);
        verse = match[3];
      }

      const { tr } = editor.state;
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        reference,
        book,
        chapter,
        verse,
        modifiedAt: new Date().toISOString(),
      });

      editor.view.dispatch(tr);
      return true;
    },
    [editor]
  );

  const toggleQuoteNonBiblical = useCallback(
    (quoteId: NodeId, isNonBiblical: boolean): boolean => {
      if (!editor || editor.isDestroyed) return false;

      const found = findQuotePosition(editor, quoteId);
      if (!found) return false;

      const { tr } = editor.state;
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        isNonBiblical,
        // Clear reference if marking as non-biblical
        ...(isNonBiblical ? { reference: null, book: null, chapter: null, verse: null } : {}),
        modifiedAt: new Date().toISOString(),
      });

      editor.view.dispatch(tr);
      return true;
    },
    [editor]
  );

  const deleteQuote = useCallback(
    (quoteId: NodeId): boolean => {
      if (!editor || editor.isDestroyed) return false;

      const found = findQuotePosition(editor, quoteId);
      if (!found) return false;

      // Convert quote block back to regular paragraph
      // Get the quote's content
      const content = found.node.content;

      // Create a new paragraph with the same content
      const paragraphType = editor.schema.nodes.paragraph;
      if (!paragraphType) return false;

      const paragraph = paragraphType.create(null, content);

      // Replace the quote with a paragraph
      const { tr } = editor.state;
      tr.replaceWith(found.pos, found.pos + found.node.nodeSize, paragraph);

      editor.view.dispatch(tr);
      return true;
    },
    [editor]
  );

  const updateQuoteAttributes = useCallback(
    (quoteId: NodeId, attrs: Record<string, unknown>): boolean => {
      if (!editor || editor.isDestroyed) return false;

      const found = findQuotePosition(editor, quoteId);
      if (!found) return false;

      const { tr } = editor.state;
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        ...attrs,
        modifiedAt: new Date().toISOString(),
      });

      editor.view.dispatch(tr);
      return true;
    },
    [editor]
  );

  const updateQuoteText = useCallback(
    (quoteId: NodeId, text: string): boolean => {
      if (!editor || editor.isDestroyed) return false;

      const found = findQuotePosition(editor, quoteId);
      if (!found) return false;

      const { tr } = editor.state;

      // We need to replace the content of the node
      // The node likely contains a text node
      const nodeStart = found.pos + 1; // Skip the open tag
      const nodeEnd = found.pos + found.node.nodeSize - 1; // Skip the close tag

      // Create new text node
      const textNode = editor.schema.text(text);

      // Replace content
      tr.replaceWith(nodeStart, nodeEnd, textNode);

      // Also update modifiedAt
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        modifiedAt: new Date().toISOString(),
      });

      editor.view.dispatch(tr);
      return true;
    },
    [editor]
  );

  const updateQuoteInterjections = useCallback(
    (quoteId: NodeId, interjections: string[]): boolean => {
      // This is just a wrapper around updateQuoteAttributes for convenience and type safety
      return updateQuoteAttributes(quoteId, { interjections });
    },
    [updateQuoteAttributes]
  );

  const focusQuote = useCallback(
    (quoteId: NodeId): boolean => {
      if (!editor || editor.isDestroyed) return false;

      const found = findQuotePosition(editor, quoteId);
      if (!found) return false;

      // Focus the editor and move selection to the quote
      editor.commands.focus();
      editor.commands.setTextSelection(found.pos + 1);

      // Scroll the quote into view with quick smooth animation
      const dom = editor.view.domAtPos(found.pos);
      if (dom.node instanceof Element) {
        const element =
          dom.node instanceof HTMLElement ? dom.node : (dom.node as any).parentElement;
        if (element) {
          // Find the actual scrollable container (sermon-editor-content)
          const scrollContainer = element.closest('.sermon-editor-content');

          if (scrollContainer) {
            const elementRect = element.getBoundingClientRect();
            const containerRect = scrollContainer.getBoundingClientRect();
            const offset =
              elementRect.top -
              containerRect.top -
              containerRect.height / 2 +
              elementRect.height / 2;
            const targetScroll = scrollContainer.scrollTop + offset;

            // Quick smooth scroll with 250ms duration
            const startScroll = scrollContainer.scrollTop;
            const startTime = performance.now();
            const duration = 250; // Fast but smooth

            const animateScroll = (currentTime: number) => {
              const elapsed = currentTime - startTime;
              const progress = Math.min(elapsed / duration, 1);

              // Ease-out cubic for smooth deceleration
              const easeProgress = 1 - Math.pow(1 - progress, 3);

              scrollContainer.scrollTop = startScroll + (targetScroll - startScroll) * easeProgress;

              if (progress < 1) {
                requestAnimationFrame(animateScroll);
              }
            };

            requestAnimationFrame(animateScroll);
          }
        }
      }

      return true;
    },
    [editor]
  );

  const isEditorReady = useCallback((): boolean => {
    return editor !== null && !editor.isDestroyed;
  }, [editor]);

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const quoteActions: QuoteEditorActions = useMemo(
    () => ({
      toggleQuoteVerification,
      updateQuoteReference,
      toggleQuoteNonBiblical,
      deleteQuote,
      updateQuoteAttributes,
      updateQuoteText,
      updateQuoteInterjections,
      focusQuote,
      isEditorReady,
    }),
    [
      toggleQuoteVerification,
      updateQuoteReference,
      toggleQuoteNonBiblical,
      deleteQuote,
      updateQuoteAttributes,
      updateQuoteText,
      updateQuoteInterjections,
      focusQuote,
      isEditorReady,
    ]
  );

  const contextValue: EditorActionsContextValue = useMemo(
    () => ({
      quoteActions,
      registerEditor,
      getEditor,
    }),
    [quoteActions, registerEditor, getEditor]
  );

  return (
    <EditorActionsContext.Provider value={contextValue}>{children}</EditorActionsContext.Provider>
  );
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Use the editor actions context
 * @throws Error if used outside of EditorActionsProvider
 */
export function useEditorActions(): EditorActionsContextValue {
  const context = useContext(EditorActionsContext);
  if (!context) {
    throw new Error('useEditorActions must be used within an EditorActionsProvider');
  }
  return context;
}

/**
 * Use the editor actions context (returns null if outside provider)
 */
export function useEditorActionsOptional(): EditorActionsContextValue | null {
  return useContext(EditorActionsContext);
}

export default EditorActionsContext;
