import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { ResizablePanel } from '../../ui';
import { DEFAULT_PANEL_WIDTH } from '../../../types/quoteReview';
import { QuoteReviewPanel } from '../../../features/quote-review/components/QuoteReviewPanel';
import type { QuoteReviewItem } from '../../../types/quoteReview';
import type { SermonDocument } from '../../../types';
import { DevASTPanel } from '../../../features/dev/components/DevASTPanel/DevASTPanel';
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

    // Traverse the AST to find quote_block nodes
    function traverse(children: unknown[]) {
      for (const child of children) {
        const node = child as {
          type?: string;
          id?: string;
          children?: unknown[];
          metadata?: Record<string, unknown>;
        };
        if (node.type === 'quote_block') {
          // Extract text from quote children
          const text = extractTextFromChildren(node.children || []);
          const metadata = node.metadata || {};
          const reference = metadata.reference as {
            normalizedReference?: string;
            book?: string;
            chapter?: number;
            verseStart?: number;
            verseEnd?: number;
            originalText?: string;
          } | undefined;

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
  const quoteReview = useQuoteReviewOptional();
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);

  const isPanelOpen = quoteReview?.review.panelOpen ?? false;

  return (
    <div className="right-panel-container">
      <QuoteSyncAndAutoOpen document={document} />
      <div className="right-panel-container-inner">
        <div className="right-panel-main-content">{children}</div>
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
    documentHtml,
    setDocumentHtml,
    saveEdits,
    documentSaveState,
    lastSavedAt,
    selectedFile,
    isDev,
  } = useAppTranscription();

  const [activeTab, setActiveTab] = useState<'quotes' | 'ast'>('quotes');

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
      return `doc-${selectedFile.name.replace(/\.\w+$/, '').replace(/\s+/g, '-').toLowerCase()}`;
    }
    // 4. Fallback to timestamp (memoized, so stable for this document instance)
    return `doc-${Date.now()}`;
  }, [sermonDocument, selectedFile]);

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
        <QuoteReviewProvider documentId={documentId}>
          <RightPanelWithQuoteReview document={sermonDocument} key={documentId}>
            <div className="right-panel">
              {isDev && (
                <div className="right-panel-tabs">
                  <button
                    className={`right-panel-tab ${activeTab === 'quotes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('quotes')}
                  >
                    Quotes
                  </button>
                  <button
                    className={`right-panel-tab ${activeTab === 'ast' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ast')}
                  >
                    Dev AST
                  </button>
                </div>
              )}

              {activeTab === 'quotes' ? (
                <QuoteAwareSermonEditor
                  document={sermonDocument}
                  documentState={sermonDocument.documentState}
                  initialHtml={documentHtml || undefined}
                  onSave={handleSave}
                  onCopy={handleCopy}
                  copySuccess={copySuccess}
                  onHtmlChange={setDocumentHtml}
                  onSaveEdits={saveEdits}
                  saveState={documentSaveState}
                  lastSaved={lastSavedAt}
                />
              ) : (
                <DevASTPanel />
              )}
            </div>
          </RightPanelWithQuoteReview>
        </QuoteReviewProvider>
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
