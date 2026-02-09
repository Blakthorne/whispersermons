/**
 * usePreferencesDialog Hook
 * 
 * Manages the open/close state of the Preferences dialog.
 */

import { useState, useCallback } from 'react';
import type { PreferencesTab } from '../types';

interface UsePreferencesDialogReturn {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Currently active tab */
  activeTab: PreferencesTab;
  /** Open the dialog */
  openDialog: () => void;
  /** Close the dialog */
  closeDialog: () => void;
  /** Toggle the dialog */
  toggleDialog: () => void;
  /** Set the active tab */
  setActiveTab: (tab: PreferencesTab) => void;
}

export function usePreferencesDialog(): UsePreferencesDialogReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PreferencesTab>('general');
  
  const openDialog = useCallback(() => {
    setIsOpen(true);
  }, []);
  
  const closeDialog = useCallback(() => {
    setIsOpen(false);
  }, []);
  
  const toggleDialog = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);
  
  return {
    isOpen,
    activeTab,
    openDialog,
    closeDialog,
    toggleDialog,
    setActiveTab,
  };
}
