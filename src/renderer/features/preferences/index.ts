/**
 * Preferences Feature Module
 * 
 * Provides a macOS-style Preferences dialog with Whisper transcription settings.
 */

// Types
export type { 
  GeneralSettings,
  WhisperAdvancedSettings, 
  AppPreferences, 
  PreferencesTab 
} from './types';

// Constants
export { 
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_WHISPER_SETTINGS, 
  DEFAULT_PREFERENCES,
  PREFERENCES_VERSION,
  TEMPERATURE_PRESETS,
  SETTINGS_HELP,
} from './constants';

// Hooks
export { usePreferences, usePreferencesDialog } from './hooks';

// Components
export { GeneralSettingsPanel, PreferencesDialog, TabButton, TranscriptionSettings } from './components';
