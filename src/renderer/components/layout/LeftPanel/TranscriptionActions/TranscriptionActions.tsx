import React from 'react';
import { Zap } from 'lucide-react';
import { useAppTranscription } from '../../../../contexts';

export function TranscriptionActions(): React.JSX.Element {
  const {
    selectedFile,
    isTranscribing,
    modelDownloaded,
    isFFmpegAvailable,
    handleTranscribe,
    handleCancel,
  } = useAppTranscription();

  const canTranscribe = selectedFile && modelDownloaded && isFFmpegAvailable === true;

  const getDisabledReason = (): string => {
    if (!isFFmpegAvailable) return 'Please install FFmpeg first';
    if (!modelDownloaded) return 'Please download the selected model first';
    return '';
  };

  return (
    <div className="actions">
      {!isTranscribing ? (
        <button
          className="btn-primary"
          onClick={handleTranscribe}
          disabled={!canTranscribe}
          aria-label="Start transcription"
          title={getDisabledReason()}
        >
          <Zap size={18} aria-hidden="true" /> Transcribe
        </button>
      ) : (
        <button
          className="btn-danger"
          onClick={handleCancel}
          aria-label="Cancel ongoing transcription"
        >
          <span className="loading-spinner" aria-hidden="true"></span> Cancel
        </button>
      )}
    </div>
  );
}
