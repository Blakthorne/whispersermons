import React, { useEffect, useCallback } from 'react';
import { FileDropZone } from '../../../features/transcription';
import { SettingsPanel } from '../../../features/settings';
import { useAppTranscription } from '../../../contexts';
import { TranscriptionActions } from './TranscriptionActions';
import { TranscriptionProgress } from './TranscriptionProgress';
import { ErrorMessage } from './ErrorMessage';
import { DonationSection } from './DonationSection';
import { SystemWarning } from '../../ui';
import { checkFFmpeg, logger } from '../../../services';

function LeftPanel(): React.JSX.Element {
  const {
    selectedFile,
    settings,
    isTranscribing,
    isFFmpegAvailable,
    setSelectedFile,
    setSettings,
    setModelDownloaded,
    setIsFFmpegAvailable,
    handleFileSelect,
  } = useAppTranscription();

  const checkStatus = useCallback(async () => {
    try {
      const available = await checkFFmpeg();
      setIsFFmpegAvailable(available);
      return available;
    } catch (error) {
      logger.error('Failed to check FFmpeg status:', error);
      setIsFFmpegAvailable(false);
      return false;
    }
  }, [setIsFFmpegAvailable]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return (
    <div className="left-panel">
      {isFFmpegAvailable === null && (
        <div className="system-check-loading" role="status" aria-live="polite">
          Checking system requirements...
        </div>
      )}
      {isFFmpegAvailable === false && <SystemWarning onRefresh={checkStatus} />}

      <FileDropZone
        onFileSelect={handleFileSelect}
        selectedFile={selectedFile}
        disabled={isTranscribing}
        onClear={() => setSelectedFile(null)}
      />

      <SettingsPanel
        settings={settings}
        onChange={setSettings}
        disabled={isTranscribing}
        onModelStatusChange={setModelDownloaded}
      />

      <TranscriptionActions />

      <TranscriptionProgress />

      <ErrorMessage />

      <DonationSection />
    </div>
  );
}

export { LeftPanel };
