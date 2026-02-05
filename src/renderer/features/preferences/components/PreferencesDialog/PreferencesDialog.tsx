/**
 * PreferencesDialog Component
 * 
 * A macOS-style Preferences dialog with tabular navigation.
 * Follows Apple Human Interface Guidelines for settings windows.
 */

import React, { useEffect, useCallback } from 'react';
import { Settings, X } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { TabButton } from '../TabButton';
import { TranscriptionSettings } from '../TranscriptionSettings';
import type { PreferencesTab } from '../../types';
import './PreferencesDialog.css';

interface PreferencesDialogProps {
  isOpen: boolean;
  activeTab: PreferencesTab;
  onClose: () => void;
  onTabChange: (tab: PreferencesTab) => void;
}

function PreferencesDialog({
  isOpen,
  activeTab,
  onClose,
  onTabChange,
}: PreferencesDialogProps): React.JSX.Element | null {
  // Handle Escape key to close dialog
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
    return undefined;
  }, [isOpen, handleKeyDown]);

  // Handle overlay click to close
  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="preferences-overlay" onClick={handleOverlayClick}>
      <div
        className="preferences-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
      >
        <div className="preferences-header">
          <div className="preferences-title-bar">
            <h2 id="preferences-title">
              <Settings size={18} aria-hidden="true" />
              Preferences
            </h2>
            <Button
              variant="ghost"
              icon={<X size={20} />}
              iconOnly
              onClick={onClose}
              aria-label="Close preferences"
              className="preferences-close"
            />
          </div>
          <div className="preferences-tabs" role="tablist" aria-label="Preferences tabs">
            <TabButton
              id="transcription"
              label="Transcription"
              isActive={activeTab === 'transcription'}
              onClick={() => onTabChange('transcription')}
            />
            {/* Future tabs can be added here */}
          </div>
        </div>

        <div className="preferences-content" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
          {activeTab === 'transcription' && <TranscriptionSettings />}
        </div>
      </div>
    </div>
  );
}

export { PreferencesDialog };
