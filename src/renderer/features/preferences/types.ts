/**
 * Preferences Feature Types
 * 
 * TypeScript interfaces for Whisper transcription advanced settings
 * and preferences management.
 */

/**
 * Advanced Whisper transcription settings that can be configured
 * in the Preferences dialog.
 * 
 * Uses mlx-whisper for Apple Silicon optimized transcription.
 * @see https://github.com/ml-explore/mlx-examples/tree/main/whisper
 */
export interface WhisperAdvancedSettings {
  /**
   * Sampling temperature for transcription.
   * Can be a single value or a tuple for temperature fallback cascade.
   * Default: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0] (fallback cascade)
   * 
   * When temperature is 0, greedy decoding is used. When > 0, sampling is used.
   */
  temperature: number | number[];

  /**
   * Number of beams for beam search (used when temperature=0).
   * NOTE: Not currently implemented in mlx-whisper. Kept for compatibility.
   * Default: 5
   */
  beamSize: number;

  /**
   * Number of candidates when sampling with temperature > 0.
   * Default: 5
   */
  bestOf: number;

  /**
   * Optional patience value for beam decoding.
   * NOTE: Requires beam search which is not implemented in mlx-whisper.
   * Default: null (disabled)
   */
  patience: number | null;

  /**
   * Threshold to detect repetitions based on compression ratio.
   * If the gzip compression ratio is above this, segment may have failed.
   * Default: 2.4
   */
  compressionRatioThreshold: number;

  /**
   * Threshold for average log probability.
   * If below this, segment may have failed.
   * Default: -1.0
   */
  logprobThreshold: number;

  /**
   * Threshold for silence/no speech detection.
   * Higher values skip more silent segments.
   * Default: null (disabled to prevent skipping audio)
   */
  noSpeechThreshold: number | null;

  /**
   * Whether to use context from previous segments.
   * Can improve coherence but may propagate errors.
   * Default: true
   */
  conditionOnPreviousText: boolean;

  /**
   * Whether to extract word-level timestamps.
   * Default: false
   */
  wordTimestamps: boolean;

  /**
   * Initial context prompt to guide transcription.
   * Default: "This is a clear audio recording of speech."
   */
  initialPrompt: string;

  /**
   * Whether to use half-precision (FP16) on Apple Silicon GPU.
   * MLX natively supports fp16 on Apple Silicon for faster processing.
   * Default: true
   */
  fp16: boolean;

  /**
   * Threshold for detecting hallucinations in silent periods.
   * If set, skips regions where audio is silent but model outputs text.
   * Default: null (disabled)
   */
  hallucinationSilenceThreshold: number | null;
}

/**
 * All user preferences stored in the app
 */
export interface AppPreferences {
  /**
   * Advanced Whisper transcription settings
   */
  whisper: WhisperAdvancedSettings;
  
  /**
   * Version number for migration support
   */
  version: number;
}

/**
 * Active tab in the Preferences dialog
 */
export type PreferencesTab = 'transcription';
