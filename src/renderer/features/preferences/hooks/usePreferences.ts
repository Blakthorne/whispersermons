/**
 * usePreferences Hook
 * 
 * Manages preferences state with localStorage persistence.
 * Provides load, save, update, and reset functionality.
 */

import { useState, useCallback, useEffect } from 'react';
import type { AppPreferences, GeneralSettings, WhisperAdvancedSettings } from '../types';
import { DEFAULT_PREFERENCES, PREFERENCES_VERSION } from '../constants';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from '../../../utils/storage';
import { logger } from '../../../services/logger';

interface UsePreferencesReturn {
  /** Current preferences state */
  preferences: AppPreferences;
  /** Whether preferences have been loaded from storage */
  isLoaded: boolean;
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
}

/**
 * Migrate preferences from older versions if needed
 */
function migratePreferences(stored: AppPreferences): AppPreferences {
  const currentVersion = stored.version ?? 0;
  
  if (currentVersion < PREFERENCES_VERSION) {
    logger.info('Migrating preferences', { from: currentVersion, to: PREFERENCES_VERSION });
    
    // Version 1: Initial schema
    // Add migration logic here for future versions
    
    return {
      ...DEFAULT_PREFERENCES,
      ...stored,
      version: PREFERENCES_VERSION,
    };
  }
  
  return stored;
}

/**
 * Validate and sanitize preferences
 */
function validatePreferences(prefs: AppPreferences): AppPreferences {
  const whisper = prefs.whisper;
  
  // Ensure all required fields exist
  return {
    ...DEFAULT_PREFERENCES,
    ...prefs,
    general: {
      ...DEFAULT_PREFERENCES.general,
      ...prefs.general,
    },
    whisper: {
      ...DEFAULT_PREFERENCES.whisper,
      ...whisper,
      // Clamp numeric values to valid ranges
      beamSize: Math.max(1, Math.min(10, whisper?.beamSize ?? DEFAULT_PREFERENCES.whisper.beamSize)),
      bestOf: Math.max(1, Math.min(10, whisper?.bestOf ?? DEFAULT_PREFERENCES.whisper.bestOf)),
      compressionRatioThreshold: Math.max(0, whisper?.compressionRatioThreshold ?? DEFAULT_PREFERENCES.whisper.compressionRatioThreshold),
      logprobThreshold: Math.min(0, whisper?.logprobThreshold ?? DEFAULT_PREFERENCES.whisper.logprobThreshold),
    },
  };
}

export function usePreferences(): UsePreferencesReturn {
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const stored = getStorageItem<AppPreferences>(
        STORAGE_KEYS.PREFERENCES,
        DEFAULT_PREFERENCES
      );
      
      const migrated = migratePreferences(stored);
      const validated = validatePreferences(migrated);
      
      setPreferences(validated);
      
      // Save back if migration occurred
      if (stored.version !== validated.version) {
        setStorageItem(STORAGE_KEYS.PREFERENCES, validated);
      }
      
      logger.debug('Preferences loaded', { version: validated.version });
    } catch (error) {
      logger.error('Failed to load preferences, using defaults', error);
      setPreferences(DEFAULT_PREFERENCES);
    } finally {
      setIsLoaded(true);
    }
  }, []);
  
  // Save preferences to localStorage whenever they change
  const savePreferences = useCallback((newPrefs: AppPreferences) => {
    setPreferences(newPrefs);
    const success = setStorageItem(STORAGE_KEYS.PREFERENCES, newPrefs);
    if (!success) {
      logger.error('Failed to save preferences to localStorage');
    }
  }, []);
  
  const updateGeneralSettings = useCallback((updates: Partial<GeneralSettings>) => {
    savePreferences({
      ...preferences,
      general: {
        ...preferences.general,
        ...updates,
      },
    });
    logger.info('General settings updated', { updates: Object.keys(updates) });
  }, [preferences, savePreferences]);
  
  const updateWhisperSettings = useCallback((updates: Partial<WhisperAdvancedSettings>) => {
    savePreferences({
      ...preferences,
      whisper: {
        ...preferences.whisper,
        ...updates,
      },
    });
    logger.info('Whisper settings updated', { updates: Object.keys(updates) });
  }, [preferences, savePreferences]);
  
  const resetGeneralSettings = useCallback(() => {
    savePreferences({
      ...preferences,
      general: DEFAULT_PREFERENCES.general,
    });
    logger.info('General settings reset to defaults');
  }, [preferences, savePreferences]);
  
  const resetWhisperSettings = useCallback(() => {
    savePreferences({
      ...preferences,
      whisper: DEFAULT_PREFERENCES.whisper,
    });
    logger.info('Whisper settings reset to defaults');
  }, [preferences, savePreferences]);
  
  const resetAllPreferences = useCallback(() => {
    savePreferences(DEFAULT_PREFERENCES);
    logger.info('All preferences reset to defaults');
  }, [savePreferences]);
  
  return {
    preferences,
    isLoaded,
    updateGeneralSettings,
    updateWhisperSettings,
    resetGeneralSettings,
    resetWhisperSettings,
    resetAllPreferences,
  };
}
