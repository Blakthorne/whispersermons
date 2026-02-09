/**
 * PreferencesContext
 *
 * React Context for managing app preferences and the preferences dialog state.
 * Integrates with localStorage for persistence.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePreferences, usePreferencesDialog } from '../features/preferences/hooks';
import type {
  AppPreferences,
  GeneralSettings,
  WhisperAdvancedSettings,
  PreferencesTab,
} from '../features/preferences/types';

// ============================================================================
// CONTEXT TYPES
// ============================================================================

export interface PreferencesContextValue {
  /** Current preferences state */
  preferences: AppPreferences;
  /** Whether preferences have been loaded from storage */
  isPreferencesLoaded: boolean;
  /** Update general settings (model, language) */
  updateGeneralSettings: (updates: Partial<GeneralSettings>) => void;
  /** Update Whisper advanced settings */
  updateWhisperSettings: (updates: Partial<WhisperAdvancedSettings>) => void;
  /** Reset general settings to defaults */
  resetGeneralSettings: () => void;
  /** Reset Whisper settings to defaults */
  resetWhisperSettings: () => void;
  /** Reset all preferences to defaults */
  resetAllPreferences: () => void;

  // Dialog state
  /** Whether the preferences dialog is open */
  isPreferencesOpen: boolean;
  /** Currently active tab */
  preferencesTab: PreferencesTab;
  /** Open the preferences dialog */
  openPreferences: () => void;
  /** Close the preferences dialog */
  closePreferences: () => void;
  /** Toggle the preferences dialog */
  togglePreferences: () => void;
  /** Set the active preferences tab */
  setPreferencesTab: (tab: PreferencesTab) => void;
}

// ============================================================================
// CONTEXT
// ============================================================================

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface PreferencesProviderProps {
  children: ReactNode;
}

export function PreferencesProvider({ children }: PreferencesProviderProps): React.JSX.Element {
  const {
    preferences,
    isLoaded,
    updateGeneralSettings,
    updateWhisperSettings,
    resetGeneralSettings,
    resetWhisperSettings,
    resetAllPreferences,
  } = usePreferences();

  const { isOpen, activeTab, openDialog, closeDialog, toggleDialog, setActiveTab } =
    usePreferencesDialog();

  const contextValue = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      isPreferencesLoaded: isLoaded,
      updateGeneralSettings,
      updateWhisperSettings,
      resetGeneralSettings,
      resetWhisperSettings,
      resetAllPreferences,
      isPreferencesOpen: isOpen,
      preferencesTab: activeTab,
      openPreferences: openDialog,
      closePreferences: closeDialog,
      togglePreferences: toggleDialog,
      setPreferencesTab: setActiveTab,
    }),
    [
      preferences,
      isLoaded,
      updateGeneralSettings,
      updateWhisperSettings,
      resetGeneralSettings,
      resetWhisperSettings,
      resetAllPreferences,
      isOpen,
      activeTab,
      openDialog,
      closeDialog,
      toggleDialog,
      setActiveTab,
    ]
  );

  return <PreferencesContext.Provider value={contextValue}>{children}</PreferencesContext.Provider>;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to access preferences context
 * @throws Error if used outside PreferencesProvider
 */
export function useAppPreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('useAppPreferences must be used within PreferencesProvider');
  }
  return context;
}

/**
 * Hook to access preferences context (optional)
 * Returns null if used outside PreferencesProvider
 */
export function useAppPreferencesOptional(): PreferencesContextValue | null {
  return useContext(PreferencesContext);
}
