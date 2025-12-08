import React, { useState } from 'react';
import { Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import './SystemWarning.css';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';

export interface SystemWarningProps {
  onRefresh: () => void;
}

function SystemWarning({ onRefresh }: SystemWarningProps): React.JSX.Element {
  const { copyToClipboard, copySuccess } = useCopyToClipboard(2000);
  const [isChecking, setIsChecking] = useState(false);

  const handleCopy = () => {
    copyToClipboard('brew install ffmpeg');
  };

  const handleRefresh = async () => {
    setIsChecking(true);
    await onRefresh();
    setTimeout(() => setIsChecking(false), 500);
  };

  return (
    <div className="system-warning">
      <div className="system-warning-title">
        <AlertTriangle size={18} />
        FFmpeg Not Found
      </div>
      <div className="system-warning-description">
        FFmpeg is required for audio/video processing. Most transcriptions will fail without it.
      </div>
      <div className="system-warning-code">
        <code>brew install ffmpeg</code>
        <button className="copy-button" onClick={handleCopy} title="Copy to clipboard">
          {copySuccess ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <button className="refresh-button" onClick={handleRefresh} disabled={isChecking}>
        {isChecking ? (
          <>
            <RefreshCw size={14} className="spin" /> Checking...
          </>
        ) : (
          <>
            <RefreshCw size={14} /> Check Again
          </>
        )}
      </button>
    </div>
  );
}

export default SystemWarning;
