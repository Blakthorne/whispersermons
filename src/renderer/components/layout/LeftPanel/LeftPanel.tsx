import React from 'react';
import { FileDropZone, FileQueue, PipelineProgress } from '../../../features/transcription';
import { useAppTranscription } from '../../../contexts';
import { useFFmpegStatus } from '../../../hooks';
import { TranscriptionActions } from './TranscriptionActions';
import { ErrorMessage } from './ErrorMessage';
import { SystemWarning } from '../../ui';
import './LeftPanel.css';

function LeftPanel(): React.JSX.Element {
  const {
    settings,
    isTranscribing,
    setSettings,
    queue,
    selectedQueueItemId,
    handleFilesSelect,
    removeFromQueue,
    clearCompletedFromQueue,
    selectQueueItem,
    pipelineProgress,
    isDev,
    isDevToolsOpen,
  } = useAppTranscription();

  const { isFFmpegAvailable, isChecking, recheckStatus } = useFFmpegStatus();

  const handleTestModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isEnabled = e.target.checked;
    setSettings({
      ...settings,
      testMode: isEnabled,
      // Enforce settings when enabling test mode
      ...(isEnabled ? { language: 'en' } : {}),
    });
  };

  return (
    <div className="left-panel">
      {isChecking && isFFmpegAvailable === null && (
        <div className="system-check-loading" role="status" aria-live="polite">
          Checking system requirements...
        </div>
      )}
      {isFFmpegAvailable === false && <SystemWarning onRefresh={recheckStatus} />}

      {isDev && isDevToolsOpen && (
        <div className="sermon-toggle" style={{ marginTop: 0, marginBottom: '20px' }}>
          <label className="sermon-toggle-label">
            <input
              type="checkbox"
              className="sermon-toggle-checkbox"
              checked={settings.testMode || false}
              onChange={handleTestModeChange}
              disabled={isTranscribing}
            />
            <span className="sermon-toggle-checkmark" />
            <span className="sermon-toggle-text">Test Mode (Skip Whisper)</span>
          </label>
          <p className="sermon-toggle-description">Injects test transcript. Disables file input.</p>
        </div>
      )}

      <FileDropZone
        onFilesSelect={handleFilesSelect}
        queueCount={queue.length}
        disabled={isTranscribing || !!settings.testMode}
      />

      {queue.length > 0 && !settings.testMode && (
        <FileQueue
          queue={queue}
          onRemove={removeFromQueue}
          onClearCompleted={clearCompletedFromQueue}
          onSelectItem={selectQueueItem}
          selectedItemId={selectedQueueItemId}
          disabled={isTranscribing}
        />
      )}

      {/* Show pipeline progress when sermon processing is active */}
      {(isTranscribing || pipelineProgress) && (
        <PipelineProgress
          progress={pipelineProgress}
          isActive={isTranscribing}
          isComplete={
            !isTranscribing &&
            pipelineProgress === null &&
            (queue.some((q) => q.status === 'completed') || !!settings.testMode)
          }
        />
      )}

      <TranscriptionActions isFFmpegAvailable={isFFmpegAvailable} />

      <ErrorMessage />
    </div>
  );
}

export { LeftPanel };
