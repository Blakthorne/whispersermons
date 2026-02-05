/**
 * Preferences Feature Module
 * 
 * Provides a macOS-style Preferences dialog with Whisper transcription settings.
 */

// Types
export type { 
  WhisperAdvancedSettings, 
  AppPreferences, 
  PreferencesTab 
} from './types';

// Constants
export { 
  DEFAULT_WHISPER_SETTINGS, 
  DEFAULT_PREFERENCES,
  PREFERENCES_VERSION,
  TEMPERATURE_PRESETS,
  SETTINGS_HELP,
} from './constants';

// Hooks
export { usePreferences, usePreferencesDialog } from './hooks';

// Components
export { PreferencesDialog, TabButton, TranscriptionSettings } from './components';
