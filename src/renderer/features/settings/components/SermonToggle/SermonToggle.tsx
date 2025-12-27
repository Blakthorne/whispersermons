import React, { useState, useEffect } from 'react';
import { checkPythonStatus } from '../../../../services/electronAPI';
import './SermonToggle.css';

export interface SermonToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * Checkbox toggle for enabling sermon processing mode.
 *
 * When enabled, transcriptions will go through the full sermon processing pipeline:
 * 1. Audio transcription with Whisper
 * 2. Metadata extraction (title, description from audio file)
 * 3. Bible quote detection and lookup
 * 4. Paragraph segmentation with semantic similarity
 * 5. Topic/tag extraction with keyword analysis
 */
export function SermonToggle({
  checked,
  onChange,
  disabled = false,
}: SermonToggleProps): React.JSX.Element {
  const [pythonInstalled, setPythonInstalled] = useState<boolean | null>(null);
  const [checkingPython, setCheckingPython] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkPython = async (): Promise<void> => {
      try {
        const status = await checkPythonStatus();
        if (mounted) {
          setPythonInstalled(status.installed && status.packagesInstalled);
          setCheckingPython(false);
        }
      } catch {
        if (mounted) {
          setPythonInstalled(false);
          setCheckingPython(false);
        }
      }
    };

    checkPython();

    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.checked);
  };

  const isDisabled = disabled || checkingPython || pythonInstalled === false;
  const showSetupMessage = pythonInstalled === false && !checkingPython;

  return (
    <div className="sermon-toggle">
      <label className="sermon-toggle-label">
        <input
          type="checkbox"
          className="sermon-toggle-checkbox"
          checked={checked}
          onChange={handleChange}
          disabled={isDisabled}
          aria-describedby="sermon-toggle-description"
        />
        <span className="sermon-toggle-checkmark" />
        <span className="sermon-toggle-text">Process as sermon</span>
      </label>
      <p id="sermon-toggle-description" className="sermon-toggle-description">
        {showSetupMessage ? (
          <span className="sermon-toggle-warning">
            ⚠️ Python environment not installed. Sermon processing requires additional setup.
          </span>
        ) : (
          'Enable sermon mode for Bible quote detection, topic tagging, and rich document output'
        )}
      </p>
    </div>
  );
}
