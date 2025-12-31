import React, { useState, useEffect, useRef } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import { useAppTranscription } from '../../../../contexts';
import type { DocumentState, DocumentRootNode } from '../../../../../shared/documentModel';
import { buildNodeIndex, buildQuoteIndex, buildExtracted } from '../../../document/serialization/stateSerializer';
import './DevASTPanel.css';

export function DevASTPanel(): React.JSX.Element {
  const { sermonDocument, setSermonDocument, visibleNodeId, setVisibleNodeId } = useAppTranscription();
  
  // Initialize JSON text immediately from document if available
  const [jsonText, setJsonText] = useState<string>(() => 
    sermonDocument?.documentState?.root ? JSON.stringify(sermonDocument.documentState.root, null, 2) : ''
  );
  
  const [error, setError] = useState<string | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const editorRef = useRef<any>(null);
  const isSelfScrollingRef = useRef(false);
  const lastScrolledNodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (sermonDocument?.documentState?.root) {
      setJsonText(JSON.stringify(sermonDocument.documentState.root, null, 2));
      setIsModified(false);
      setError(null);
    } else {
      setJsonText('');
    }
  }, [sermonDocument]);

  // Helper to scroll Monaco to a specific node ID
  const scrollToNodeId = (editor: any, nodeId: string, force: boolean = false) => {
    if (!editor || !nodeId) return false;
    const model = editor.getModel();
    if (!model) return false;

    // Use multiple search patterns for robustness
    // 1. Literal search for the ID specifically within the JSON structure
    let matches = model.findMatches(`"id": "${nodeId}"`, false, false, true, null, true);
    
    // 2. Fallback to regex if literal search fails
    if (matches.length === 0) {
      matches = model.findMatches(`"id":\\s*"${nodeId}"`, false, true, true, null, true);
    }

    // matches are already limited to the actual tree as we only show root
    const treeMatches = matches;

    if (treeMatches.length > 0) {
      const line = treeMatches[0].range.startLineNumber;
      
      // On initial mount or specific triggers, we force the scroll even if it looks visible
      // because Monaco's getVisibleRanges can be unreliable during initial layout.
      if (!force) {
        const visibleRanges = editor.getVisibleRanges();
        const isAlreadyVisible = visibleRanges.some((range: any) => 
          line >= range.startLineNumber && line <= range.endLineNumber
        );
        if (isAlreadyVisible) return true;
      }

      // Temporarily disable scroll tracking to avoid feedback loops
      isSelfScrollingRef.current = true;
      editor.revealLineInCenter(line);
      lastScrolledNodeIdRef.current = nodeId;
      
      // Reset after a delay
      setTimeout(() => {
        isSelfScrollingRef.current = false;
      }, 300);
      return true;
    }
    return false;
  };

  // Immediate sync scroll from main editor to Monaco
  useEffect(() => {
    if (isEditorReady && editorRef.current && visibleNodeId && !isSelfScrollingRef.current && !isModified) {
      // Force sync if we haven't synced this ID yet or if it's the very first sync after mount
      const shouldForce = !lastScrolledNodeIdRef.current;
      if (visibleNodeId !== lastScrolledNodeIdRef.current || shouldForce) {
        scrollToNodeId(editorRef.current, visibleNodeId, shouldForce);
      }
    }
  }, [visibleNodeId, isEditorReady, jsonText, isModified]);

  const handleEditorChange: OnChange = (value) => {
    setJsonText(value || '');
    setIsModified(true);
    setError(null);
  };

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    setIsEditorReady(true);

    // Track scroll to sync back to main editor
    editor.onDidScrollChange(() => {
      if (isSelfScrollingRef.current) return;

      const model = editor.getModel();
      if (!model) return;

      // Find visible lines
      const visibleRanges = editor.getVisibleRanges();
      if (!visibleRanges.length) return;
      
      const visibleRange = visibleRanges[0];
      if (!visibleRange) return;

      // Look for the first node ID in the visible range
      for (let i = visibleRange.startLineNumber; i <= visibleRange.endLineNumber; i++) {
        const lineContent = model.getLineContent(i);
        const match = lineContent.match(/"id":\s*"([^"]+)"/);
        if (match && match[1]) {
          const nodeId = match[1];
          
          // Avoid triggering self-sync and only update if it actually changed
          if (nodeId !== visibleNodeId) {
            isSelfScrollingRef.current = true;
            setVisibleNodeId(nodeId);
            lastScrolledNodeIdRef.current = nodeId;
            setTimeout(() => {
              isSelfScrollingRef.current = false;
            }, 100);
          }
          break;
        }
      }
    });

    // Configure professional editor settings
    editor.updateOptions({
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      folding: true,
      lineNumbers: 'on',
      renderLineHighlight: 'all',
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      fontSize: 12,
      tabSize: 2,
      accessibilitySupport: 'on',
      fixedOverflowWidgets: true, // Use the body for widgets to avoid clipping
      padding: { top: 10, bottom: 10 },
      hover: {
        above: false, // Strongly prefer showing hovers below
      },
      find: {
        addExtraSpaceOnTop: true,
        seedSearchStringFromSelection: 'always',
      },
    });
  };

  const handleUpdate = () => {
    try {
      const newRoot = JSON.parse(jsonText) as DocumentRootNode;
      
      // Basic validation
      if (!newRoot || newRoot.type !== 'document') {
        throw new Error('Invalid AST structure: root must be a "document" node');
      }

      if (sermonDocument && sermonDocument.documentState) {
        // Rebuild indexes from the new root
        const nodeIndex = buildNodeIndex(newRoot);
        const newState: DocumentState = {
          ...sermonDocument.documentState,
          root: newRoot,
          nodeIndex,
          quoteIndex: buildQuoteIndex(newRoot, nodeIndex),
          extracted: buildExtracted(newRoot, nodeIndex),
          lastModified: new Date().toISOString(),
        };

        setSermonDocument({
          ...sermonDocument,
          documentState: newState,
        });
        setIsModified(false);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReset = () => {
    if (sermonDocument?.documentState?.root) {
      setJsonText(JSON.stringify(sermonDocument.documentState.root, null, 2));
      setIsModified(false);
      setError(null);
    }
  };

  if (!sermonDocument) {
    return (
      <div className="dev-ast-panel empty">
        <p>No document loaded</p>
      </div>
    );
  }

  return (
    <div className="dev-ast-panel">
      <div className="dev-ast-header">
        <div className="header-top">
          <div className="dev-ast-actions">
            <button 
              className="dev-button reset" 
              onClick={handleReset}
              disabled={!isModified}
            >
              Reset
            </button>
            <button 
              className="dev-button update" 
              onClick={handleUpdate}
              disabled={!isModified}
            >
              Update AST
            </button>
          </div>
        </div>
      </div>
      
      {error && <div className="dev-ast-error">{error}</div>}
      
      <div className="dev-ast-editor-container">
        <Editor
          height="100%"
          defaultLanguage="json"
          theme="vs-dark"
          value={jsonText}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          options={{
            automaticLayout: true,
            formatOnPaste: true,
          }}
        />
      </div>
    </div>
  );
}

export default DevASTPanel;
