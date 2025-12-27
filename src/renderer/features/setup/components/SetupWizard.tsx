import React from 'react';
import { usePythonSetup, type SetupStage } from '../hooks/usePythonSetup';
import './SetupWizard.css';

interface SetupWizardProps {
  onComplete?: () => void;
  onSkip?: () => void;
}

const STAGE_INFO: Record<
  SetupStage,
  { title: string; description: string; icon: string; showProgress: boolean }
> = {
  checking: {
    title: 'Checking Environment',
    description: 'Checking if Python and required dependencies are installed...',
    icon: '🔍',
    showProgress: false,
  },
  ready: {
    title: 'Ready to Go!',
    description: 'All dependencies are installed and ready.',
    icon: '✅',
    showProgress: false,
  },
  'needs-setup': {
    title: 'Setup Required',
    description:
      'WhisperDesk needs to download Python and AI models to transcribe audio. This is a one-time setup that takes about 3-4 GB of disk space.',
    icon: '📦',
    showProgress: false,
  },
  'installing-python': {
    title: 'Installing Python',
    description: 'Downloading and installing Python runtime (~50 MB)...',
    icon: '🐍',
    showProgress: true,
  },
  'installing-packages': {
    title: 'Installing Packages',
    description: 'Installing required Python packages (~500 MB)...',
    icon: '📚',
    showProgress: true,
  },
  'downloading-models': {
    title: 'Downloading AI Models',
    description: 'Downloading Whisper speech recognition model (~150 MB for base)...',
    icon: '🧠',
    showProgress: true,
  },
  complete: {
    title: 'Setup Complete!',
    description: 'Everything is ready. You can now transcribe audio files.',
    icon: '🎉',
    showProgress: false,
  },
  error: {
    title: 'Setup Error',
    description: 'An error occurred during setup.',
    icon: '❌',
    showProgress: false,
  },
};

// Simple progress bar component for setup wizard
function SimpleProgressBar({ progress }: { progress: number }): React.JSX.Element {
  return (
    <div className="simple-progress-bar">
      <div className="simple-progress-fill" style={{ width: `${progress}%` }} />
    </div>
  );
}

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps): React.JSX.Element | null {
  const {
    setupProgress,
    isSetupRequired,
    isSettingUp,
    isComplete,
    startSetup,
    skipSetup,
    retrySetup,
  } = usePythonSetup();

  const stageInfo = STAGE_INFO[setupProgress.stage];

  // Call onComplete when setup finishes
  React.useEffect(() => {
    if (isComplete && onComplete) {
      const timer = setTimeout(() => onComplete(), 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isComplete, onComplete]);

  const handleSkip = (): void => {
    skipSetup();
    onSkip?.();
  };

  // Don't render if no setup is needed and we're ready
  if (!isSetupRequired && setupProgress.stage === 'ready') {
    return null;
  }

  return (
    <div className="setup-wizard-overlay">
      <div className="setup-wizard">
        <div className="setup-wizard-header">
          <span className="setup-wizard-icon">{stageInfo.icon}</span>
          <h2 className="setup-wizard-title">{stageInfo.title}</h2>
        </div>

        <div className="setup-wizard-content">
          <p className="setup-wizard-description">{stageInfo.description}</p>

          {setupProgress.stage === 'error' && setupProgress.error && (
            <div className="setup-wizard-error">
              <p>Error details: {setupProgress.error}</p>
            </div>
          )}

          {stageInfo.showProgress && (
            <div className="setup-wizard-progress">
              <SimpleProgressBar progress={setupProgress.progress} />
              <p className="setup-wizard-progress-message">{setupProgress.message}</p>
            </div>
          )}
        </div>

        <div className="setup-wizard-actions">
          {setupProgress.stage === 'needs-setup' && (
            <>
              <button className="setup-wizard-button primary" onClick={startSetup}>
                Start Setup
              </button>
              <button className="setup-wizard-button secondary" onClick={handleSkip}>
                Skip for Now
              </button>
            </>
          )}

          {setupProgress.stage === 'error' && (
            <>
              <button className="setup-wizard-button primary" onClick={retrySetup}>
                Retry Setup
              </button>
              <button className="setup-wizard-button secondary" onClick={handleSkip}>
                Skip
              </button>
            </>
          )}

          {isSettingUp && (
            <p className="setup-wizard-note">
              Please wait while we set up the environment. This may take several minutes depending
              on your internet connection.
            </p>
          )}

          {setupProgress.stage === 'complete' && (
            <button className="setup-wizard-button primary" onClick={onComplete}>
              Get Started
            </button>
          )}
        </div>

        <div className="setup-wizard-footer">
          <p className="setup-wizard-disk-info">
            💾 This setup requires approximately 3-4 GB of disk space.
          </p>
        </div>
      </div>
    </div>
  );
}
