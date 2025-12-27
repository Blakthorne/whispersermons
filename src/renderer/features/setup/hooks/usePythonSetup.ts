import { useState, useEffect, useCallback } from 'react';
import {
  checkPythonStatus,
  installPython,
  downloadPythonModel,
  onPythonInstallProgress,
  onPythonModelProgress,
} from '@/services/electronAPI';
import type { PythonStatus, PythonInstallProgress } from '@/services/electronAPI';

export type SetupStage =
  | 'checking'
  | 'ready'
  | 'needs-setup'
  | 'installing-python'
  | 'installing-packages'
  | 'downloading-models'
  | 'complete'
  | 'error';

export interface SetupProgress {
  stage: SetupStage;
  progress: number;
  message: string;
  error?: string;
}

export interface UsePythonSetupReturn {
  status: PythonStatus | null;
  setupProgress: SetupProgress;
  isSetupRequired: boolean;
  isSettingUp: boolean;
  isComplete: boolean;
  startSetup: () => Promise<void>;
  skipSetup: () => void;
  retrySetup: () => void;
}

export function usePythonSetup(): UsePythonSetupReturn {
  const [status, setStatus] = useState<PythonStatus | null>(null);
  const [setupProgress, setSetupProgress] = useState<SetupProgress>({
    stage: 'checking',
    progress: 0,
    message: 'Checking Python environment...',
  });
  const [hasSkipped, setHasSkipped] = useState(false);

  // Check Python status on mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const pythonStatus = await checkPythonStatus();
        setStatus(pythonStatus);

        if (
          pythonStatus.installed &&
          pythonStatus.packagesInstalled &&
          pythonStatus.modelsDownloaded
        ) {
          setSetupProgress({
            stage: 'ready',
            progress: 100,
            message: 'Python environment is ready',
          });
        } else {
          setSetupProgress({
            stage: 'needs-setup',
            progress: 0,
            message: 'Python environment needs to be set up',
          });
        }
      } catch (error) {
        setSetupProgress({
          stage: 'error',
          progress: 0,
          message: 'Failed to check Python status',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    checkStatus();
  }, []);

  // Subscribe to installation progress events
  useEffect(() => {
    const unsubscribeInstall = onPythonInstallProgress((progress: PythonInstallProgress) => {
      const stageMap: Record<PythonInstallProgress['stage'], SetupStage> = {
        python: 'installing-python',
        packages: 'installing-packages',
        models: 'downloading-models',
      };

      setSetupProgress({
        stage: stageMap[progress.stage],
        progress: progress.progress,
        message: progress.message,
      });
    });

    const unsubscribeModel = onPythonModelProgress((data) => {
      setSetupProgress((prev: SetupProgress) => ({
        ...prev,
        progress: data.progress,
        message: data.message,
      }));
    });

    return () => {
      unsubscribeInstall();
      unsubscribeModel();
    };
  }, []);

  const startSetup = useCallback(async () => {
    setSetupProgress({
      stage: 'installing-python',
      progress: 0,
      message: 'Starting Python installation...',
    });

    try {
      const result = await installPython();

      if (result.success) {
        // After base installation, download default whisper model
        setSetupProgress({
          stage: 'downloading-models',
          progress: 0,
          message: 'Downloading Whisper model (this may take a while)...',
        });

        const modelResult = await downloadPythonModel('base');

        if (modelResult.success) {
          setSetupProgress({
            stage: 'complete',
            progress: 100,
            message: 'Setup complete! You can now transcribe audio.',
          });

          // Refresh status
          const newStatus = await checkPythonStatus();
          setStatus(newStatus);
        } else {
          setSetupProgress({
            stage: 'error',
            progress: 0,
            message: 'Failed to download Whisper model',
            error: modelResult.error,
          });
        }
      } else {
        setSetupProgress({
          stage: 'error',
          progress: 0,
          message: 'Failed to install Python environment',
          error: result.error,
        });
      }
    } catch (error) {
      setSetupProgress({
        stage: 'error',
        progress: 0,
        message: 'An error occurred during setup',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const skipSetup = useCallback(() => {
    setHasSkipped(true);
    setSetupProgress({
      stage: 'ready',
      progress: 0,
      message: 'Setup skipped - some features may not be available',
    });
  }, []);

  const retrySetup = useCallback(() => {
    setSetupProgress({
      stage: 'needs-setup',
      progress: 0,
      message: 'Ready to retry setup',
    });
  }, []);

  const isSetupRequired =
    !hasSkipped &&
    status !== null &&
    (!status.installed || !status.packagesInstalled || !status.modelsDownloaded);

  const isSettingUp = [
    'installing-python',
    'installing-packages',
    'downloading-models',
  ].includes(setupProgress.stage);

  const isComplete = setupProgress.stage === 'complete' || setupProgress.stage === 'ready';

  return {
    status,
    setupProgress,
    isSetupRequired,
    isSettingUp,
    isComplete,
    startSetup,
    skipSetup,
    retrySetup,
  };
}
