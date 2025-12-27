import React from 'react';
import { OutputDisplay, SermonEditor } from '../../../features/transcription';
import { TranscriptionHistory } from '../../../features/history';
import { useAppHistory, useAppTranscription } from '../../../contexts';

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
  } = useAppTranscription();

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
  if (sermonDocument) {
    return (
      <div className="right-panel">
        <SermonEditor
          document={sermonDocument}
          initialHtml={documentHtml || undefined}
          onSave={handleSave}
          onCopy={handleCopy}
          copySuccess={copySuccess}
          onHtmlChange={setDocumentHtml}
          onSaveEdits={saveEdits}
        />
      </div>
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
