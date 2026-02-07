/**
 * TranscriptionSettings Component
 * 
 * The Transcription tab content for the Preferences dialog.
 * Redesigned with progressive disclosure - shows essential settings by default,
 * with advanced options hidden behind an expandable section.
 * 
 * UX Principles Applied:
 * - Progressive Disclosure: Hide advanced features initially
 * - Hick's Law: Minimize visible choices
 * - Miller's Law: Group settings into 5-7 items max
 * - Cognitive Load Reduction: Tooltips instead of inline help text
 */

import React, { useState, useCallback } from 'react';
import { HelpCircle, ChevronDown, RotateCcw, Info } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { useAppPreferences } from '../../../../contexts';
import { TEMPERATURE_PRESETS, SETTINGS_HELP } from '../../constants';
import type { WhisperAdvancedSettings } from '../../types';
import './TranscriptionSettings.css';

// Helper to format temperature for display
function formatTemperature(temp: number | number[]): string {
  if (Array.isArray(temp)) {
    return 'cascade';
  }
  return temp.toString();
}

// Helper to parse temperature from select value
function parseTemperature(value: string): number | number[] {
  if (value === 'cascade') {
    return [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
  }
  return parseFloat(value);
}

/**
 * Tooltip component for displaying help text on hover
 */
function Tooltip({ content }: { content: string }): React.JSX.Element {
  return (
    <span className="settings-tooltip-trigger" tabIndex={0}>
      <HelpCircle size={14} className="settings-tooltip-icon" aria-hidden="true" />
      <span className="settings-tooltip-content" role="tooltip">
        {content}
      </span>
    </span>
  );
}

/**
 * Inline toggle row component for cleaner code
 */
function ToggleRow({
  label,
  helpText,
  isActive,
  onToggle,
}: {
  label: string;
  helpText: string;
  isActive: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <div className="settings-row-inline">
      <div className="settings-label-row">
        <span className="settings-label-text">{label}</span>
        <Tooltip content={helpText} />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        aria-label={label}
        className={`toggle-switch ${isActive ? 'active' : ''}`}
        onClick={onToggle}
      >
        <span className="toggle-switch-handle" />
      </button>
    </div>
  );
}

function TranscriptionSettings(): React.JSX.Element {
  const { preferences, updateWhisperSettings, resetWhisperSettings } = useAppPreferences();
  const settings = preferences.whisper;
  
  // Advanced section collapsed by default (progressive disclosure)
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Handler for updating a single setting
  const handleChange = useCallback(
    <K extends keyof WhisperAdvancedSettings>(key: K, value: WhisperAdvancedSettings[K]) => {
      updateWhisperSettings({ [key]: value });
    },
    [updateWhisperSettings]
  );
  
  // Toggle for boolean settings
  const handleToggle = useCallback(
    (key: keyof WhisperAdvancedSettings) => {
      const currentValue = settings[key];
      if (typeof currentValue === 'boolean') {
        updateWhisperSettings({ [key]: !currentValue });
      }
    },
    [settings, updateWhisperSettings]
  );
  
  // Handler for nullable number inputs
  const handleNullableNumber = useCallback(
    (key: keyof WhisperAdvancedSettings, value: string, isEnabled: boolean) => {
      if (!isEnabled) {
        updateWhisperSettings({ [key]: null });
      } else {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          updateWhisperSettings({ [key]: num });
        }
      }
    },
    [updateWhisperSettings]
  );

  return (
    <div className="transcription-settings">
      {/* Intro Message */}
      <div className="settings-intro">
        <Info size={16} className="settings-intro-icon" />
        <p>
          Default settings work well for most recordings. 
          Adjust only if you experience quality issues.
        </p>
      </div>
      
      {/* Essential Settings - Always visible */}
      <div className="settings-group">
        <h3 className="settings-group-title">Transcription Options</h3>
        
        {/* Initial Prompt */}
        <div className="settings-row">
          <div className="settings-label-row">
            <label htmlFor="initialPrompt" className="settings-label-text">
              Context Prompt
            </label>
            <Tooltip content={SETTINGS_HELP.initialPrompt} />
          </div>
          <textarea
            id="initialPrompt"
            className="settings-textarea"
            value={settings.initialPrompt}
            onChange={(e) => handleChange('initialPrompt', e.target.value)}
            placeholder="Optional: Guide transcription style or add context..."
            rows={2}
          />
        </div>
        
        {/* Temperature - Simplified */}
        <div className="settings-row">
          <div className="settings-label-row">
            <label htmlFor="temperature" className="settings-label-text">
              Transcription Mode
            </label>
            <Tooltip content={SETTINGS_HELP.temperature} />
          </div>
          <select
            id="temperature"
            className="settings-select"
            value={formatTemperature(settings.temperature)}
            onChange={(e) => handleChange('temperature', parseTemperature(e.target.value))}
          >
            {TEMPERATURE_PRESETS.map((preset) => (
              <option key={preset.label} value={formatTemperature(preset.value)}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        
        {/* Toggle Settings */}
        <ToggleRow
          label="Use Previous Context"
          helpText={SETTINGS_HELP.conditionOnPreviousText}
          isActive={settings.conditionOnPreviousText}
          onToggle={() => handleToggle('conditionOnPreviousText')}
        />
        
        <ToggleRow
          label="Word-Level Timestamps"
          helpText={SETTINGS_HELP.wordTimestamps}
          isActive={settings.wordTimestamps}
          onToggle={() => handleToggle('wordTimestamps')}
        />
      </div>
      
      {/* Advanced Settings - Hidden by default */}
      <div className="settings-group settings-group-advanced">
        <button
          type="button"
          className="settings-group-header-collapsible"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
        >
          <div className="settings-group-header-left">
            <h3 className="settings-group-title">Advanced Settings</h3>
          </div>
          <ChevronDown 
            size={18} 
            className={`settings-collapse-icon ${showAdvanced ? 'expanded' : ''}`}
          />
        </button>
        
        {showAdvanced && (
          <div className="settings-group-content">
            <p className="settings-group-description">
              These settings are for fine-tuning. Only change them if you understand their effects.
            </p>
            
            {/* Quality Thresholds */}
            <div className="settings-subgroup">
              <h4 className="settings-subgroup-title">Quality Thresholds</h4>
              
              <div className="settings-row-compact">
                <div className="settings-label-row">
                  <label htmlFor="compressionRatio" className="settings-label-text">
                    Compression Ratio
                  </label>
                  <Tooltip content={SETTINGS_HELP.compressionRatioThreshold} />
                </div>
                <input
                  id="compressionRatio"
                  type="number"
                  className="settings-input-number"
                  value={settings.compressionRatioThreshold}
                  onChange={(e) => handleChange('compressionRatioThreshold', parseFloat(e.target.value) || 2.4)}
                  step="0.1"
                  min="0"
                  max="10"
                />
              </div>
              
              <div className="settings-row-compact">
                <div className="settings-label-row">
                  <label htmlFor="logProb" className="settings-label-text">
                    Log Probability
                  </label>
                  <Tooltip content={SETTINGS_HELP.logprobThreshold} />
                </div>
                <input
                  id="logProb"
                  type="number"
                  className="settings-input-number"
                  value={settings.logprobThreshold}
                  onChange={(e) => handleChange('logprobThreshold', parseFloat(e.target.value) || -1.0)}
                  step="0.1"
                  max="0"
                />
              </div>
              
              {/* Silence Detection - Optional */}
              <div className="settings-row-optional">
                <div className="settings-label-row">
                  <input
                    type="checkbox"
                    id="noSpeechEnabled"
                    className="settings-checkbox"
                    checked={settings.noSpeechThreshold !== null}
                    onChange={(e) => handleNullableNumber('noSpeechThreshold', '0.6', e.target.checked)}
                  />
                  <label htmlFor="noSpeechEnabled" className="settings-label-text">
                    Silence Detection
                  </label>
                  <Tooltip content={SETTINGS_HELP.noSpeechThreshold} />
                </div>
                <input
                  type="number"
                  className="settings-input-number"
                  value={settings.noSpeechThreshold ?? 0.6}
                  onChange={(e) => handleChange('noSpeechThreshold', parseFloat(e.target.value))}
                  step="0.1"
                  min="0"
                  max="1"
                  disabled={settings.noSpeechThreshold === null}
                  aria-label="Silence threshold value"
                />
              </div>
            </div>
            
            {/* Beam Search Settings */}
            <div className="settings-subgroup">
              <h4 className="settings-subgroup-title">Search Parameters</h4>
              
              <div className="settings-row-compact">
                <div className="settings-label-row">
                  <label htmlFor="beamSize" className="settings-label-text">
                    Beam Size
                  </label>
                  <Tooltip content={SETTINGS_HELP.beamSize} />
                </div>
                <input
                  id="beamSize"
                  type="number"
                  className="settings-input-number"
                  value={settings.beamSize}
                  onChange={(e) => handleChange('beamSize', parseInt(e.target.value, 10) || 5)}
                  min="1"
                  max="10"
                />
              </div>
              
              <div className="settings-row-compact">
                <div className="settings-label-row">
                  <label htmlFor="bestOf" className="settings-label-text">
                    Best Of (Candidates)
                  </label>
                  <Tooltip content={SETTINGS_HELP.bestOf} />
                </div>
                <input
                  id="bestOf"
                  type="number"
                  className="settings-input-number"
                  value={settings.bestOf}
                  onChange={(e) => handleChange('bestOf', parseInt(e.target.value, 10) || 5)}
                  min="1"
                  max="10"
                />
              </div>
              
              {/* Patience - Optional */}
              <div className="settings-row-optional">
                <div className="settings-label-row">
                  <input
                    type="checkbox"
                    id="patienceEnabled"
                    className="settings-checkbox"
                    checked={settings.patience !== null}
                    onChange={(e) => handleNullableNumber('patience', '1.0', e.target.checked)}
                  />
                  <label htmlFor="patienceEnabled" className="settings-label-text">
                    Beam Search Patience
                  </label>
                  <Tooltip content={SETTINGS_HELP.patience} />
                </div>
                <input
                  type="number"
                  className="settings-input-number"
                  value={settings.patience ?? 1.0}
                  onChange={(e) => handleChange('patience', parseFloat(e.target.value))}
                  step="0.1"
                  min="0"
                  disabled={settings.patience === null}
                  aria-label="Patience factor value"
                />
              </div>
            </div>
            
            {/* Performance Settings */}
            <div className="settings-subgroup">
              <h4 className="settings-subgroup-title">Performance</h4>
              
              <ToggleRow
                label="Half Precision (FP16)"
                helpText={SETTINGS_HELP.fp16}
                isActive={settings.fp16}
                onToggle={() => handleToggle('fp16')}
              />
              
              {/* Hallucination Detection - Optional */}
              <div className="settings-row-optional">
                <div className="settings-label-row">
                  <input
                    type="checkbox"
                    id="hallucinationEnabled"
                    className="settings-checkbox"
                    checked={settings.hallucinationSilenceThreshold !== null}
                    onChange={(e) => handleNullableNumber('hallucinationSilenceThreshold', '0.5', e.target.checked)}
                  />
                  <label htmlFor="hallucinationEnabled" className="settings-label-text">
                    Hallucination Detection
                  </label>
                  <Tooltip content={SETTINGS_HELP.hallucinationSilenceThreshold} />
                </div>
                <input
                  type="number"
                  className="settings-input-number"
                  value={settings.hallucinationSilenceThreshold ?? 0.5}
                  onChange={(e) => handleChange('hallucinationSilenceThreshold', parseFloat(e.target.value))}
                  step="0.1"
                  min="0"
                  disabled={settings.hallucinationSilenceThreshold === null}
                  aria-label="Hallucination threshold value"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Footer Actions */}
      <div className="settings-footer">
        <Button
          variant="secondary"
          icon={<RotateCcw size={14} />}
          onClick={resetWhisperSettings}
        >
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}

export { TranscriptionSettings };
