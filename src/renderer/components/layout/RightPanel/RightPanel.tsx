import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Edit3, Code2 } from 'lucide-react';
import { OutputDisplay } from '../../../features/transcription';
import { QuoteAwareSermonEditor } from '../../../features/transcription/components/SermonEditor/QuoteAwareSermonEditor';
import { TranscriptionHistory } from '../../../features/history';
import {
  useAppHistory,
  useAppTranscription,
  QuoteReviewProvider,
  useQuoteReviewOptional,
  EditorActionsProvider,
} from '../../../contexts';
import { ResizablePanel, SegmentedControl } from '../../ui';
import { DEFAULT_PANEL_WIDTH } from '../../../types/quoteReview';
import { QuoteReviewPanel } from '../../../features/quote-review/components/QuoteReviewPanel';
import type { QuoteReviewItem } from '../../../types/quoteReview';
import type { SermonDocument } from '../../../types';
import type { DocumentRootNode } from '../../../../shared/documentModel';
import { DevASTPanel } from '../../../features/dev/components/DevASTPanel/DevASTPanel';
import { DocumentProvider } from '../../../features/document';
import { DocumentMetadataPanel } from '../../../features/document/components';
import { UnifiedEditorActions, type EditorMode } from './UnifiedEditorActions';
import './RightPanel.css';

/**
 * Wrapper for quote review panel with verse lookup callback
 */
function QuoteReviewPanelWrapper(): React.JSX.Element | null {
  const quoteReview = useQuoteReviewOptional();

  const handleLookupVerse = useCallback((reference: string) => {
    // Use electron API to lookup the verse
    if (window.electronAPI?.lookupBibleVerse) {
      window.electronAPI.lookupBibleVerse(reference).then((result) => {
        if (result.success && result.verseText) {
          // Could show a modal/toast with the verse text
          console.log('Verse lookup result:', result);
        }
      });
    }
  }, []);

  if (!quoteReview || !quoteReview.review.panelOpen) {
    return null;
  }

  return <QuoteReviewPanel onLookupVerse={handleLookupVerse} />;
}

/**
 * Extracts quotes from a SermonDocument into QuoteReviewItem format
 */
function extractQuotesFromDocument(doc: SermonDocument): QuoteReviewItem[] {
  const quotes: QuoteReviewItem[] = [];

  // If we have documentState with the AST, extract from there
  if (doc.documentState?.root) {
    const root = doc.documentState.root;

    // Traverse the AST to find passage nodes
    function traverse(children: unknown[]) {
      for (const child of children) {
        const node = child as {
          type?: string;
          id?: string;
          children?: unknown[];
          metadata?: Record<string, unknown>;
        };
        if (node.type === 'passage') {
          // Extract text from quote children
          const text = extractTextFromChildren(node.children || []);
          const metadata = node.metadata || {};
          const reference = metadata.reference as
            | {
                normalizedReference?: string;
                book?: string;
                chapter?: number;
                verseStart?: number;
                verseEnd?: number;
                originalText?: string;
              }
            | undefined;

          // Build reference string with fallback logic
          let referenceStr = reference?.normalizedReference;
          if (!referenceStr && reference) {
            const { book, chapter, verseStart, verseEnd } = reference;
            if (book && chapter) {
              referenceStr = `${book} ${chapter}`;
              if (verseStart) {
                referenceStr += `:${verseStart}`;
                if (verseEnd && verseEnd !== verseStart) {
                  referenceStr += `-${verseEnd}`;
                }
              }
            }
          }
          // Last fallback: use originalText
          if (!referenceStr && reference?.originalText) {
            referenceStr = reference.originalText;
          }

          quotes.push({
            id: node.id || `quote-${quotes.length}`,
            text,
            reference: referenceStr,
            isNonBiblical: (metadata.isNonBiblicalQuote as boolean) || false,
            isReviewed: (metadata.userVerified as boolean) || false,
            interjections: metadata.interjections as string[] | undefined,
            startOffset: metadata.startOffset as number | undefined,
            endOffset: metadata.endOffset as number | undefined,
          });
        }
        // Recurse into children
        if (node.children && Array.isArray(node.children)) {
          traverse(node.children);
        }
      }
    }

    traverse(root.children || []);
  }

  return quotes;
}

/**
 * Extracts text content from AST children
 */
function extractTextFromChildren(children: unknown[]): string {
  let text = '';
  for (const child of children) {
    const node = child as { type?: string; content?: string; children?: unknown[] };
    if (node.type === 'text' && node.content) {
      text += node.content;
    } else if (node.children && Array.isArray(node.children)) {
      text += extractTextFromChildren(node.children);
    }
  }
  return text;
}

/**
 * Component that syncs quotes and shows the processing banner
 */
function QuoteSyncAndAutoOpen({
  document,
}: {
  document: SermonDocument;
}): React.JSX.Element | null {
  const quoteReview = useQuoteReviewOptional();
  const [hasSynced, setHasSynced] = useState(false);

  // Extract and sync quotes when document changes
  useEffect(() => {
    if (!quoteReview || hasSynced) return;

    const quotes = extractQuotesFromDocument(document);
    quoteReview.setQuotes(quotes);
    // Auto-open review panel whenever sermon document loads
    quoteReview.setPanelOpen(true);
    quoteReview.setReviewModeActive(true);
    setHasSynced(true);
  }, [document, quoteReview, hasSynced]);

  // Nothing to render; this hook only syncs quotes and opens the panel.
  return null;
}

/**
 * Wrapper component that handles the resizable panel
 */
function RightPanelWithQuoteReview({
  children,
  document,
}: {
  children: React.ReactNode;
  document: SermonDocument;
}): React.JSX.Element {
  return (
    <div className="right-panel-container">
      <QuoteSyncAndAutoOpen document={document} />
      {children}
    </div>
  );
}

/**
 * Inner component that has access to QuoteReviewProvider context
 */
function SermonEditorLayout({
  sermonDocument,
  documentSaveState,
  lastSavedAt,
  handleAstChange,
  handleMetadataChange,
  activeMode,
  setActiveMode,
  isDev,
  wordCount,
  quoteCount,
}: {
  sermonDocument: SermonDocument;
  documentSaveState: any;
  lastSavedAt: Date | null;
  handleAstChange: (root: DocumentRootNode) => void;
  handleMetadataChange: (
    updates: Partial<Pick<DocumentRootNode, 'title' | 'speaker' | 'biblePassage' | 'tags'>>
  ) => void;
  activeMode: EditorMode;
  setActiveMode: (mode: EditorMode) => void;
  isDev: boolean;
  wordCount: number;
  quoteCount: number;
}): React.JSX.Element {
  // Access quote review context
  const quoteReview = useQuoteReviewOptional();
  const isPanelOpen = quoteReview?.review.panelOpen ?? false;
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);

  const hasContent = wordCount > 0;

  // Get the current AST root from the sermon document (needed for metadata display)
  const currentRoot = sermonDocument.documentState?.root;

  // Metadata change handlers - update root node immediately without debouncing
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      handleMetadataChange({ title: newTitle });
    },
    [handleMetadataChange]
  );

  const handleSpeakerChange = useCallback(
    (newSpeaker: string) => {
      handleMetadataChange({ speaker: newSpeaker });
    },
    [handleMetadataChange]
  );

  const handleBiblePassageChange = useCallback(
    (newBiblePassage: string) => {
      handleMetadataChange({ biblePassage: newBiblePassage });
    },
    [handleMetadataChange]
  );

  const handleTagsChange = useCallback(
    (newTags: string[]) => {
      handleMetadataChange({ tags: newTags });
    },
    [handleMetadataChange]
  );

  return (
    <div className="right-panel-container-inner">
      {/* Unified action bar - shared across editor modes */}
      <UnifiedEditorActions
        activeMode={activeMode}
        wordCount={wordCount}
        saveState={documentSaveState}
        lastSaved={lastSavedAt}
        hasContent={hasContent}
        quoteCount={quoteCount}
      />

      {/* Document metadata panel - collapsible header for title, speaker, etc. */}
      {currentRoot && (
        <DocumentMetadataPanel
          title={currentRoot.title || ''}
          speaker={currentRoot.speaker || ''}
          biblePassage={currentRoot.biblePassage || ''}
          tags={currentRoot.tags || []}
          onTitleChange={handleTitleChange}
          onSpeakerChange={handleSpeakerChange}
          onBiblePassageChange={handleBiblePassageChange}
          onTagsChange={handleTagsChange}
        />
      )}

      <div className="right-panel-content-wrapper">
        <div className="right-panel-main-content">
          <div className="right-panel">
            {isDev && (
              <div className="right-panel-view-switcher">
                <SegmentedControl
                  options={[
                    {
                      value: 'editor',
                      label: 'Editor',
                      icon: <Edit3 size={12} />,
                      tooltip: 'Editor View (⌘1)',
                    },
                    {
                      value: 'ast',
                      label: 'Dev AST',
                      icon: <Code2 size={12} />,
                      tooltip: 'AST Debug View (⌘2)',
                    },
                  ]}
                  value={activeMode}
                  onChange={(value) => setActiveMode(value as EditorMode)}
                  size="sm"
                  aria-label="Editor view selector"
                />
              </div>
            )}

            {activeMode === 'editor' ? (
              <QuoteAwareSermonEditor
                document={sermonDocument}
                documentState={sermonDocument.documentState}
                onAstChange={handleAstChange}
              />
            ) : (
              <DevASTPanel />
            )}
          </div>
        </div>

        {isPanelOpen && (
          <ResizablePanel
            position="right"
            defaultWidth={panelWidth}
            minWidth={240}
            maxWidth={500}
            collapsible={false}
            collapsed={!isPanelOpen}
            onCollapse={(collapsed) => {
              if (collapsed) {
                quoteReview?.setPanelOpen(false);
              }
            }}
            onResize={setPanelWidth}
            ariaLabel="Quote review panel"
          >
            <QuoteReviewPanelWrapper />
          </ResizablePanel>
        )}
      </div>
    </div>
  );
}

function RightPanel(): React.JSX.Element {
  const {
    history,
    showHistory,
    setShowHistory,
    clearHistory,
    selectHistoryItem,
    removeHistoryItem,
  } = useAppHistory();
  const {
    transcription,
    copySuccess,
    handleSave,
    handleCopy,
    sermonDocument,
    handleAstChange,
    handleMetadataChange,
    documentSaveState,
    lastSavedAt,
    selectedFile,
    isDev,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = useAppTranscription();

  // Track active editor mode (used for unified actions)
  const [activeMode, setActiveMode] = useState<EditorMode>('editor');

  // Keyboard shortcuts for tab switching (Cmd+1, Cmd+2)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.document || !isDev) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Cmd/Ctrl + number shortcuts
      if (!(e.metaKey || e.ctrlKey)) return;

      // Cmd+1 - Switch to Editor view
      if (e.key === '1') {
        e.preventDefault();
        setActiveMode('editor');
      }

      // Cmd+2 - Switch to Dev AST view (only in dev mode)
      if (e.key === '2') {
        e.preventDefault();
        setActiveMode('ast');
      }
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [isDev]);

  // Global keyboard shortcuts for undo/redo (AST-level)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.document || !sermonDocument) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifierKey = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+Z - Undo
      if (modifierKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        // Only intercept if we have undo capability and not in a text input
        const target = e.target as HTMLElement;
        const isEditable =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('.ProseMirror') || // TipTap editor
          target.closest('.monaco-editor'); // Monaco editor

        // For TipTap, we let the editor handle its own undo first
        // The AST-level undo is supplementary for cross-mode consistency
        if (!isEditable && canUndo) {
          e.preventDefault();
          handleUndo();
        }
      }

      // Cmd/Ctrl+Shift+Z - Redo
      if (modifierKey && e.key.toLowerCase() === 'z' && e.shiftKey) {
        const target = e.target as HTMLElement;
        const isEditable =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('.ProseMirror') ||
          target.closest('.monaco-editor');

        if (!isEditable && canRedo) {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [sermonDocument, canUndo, canRedo, handleUndo, handleRedo]);

  // Generate a stable document ID to key the provider
  // This ensures state (reviewed quotes, panel width) persists for the same document
  // but resets when opening a new one
  // NOTE: This hook must be called unconditionally (before any early returns) per Rules of Hooks
  const documentId = useMemo(() => {
    if (!sermonDocument) return null;
    // 1. Prefer AST root ID (most stable)
    if (sermonDocument.documentState?.root?.id) {
      return `doc-${sermonDocument.documentState.root.id}`;
    }
    // 2. Fallback to sermon title
    if (sermonDocument.title) {
      return `doc-${sermonDocument.title.replace(/\s+/g, '-').toLowerCase().slice(0, 30)}`;
    }
    // 3. Fallback to filename (if available via selectedFile in context)
    if (selectedFile?.name) {
      return `doc-${selectedFile.name
        .replace(/\.\w+$/, '')
        .replace(/\s+/g, '-')
        .toLowerCase()}`;
    }
    // 4. Fallback to timestamp (memoized, so stable for this document instance)
    return `doc-${Date.now()}`;
  }, [sermonDocument, selectedFile]);

  // Calculate word count from AST or transcription
  // NOTE: Must be called unconditionally before any returns (Rules of Hooks)
  const wordCount = useMemo(() => {
    if (sermonDocument?.documentState?.root) {
      // Extract text from AST
      let text = '';
      function extractText(node: any): void {
        if (node.type === 'text' && node.content) {
          text += node.content + ' ';
        }
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach(extractText);
        }
      }
      extractText(sermonDocument.documentState.root);
      return text.trim() ? text.trim().split(/\s+/).length : 0;
    }
    return transcription.trim() ? transcription.trim().split(/\s+/).length : 0;
  }, [sermonDocument, transcription]);

  // Calculate passage count from AST
  // NOTE: Must be called unconditionally before any returns (Rules of Hooks)
  const quoteCount = useMemo(() => {
    if (!sermonDocument?.documentState?.root) return 0;
    let count = 0;
    function countQuotes(node: any): void {
      if (node.type === 'passage') {
        count++;
      }
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(countQuotes);
      }
    }
    countQuotes(sermonDocument.documentState.root);
    return count;
  }, [sermonDocument?.documentState]);

  if (showHistory) {
    return (
      <div className="right-panel">
        <TranscriptionHistory
          history={history}
          onClear={clearHistory}
          onClose={() => setShowHistory(false)}
          onSelect={selectHistoryItem}
          onDelete={removeHistoryItem}
        />
      </div>
    );
  }

  // Show SermonEditor if we have a sermon document
  // Wrap with QuoteReviewProvider and EditorActionsProvider for quote review functionality
  if (sermonDocument && documentId) {
    return (
      <EditorActionsProvider>
        <DocumentProvider sermonDocument={sermonDocument}>
          <QuoteReviewProvider documentId={documentId}>
            <RightPanelWithQuoteReview document={sermonDocument} key={documentId}>
              <SermonEditorLayout
                sermonDocument={sermonDocument}
                documentSaveState={documentSaveState}
                lastSavedAt={lastSavedAt}
                handleAstChange={handleAstChange}
                handleMetadataChange={handleMetadataChange}
                activeMode={activeMode}
                setActiveMode={setActiveMode}
                isDev={isDev}
                wordCount={wordCount}
                quoteCount={quoteCount}
              />
            </RightPanelWithQuoteReview>
          </QuoteReviewProvider>
        </DocumentProvider>
      </EditorActionsProvider>
    );
  }

  // Default: show plain text OutputDisplay
  return (
    <div className="right-panel">
      <OutputDisplay
        text={transcription}
        onSave={handleSave}
        onCopy={handleCopy}
        copySuccess={copySuccess}
      />
    </div>
  );
}

export { RightPanel };
