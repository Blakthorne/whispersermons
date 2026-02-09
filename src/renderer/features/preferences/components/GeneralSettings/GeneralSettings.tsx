/**
 * GeneralSettings Component
 *
 * The General tab content for the Preferences dialog.
 * Displays hardware info (GPU), model selection/management, and language selection.
 *
 * These settings were previously in the left panel's SettingsPanel component.
 * Moving them to the Preferences dialog follows desktop app best practices:
 * - "General" tab for foundational setup (model, language, hardware)
 * - "Transcription" tab for behavior parameters
 */

import React, { useState, useEffect } from 'react';
import { Info } from 'lucide-react';
import { useAppTranscription, useAppPreferences } from '../../../../contexts';
import {
  listModels,
  getGpuStatus,
  onModelDownloadProgress,
  downloadModel,
  deleteModel,
  logger,
} from '../../../../services';
import { DEFAULT_MODELS } from '../../../settings/services/modelService';
import { GpuStatus } from '../../../settings/components/GpuStatus';
import { ModelSelector } from '../../../settings/components/ModelSelector';
import { ModelDetails } from '../../../settings/components/ModelDetails';
import { LanguageSelector } from '../../../settings/components/LanguageSelector';
import type {
  ModelInfo,
  GpuInfo,
  ModelDownloadProgress,
  WhisperModelName,
  LanguageCode,
} from '../../../../types';
import './GeneralSettings.css';

function GeneralSettings(): React.JSX.Element {
  const {
    isTranscribing,
    setSettings: setTranscriptionSettings,
    settings: transcriptionSettings,
  } = useAppTranscription();
  const { preferences, updateGeneralSettings } = useAppPreferences();

  // Use preferences as the source of truth for model and language
  const model = preferences.general.model;
  const language = preferences.general.language;

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<ModelDownloadProgress | null>(null);

  const disabled = isTranscribing || !!transcriptionSettings.testMode;

  const loadModelInfo = async (): Promise<void> => {
    try {
      setLoading(true);
      const [modelList, gpu] = await Promise.all([listModels(), getGpuStatus()]);

      if (modelList?.models) {
        setModels(modelList.models);
      }
      if (gpu) {
        setGpuInfo(gpu);
      }
    } catch (err) {
      logger.error('Failed to load model info:', err);
      setModels(DEFAULT_MODELS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModelInfo();

    const unsubscribe = onModelDownloadProgress((data: ModelDownloadProgress) => {
      setDownloadProgress(data);
      if (data.status === 'complete') {
        setDownloading(null);
        setDownloadProgress(null);
        loadModelInfo();
      } else if (data.status === 'error') {
        setDownloading(null);
        setDownloadProgress(null);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (models.length > 0) {
      const selectedModel = models.find((m) => m.name === model);
      // Update transcription context when model download status changes
      if (selectedModel) {
        setTranscriptionSettings({
          ...transcriptionSettings,
          model: selectedModel.name as WhisperModelName,
        });
      }
    }
  }, [models, model]);

  const handleModelChange = (newModel: WhisperModelName): void => {
    // Update preferences (persisted)
    updateGeneralSettings({ model: newModel });
    // Also update transcription settings for immediate effect
    setTranscriptionSettings({ ...transcriptionSettings, model: newModel });
  };

  const handleLanguageChange = (newLanguage: LanguageCode): void => {
    // Update preferences (persisted)
    updateGeneralSettings({ language: newLanguage });
    // Also update transcription settings for immediate effect
    setTranscriptionSettings({ ...transcriptionSettings, language: newLanguage });
  };

  const handleDownloadModel = async (modelName: string): Promise<void> => {
    try {
      setDownloading(modelName);
      await downloadModel(modelName);
      await loadModelInfo();
    } catch (err) {
      logger.error('Failed to download model:', err);
    } finally {
      setDownloading(null);
    }
  };

  const handleDeleteModel = async (modelName: string): Promise<void> => {
    if (!window.confirm(`Are you sure you want to delete the ${modelName} model?`)) {
      return;
    }
    try {
      setLoading(true);
      const result = await deleteModel(modelName);
      if (!result?.success) {
        window.alert(`Failed to delete model: ${result?.error || 'Unknown error'}`);
        return;
      }
      await loadModelInfo();
    } catch (err) {
      logger.error('Failed to delete model:', err);
      window.alert(
        `Failed to delete model: ${err && typeof err === 'object' && 'message' in err ? err.message : String(err)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const selectedModelInfo = models.find((m) => m.name === model);

  return (
    <div className="general-settings">
      <div className="settings-intro">
        <Info size={16} className="settings-intro-icon" />
        <p>Configure your transcription engine, model, and language preferences.</p>
      </div>

      {/* Hardware section */}
      <div className="settings-group">
        <h4 className="settings-group-title">Hardware</h4>
        <GpuStatus gpuInfo={gpuInfo} />
      </div>

      {/* Model section */}
      <div className="settings-group">
        <h4 className="settings-group-title">Model</h4>
        <ModelSelector
          models={models}
          selectedModel={model}
          disabled={disabled}
          loading={loading}
          onChange={handleModelChange}
          ariaDescribedBy={selectedModelInfo ? 'model-details' : undefined}
        />
        <ModelDetails
          model={selectedModelInfo}
          downloading={downloading}
          downloadProgress={downloadProgress}
          disabled={disabled || loading}
          onDownload={handleDownloadModel}
          onDelete={handleDeleteModel}
        />
      </div>

      {/* Language section */}
      <div className="settings-group">
        <h4 className="settings-group-title">Language</h4>
        <LanguageSelector
          selectedLanguage={language}
          disabled={disabled}
          onChange={handleLanguageChange}
        />
      </div>
    </div>
  );
}

export { GeneralSettings };
