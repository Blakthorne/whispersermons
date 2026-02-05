---
goal: Implement macOS-style Preferences Dialog with Whisper Transcription Settings
version: 1.0
date_created: 2026-02-04
last_updated: 2026-02-04
owner: WhisperSermons Team
status: 'Planned'
tags: [feature, ui, preferences, settings, whisper, macos]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan implements a macOS-style Preferences dialog window accessible from the app header's status bar. The dialog follows Apple Human Interface Guidelines for settings windows and provides a tabular interface for configuring Whisper transcription parameters. The first tab, "Transcription," allows users to fine-tune Whisper model parameters that are currently hardcoded. All settings persist across app sessions using localStorage.

## 1. Requirements & Constraints

### Functional Requirements

- **REQ-001**: Preferences dialog accessible via a settings icon button in the app header (status bar area)
- **REQ-002**: Dialog must use tabular navigation with tab buttons in a toolbar-like header
- **REQ-003**: Initial implementation includes only "Transcription" tab with Whisper parameters
- **REQ-004**: All Whisper transcription parameters must be configurable:
  - `temperature` - Sampling temperature (single value or fallback cascade)
  - `beam_size` - Number of beams for beam search (when temperature=0)
  - `best_of` - Number of candidates when sampling (when temperature>0)
  - `patience` - Optional patience value for beam decoding
  - `compression_ratio_threshold` - Threshold to detect repetitions (default: 2.4)
  - `logprob_threshold` - Average log probability threshold (default: -1.0)
  - `no_speech_threshold` - Silence detection threshold (default: 0.6, app disables it with `null`)
  - `condition_on_previous_text` - Use context from previous segments (default: true)
  - `word_timestamps` - Extract word-level timestamps (default: false)
  - `initial_prompt` - Context prompt for transcription (default: "This is a clear audio recording of speech.")
  - `fp16` - Use half-precision on GPU (default: true for MPS/CUDA)
  - `hallucination_silence_threshold` - Skip silent periods threshold (default: null/disabled)
- **REQ-005**: Settings must persist to localStorage and survive app restarts
- **REQ-006**: Settings must be passed to Python whisper_bridge.py during transcription
- **REQ-007**: Dialog must support keyboard shortcut Cmd+, (standard macOS settings shortcut)

### Design Requirements

- **DES-001**: Dialog must match existing app styling (CSS variables, animations, border-radius)
- **DES-002**: Follow existing modal patterns (see DebugLogsModal as reference)
- **DES-003**: Use existing Button, input components for consistency
- **DES-004**: Support both light and dark themes via CSS variables
- **DES-005**: Modal overlay with blur backdrop matching DebugLogsModal
- **DES-006**: Tab buttons should indicate active state clearly
- **DES-007**: Form controls should use consistent spacing and grouping

### macOS HIG Compliance

- **HIG-001**: Settings item accessible from a recognizable location (settings gear icon)
- **HIG-002**: Restore most recently viewed pane when reopening (single pane for v1)
- **HIG-003**: Cmd+, keyboard shortcut support
- **HIG-004**: Group related settings visually with section headers
- **HIG-005**: Provide sensible defaults that work for most users
- **HIG-006**: Minimize number of settings to avoid overwhelming users
- **HIG-007**: Advanced options should be collapsible or in separate section

### Technical Constraints

- **CON-001**: Use React 19 with TypeScript strict mode
- **CON-002**: Follow existing feature-driven architecture in `src/renderer/features/`
- **CON-003**: Use existing CSS variable system from `src/renderer/index.css`
- **CON-004**: Persist settings using localStorage via existing `src/renderer/utils/storage.ts` pattern
- **CON-005**: Pass settings through IPC to Python backend via existing patterns
- **CON-006**: Must not break existing transcription functionality

### Patterns to Follow

- **PAT-001**: Modal structure from `src/renderer/components/ui/DebugLogsModal/`
- **PAT-002**: CSS styling patterns from `src/renderer/index.css` and `App.css`
- **PAT-003**: Settings panel layout from `src/renderer/features/settings/components/SettingsPanel/`
- **PAT-004**: Persistence pattern from `src/renderer/hooks/useTheme.ts`
- **PAT-005**: Feature module structure with barrel exports from `src/renderer/features/*/index.ts`

## 2. Implementation Steps

### Implementation Phase 1: Types and Storage Infrastructure

- GOAL-001: Define TypeScript types for Whisper advanced settings and extend storage utilities

| Task     | Description                                                                                                                                                                              | Completed | Date |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-001 | Create `src/renderer/features/preferences/types.ts` with `WhisperAdvancedSettings` interface containing all Whisper transcription parameters with proper TypeScript types              |           |      |
| TASK-002 | Add `PREFERENCES` key to `STORAGE_KEYS` constant in `src/renderer/utils/storage.ts`                                                                                                     |           |      |
| TASK-003 | Create `src/renderer/features/preferences/constants.ts` with `DEFAULT_WHISPER_SETTINGS` object matching current hardcoded values from `whisper_bridge.py`                               |           |      |
| TASK-004 | Extend `src/shared/types.ts` `TranscriptionOptions` interface to include optional `advancedSettings?: WhisperAdvancedSettings`                                                           |           |      |

### Implementation Phase 2: Preferences Hook and Context

- GOAL-002: Create React hook for managing preferences state with localStorage persistence

| Task     | Description                                                                                                                                                                                      | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-005 | Create `src/renderer/features/preferences/hooks/usePreferences.ts` with state management, load/save functions, and reset to defaults capability                                                 |           |      |
| TASK-006 | Create `src/renderer/features/preferences/hooks/usePreferencesDialog.ts` with `isOpen`, `openDialog`, `closeDialog` state management                                                             |           |      |
| TASK-007 | Create `src/renderer/features/preferences/hooks/index.ts` barrel export                                                                                                                          |           |      |
| TASK-008 | Add `PreferencesContext` to `src/renderer/contexts/AppContext.tsx` to expose preferences and dialog state to entire app                                                                          |           |      |
| TASK-009 | Export preferences context hooks from `src/renderer/contexts/index.ts`                                                                                                                           |           |      |

### Implementation Phase 3: Preferences Dialog UI Components

- GOAL-003: Build the modal dialog with tabular navigation following existing DebugLogsModal patterns

| Task     | Description                                                                                                                                                                                           | Completed | Date |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-010 | Create `src/renderer/features/preferences/components/PreferencesDialog/PreferencesDialog.css` with modal overlay, dialog container, tab bar, and content area styles matching app theme             |           |      |
| TASK-011 | Create `src/renderer/features/preferences/components/PreferencesDialog/PreferencesDialog.tsx` with modal structure, Escape key handler, overlay click-to-close, and tab navigation                   |           |      |
| TASK-012 | Create `src/renderer/features/preferences/components/PreferencesDialog/index.ts` barrel export                                                                                                        |           |      |
| TASK-013 | Create `src/renderer/features/preferences/components/TabButton/TabButton.tsx` reusable tab button component with active state styling                                                                 |           |      |
| TASK-014 | Create `src/renderer/features/preferences/components/TabButton/TabButton.css` with tab button styles                                                                                                  |           |      |
| TASK-015 | Create `src/renderer/features/preferences/components/TabButton/index.ts` barrel export                                                                                                                |           |      |

### Implementation Phase 4: Transcription Settings Tab Content

- GOAL-004: Create the Transcription tab with all Whisper parameter controls organized into logical sections

| Task     | Description                                                                                                                                                                                                                          | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-016 | Create `src/renderer/features/preferences/components/TranscriptionSettings/TranscriptionSettings.tsx` with form controls for all Whisper parameters organized in sections: Basic, Quality Control, Advanced                         |           |      |
| TASK-017 | Create `src/renderer/features/preferences/components/TranscriptionSettings/TranscriptionSettings.css` with form layout styles matching SettingsPanel patterns                                                                         |           |      |
| TASK-018 | Create `src/renderer/features/preferences/components/TranscriptionSettings/index.ts` barrel export                                                                                                                                    |           |      |
| TASK-019 | Implement "Basic Settings" section: `initial_prompt` (textarea), `condition_on_previous_text` (toggle), `word_timestamps` (toggle)                                                                                                    |           |      |
| TASK-020 | Implement "Quality Control" section: `temperature` (input/preset selector), `compression_ratio_threshold` (number input), `logprob_threshold` (number input), `no_speech_threshold` (number input with null/disabled option)          |           |      |
| TASK-021 | Implement "Advanced Settings" section (collapsible): `beam_size` (number input), `best_of` (number input), `patience` (number input), `fp16` (toggle), `hallucination_silence_threshold` (number input with null/disabled option)     |           |      |
| TASK-022 | Add "Reset to Defaults" button at bottom of Transcription settings tab                                                                                                                                                                |           |      |
| TASK-023 | Add tooltips/help text for each setting explaining what it does                                                                                                                                                                       |           |      |

### Implementation Phase 5: Feature Module Integration

- GOAL-005: Assemble feature module with proper exports and integrate with app

| Task     | Description                                                                                                                                                      | Completed | Date |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-024 | Create `src/renderer/features/preferences/components/index.ts` barrel export for all components                                                                  |           |      |
| TASK-025 | Create `src/renderer/features/preferences/index.ts` main feature barrel export                                                                                   |           |      |
| TASK-026 | Add settings gear icon button to `src/renderer/components/layout/AppHeader/AppHeader.tsx` between Debug Logs and Theme toggle buttons                           |           |      |
| TASK-027 | Import and render `PreferencesDialog` in AppHeader with dialog state from context                                                                                |           |      |

### Implementation Phase 6: Keyboard Shortcut Integration

- GOAL-006: Add Cmd+, keyboard shortcut to open preferences dialog

| Task     | Description                                                                                                                                                               | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-028 | Add `preferences:open` IPC handler in `src/main/ipc/index.ts` to notify renderer when shortcut is triggered                                                               |           |      |
| TASK-029 | Register Cmd+, (Cmd+Comma) accelerator in main process menu or globalShortcut                                                                                             |           |      |
| TASK-030 | Update `src/renderer/hooks/useElectronMenu.ts` to handle preferences:open event and call `openPreferencesDialog`                                                          |           |      |
| TASK-031 | Add preload API for preferences:open event in `src/preload/index.ts`                                                                                                      |           |      |

### Implementation Phase 7: Backend Integration

- GOAL-007: Pass advanced Whisper settings to Python backend and use them during transcription

| Task     | Description                                                                                                                                                                        | Completed | Date |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-032 | Update `src/main/services/python-whisper.ts` `transcribe` and `processSermon` functions to accept and forward `advancedSettings` to Python                                        |           |      |
| TASK-033 | Update `src/python/whisper_bridge.py` `transcribe_audio` function to accept all advanced parameters and use them in `transcribe_kwargs` dictionary instead of hardcoded values    |           |      |
| TASK-034 | Update `src/python/whisper_bridge.py` `handle_command` to extract advanced settings from command and pass to `transcribe_audio`                                                   |           |      |
| TASK-035 | Update renderer's transcription service calls to include advanced settings from preferences context                                                                                |           |      |
| TASK-036 | Update `src/renderer/features/transcription/hooks/useBatchQueue.ts` to get preferences from context and include in transcription options                                           |           |      |

### Implementation Phase 8: Testing and Polish

- GOAL-008: Add tests and ensure quality

| Task     | Description                                                                                                                                                                                 | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-037 | Create `src/renderer/features/preferences/hooks/__tests__/usePreferences.test.ts` testing persistence, defaults, reset functionality                                                       |           |      |
| TASK-038 | Create `src/renderer/features/preferences/components/__tests__/PreferencesDialog.test.tsx` testing open/close, tab switching, Escape key                                                   |           |      |
| TASK-039 | Create `src/renderer/features/preferences/components/__tests__/TranscriptionSettings.test.tsx` testing form inputs, validation, reset                                                      |           |      |
| TASK-040 | Run `npm run typecheck` to ensure no TypeScript errors                                                                                                                                      |           |      |
| TASK-041 | Run `npm run lint` and fix any ESLint issues                                                                                                                                                |           |      |
| TASK-042 | Manual testing: verify dialog opens, settings persist, transcription uses new settings                                                                                                      |           |      |

## 3. Alternatives

- **ALT-001**: Electron native preferences window using `shell.openExternal` or native dialogs - rejected because it would break the hybrid Electron app model and lose React integration
- **ALT-002**: Inline settings expansion in existing SettingsPanel - rejected because it would clutter the main transcription workflow and doesn't follow macOS HIG for preferences
- **ALT-003**: Using electron-store for persistence instead of localStorage - rejected because localStorage is simpler, already used in the app, and preferences don't need cross-process access
- **ALT-004**: Implementing all Whisper parameters in a single flat form - rejected in favor of collapsible sections to reduce cognitive load per macOS HIG

## 4. Dependencies

- **DEP-001**: Existing `src/renderer/components/ui/Button` component for dialog buttons
- **DEP-002**: Existing `src/renderer/utils/storage.ts` for localStorage utilities
- **DEP-003**: Existing CSS variable system in `src/renderer/index.css`
- **DEP-004**: `lucide-react` for Settings gear icon (`Settings` or `Sliders` icon)
- **DEP-005**: React 19 Context API for global preferences state
- **DEP-006**: Existing IPC infrastructure for main ↔ renderer communication

## 5. Files

### New Files to Create

- **FILE-001**: `src/renderer/features/preferences/types.ts` - TypeScript interfaces for Whisper settings
- **FILE-002**: `src/renderer/features/preferences/constants.ts` - Default values for all settings
- **FILE-003**: `src/renderer/features/preferences/hooks/usePreferences.ts` - Settings state management hook
- **FILE-004**: `src/renderer/features/preferences/hooks/usePreferencesDialog.ts` - Dialog open/close state hook
- **FILE-005**: `src/renderer/features/preferences/hooks/index.ts` - Hooks barrel export
- **FILE-006**: `src/renderer/features/preferences/components/PreferencesDialog/PreferencesDialog.tsx` - Main dialog component
- **FILE-007**: `src/renderer/features/preferences/components/PreferencesDialog/PreferencesDialog.css` - Dialog styles
- **FILE-008**: `src/renderer/features/preferences/components/PreferencesDialog/index.ts` - Dialog barrel export
- **FILE-009**: `src/renderer/features/preferences/components/TabButton/TabButton.tsx` - Tab button component
- **FILE-010**: `src/renderer/features/preferences/components/TabButton/TabButton.css` - Tab button styles
- **FILE-011**: `src/renderer/features/preferences/components/TabButton/index.ts` - Tab button barrel export
- **FILE-012**: `src/renderer/features/preferences/components/TranscriptionSettings/TranscriptionSettings.tsx` - Transcription tab content
- **FILE-013**: `src/renderer/features/preferences/components/TranscriptionSettings/TranscriptionSettings.css` - Transcription tab styles
- **FILE-014**: `src/renderer/features/preferences/components/TranscriptionSettings/index.ts` - Transcription settings barrel export
- **FILE-015**: `src/renderer/features/preferences/components/index.ts` - Components barrel export
- **FILE-016**: `src/renderer/features/preferences/index.ts` - Feature main barrel export

### Files to Modify

- **FILE-017**: `src/renderer/utils/storage.ts` - Add PREFERENCES key to STORAGE_KEYS
- **FILE-018**: `src/shared/types.ts` - Add WhisperAdvancedSettings to TranscriptionOptions
- **FILE-019**: `src/renderer/contexts/AppContext.tsx` - Add PreferencesContext integration
- **FILE-020**: `src/renderer/contexts/index.ts` - Export preferences hooks
- **FILE-021**: `src/renderer/components/layout/AppHeader/AppHeader.tsx` - Add settings button and dialog
- **FILE-022**: `src/main/services/python-whisper.ts` - Pass advanced settings to Python
- **FILE-023**: `src/python/whisper_bridge.py` - Accept and use advanced settings in transcription
- **FILE-024**: `src/preload/index.ts` - Add preferences IPC handlers (if needed for keyboard shortcut)
- **FILE-025**: `src/main/ipc/index.ts` - Add preferences IPC handlers (if needed)
- **FILE-026**: `src/renderer/features/transcription/hooks/useBatchQueue.ts` - Include advanced settings in transcription calls

## 6. Testing

- **TEST-001**: Unit test `usePreferences` hook - verify initial load from localStorage, save on change, reset to defaults
- **TEST-002**: Unit test `usePreferencesDialog` hook - verify open/close state management
- **TEST-003**: Component test `PreferencesDialog` - verify renders when open, Escape key closes, overlay click closes, tab switching works
- **TEST-004**: Component test `TranscriptionSettings` - verify all form inputs render, onChange handlers fire, values update correctly
- **TEST-005**: Integration test - verify settings persist across page reload
- **TEST-006**: Integration test - verify settings are passed to Python backend in transcription calls
- **TEST-007**: Manual test - verify Cmd+, shortcut opens dialog
- **TEST-008**: Manual test - verify transcription produces different results with changed settings (e.g., word_timestamps)

## 7. Risks & Assumptions

### Risks

- **RISK-001**: Performance impact if settings object is large and serialized frequently - MITIGATION: Debounce localStorage writes
- **RISK-002**: Breaking existing transcription if Python backend rejects new parameters - MITIGATION: Use try/catch and default to hardcoded values if parameter passing fails
- **RISK-003**: User confusion with advanced Whisper settings - MITIGATION: Provide clear help text, sensible defaults, and collapsible advanced section
- **RISK-004**: Inconsistent state if localStorage is cleared - MITIGATION: Always fall back to defaults

### Assumptions

- **ASSUMPTION-001**: Users understand basic audio transcription concepts (language, model size)
- **ASSUMPTION-002**: Advanced settings (beam_size, patience) are for power users only
- **ASSUMPTION-003**: Existing DebugLogsModal pattern is the preferred modal style for this app
- **ASSUMPTION-004**: localStorage is reliable for storing small amounts of settings data
- **ASSUMPTION-005**: Python Whisper model accepts all parameters defined in OpenAI's transcribe() function

## 8. Related Specifications / Further Reading

- [Apple Human Interface Guidelines - Settings](https://developer.apple.com/design/human-interface-guidelines/settings)
- [Apple Human Interface Guidelines - The Menu Bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)
- [Apple Human Interface Guidelines - Modality](https://developer.apple.com/design/human-interface-guidelines/modality)
- [OpenAI Whisper transcribe.py source](https://github.com/openai/whisper/blob/main/whisper/transcribe.py)
- [Existing DebugLogsModal implementation](src/renderer/components/ui/DebugLogsModal/DebugLogsModal.tsx)
- [Existing SettingsPanel implementation](src/renderer/features/settings/components/SettingsPanel/SettingsPanel.tsx)
- [WhisperSermons Copilot Instructions](/.github/copilot-instructions.md)
