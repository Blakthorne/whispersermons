/**
 * Preferences Feature Constants
 * 
 * Default values for Whisper transcription settings matching the
 * hardcoded values in whisper_bridge.py.
 */

import type { WhisperAdvancedSettings, AppPreferences } from './types';

/**
 * Default Whisper advanced settings
 * These match the hardcoded values in src/python/whisper_bridge.py
 */
export const DEFAULT_WHISPER_SETTINGS: WhisperAdvancedSettings = {
  // Temperature fallback cascade for sampling
  temperature: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
  
  // Beam search parameters
  beamSize: 5,
  bestOf: 5,
  patience: null,
  
  // Quality control thresholds
  compressionRatioThreshold: 2.4,
  logprobThreshold: -1.0,
  noSpeechThreshold: null, // Disabled to prevent skipping audio segments
  
  // Context and behavior
  conditionOnPreviousText: true,
  wordTimestamps: false,
  initialPrompt: 'This is a clear audio recording of speech.',
  
  // Performance
  fp16: true, // Auto-enabled for GPU (MPS/CUDA)
  hallucinationSilenceThreshold: null, // Disabled by default
};

/**
 * Default app preferences with version for migrations
 */
export const DEFAULT_PREFERENCES: AppPreferences = {
  whisper: DEFAULT_WHISPER_SETTINGS,
  version: 1,
};

/**
 * Current preferences schema version
 */
export const PREFERENCES_VERSION = 1;

/**
 * Temperature preset options for the UI
 */
export const TEMPERATURE_PRESETS: Array<{
  label: string;
  value: number | number[];
  description: string;
}> = [
  {
    label: 'Cascade (Recommended)',
    value: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
    description: 'Tries lower temperatures first, falls back to higher if quality is low',
  },
  {
    label: 'Deterministic',
    value: 0.0,
    description: 'Uses beam search for most consistent results',
  },
  {
    label: 'Low',
    value: 0.2,
    description: 'Slight variation, good balance of accuracy and naturalness',
  },
  {
    label: 'Medium',
    value: 0.5,
    description: 'More variation in transcription',
  },
  {
    label: 'High',
    value: 0.8,
    description: 'Most variation, may help with difficult audio',
  },
];

/**
 * Help text for each setting
 */
export const SETTINGS_HELP: Record<keyof WhisperAdvancedSettings, string> = {
  temperature: 
    'Controls randomness in transcription. Use cascade (default) for automatic fallback, or a single value for consistent behavior.',
  beamSize: 
    'Number of beams for beam search when temperature is 0. Higher values may improve accuracy but are slower.',
  bestOf: 
    'Number of candidates to consider when sampling (temperature > 0). Higher values may improve quality.',
  patience: 
    'Patience factor for beam search. Higher values explore more options. Leave disabled for default behavior.',
  compressionRatioThreshold: 
    'If a segment has a gzip compression ratio above this, it may indicate repetition/failure and will be retried.',
  logprobThreshold: 
    'If the average log probability of a segment is below this, it may indicate poor quality and will be retried.',
  noSpeechThreshold: 
    'Probability threshold for detecting silence. Disabled by default to prevent accidentally skipping speech.',
  conditionOnPreviousText: 
    'Use previous segment text as context. Improves coherence but may propagate transcription errors.',
  wordTimestamps: 
    'Extract word-level timestamps. Useful for precise alignment but slightly slower.',
  initialPrompt: 
    'Initial context to guide transcription. Can include punctuation style, technical terms, or speaker context.',
  fp16: 
    'Use half-precision (16-bit float) on GPU for faster processing. Disable if you experience quality issues.',
  hallucinationSilenceThreshold: 
    'Skip silent periods where model outputs text (hallucinations). Disabled by default.',
};
