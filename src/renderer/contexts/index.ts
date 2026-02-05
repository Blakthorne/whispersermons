export { AppProvider } from './AppContext';
export { useAppTheme, useAppHistory, useAppTranscription } from './hooks';
export type { ThemeContextValue, HistoryContextValue, TranscriptionContextValue, DocumentSaveState } from './types';

// Preferences Context
export {
  PreferencesProvider,
  useAppPreferences,
  useAppPreferencesOptional,
} from './PreferencesContext';
export type { PreferencesContextValue } from './PreferencesContext';

// Quote Review Context
export {
  QuoteReviewProvider,
  useQuoteReview,
  useQuoteReviewOptional,
  isQuoteBeingEdited,
  isQuoteReviewed,
  getBoundaryChangeDebounceMs,
} from './QuoteReviewContext';
export type {
  QuoteReviewContextState,
  QuoteReviewContextActions,
  QuoteReviewContextValue,
} from '../types/quoteReview';

// Editor Actions Context
export {
  EditorActionsProvider,
  useEditorActions,
  useEditorActionsOptional,
} from './EditorActionsContext';
export type {
  EditorActionsContextValue,
  QuoteEditorActions,
} from './EditorActionsContext';
