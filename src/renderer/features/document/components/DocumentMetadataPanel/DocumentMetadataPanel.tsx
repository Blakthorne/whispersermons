/**
 * DocumentMetadataPanel - Collapsible panel for editing document metadata
 *
 * Provides editable fields for title, speaker, Bible reference, and tags.
 * Can be collapsed to maximize editor space.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Type, User, BookOpen, Tags } from 'lucide-react';
import { EditableTextField } from './EditableTextField';
import { TagsInput } from './TagsInput';
import './DocumentMetadataPanel.css';

const STORAGE_KEY = 'whisperdesk.metadataPanel.collapsed';

export interface DocumentMetadataPanelProps {
  /** Document title */
  title: string | undefined;
  /** Speaker name */
  speaker: string | undefined;
  /** Bible reference */
  biblePassage: string | undefined;
  /** Document tags */
  tags: string[];
  /** Callback when title changes */
  onTitleChange: (title: string) => void;
  /** Callback when speaker changes */
  onSpeakerChange: (speaker: string) => void;
  /** Callback when Bible reference changes */
  onBiblePassageChange: (passage: string) => void;
  /** Callback when tags change */
  onTagsChange: (tags: string[]) => void;
  /** Additional CSS class */
  className?: string;
  /** Whether the panel is disabled */
  disabled?: boolean;
  /** Initial collapsed state (overrides localStorage) */
  defaultCollapsed?: boolean;
}

export function DocumentMetadataPanel({
  title,
  speaker,
  biblePassage,
  tags,
  onTitleChange,
  onSpeakerChange,
  onBiblePassageChange,
  onTagsChange,
  className = '',
  disabled = false,
  defaultCollapsed,
}: DocumentMetadataPanelProps): React.JSX.Element {
  // Initialize collapsed state from localStorage or prop
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (defaultCollapsed !== undefined) {
      return defaultCollapsed;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(isCollapsed));
    } catch {
      // Ignore localStorage errors
    }
  }, [isCollapsed]);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapsed();
      }
    },
    [toggleCollapsed]
  );

  return (
    <div
      className={`document-metadata-panel ${className} ${isCollapsed ? 'document-metadata-panel--collapsed' : ''}`}
    >
      {/* Header with collapse toggle */}
      <div
        className="document-metadata-panel__header"
        onClick={toggleCollapsed}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        aria-controls="document-metadata-content"
      >
        <span className="document-metadata-panel__toggle">
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
        <span className="document-metadata-panel__title">Sermon Properties</span>

        {/* Show summary when collapsed */}
        {isCollapsed && title && <span className="document-metadata-panel__summary">{title}</span>}
      </div>

      {/* Collapsible content */}
      <div
        id="document-metadata-content"
        className="document-metadata-panel__content"
        aria-hidden={isCollapsed}
      >
        <div style={{ marginBottom: '8px' }} />
        <div className="document-metadata-panel__fields">
          {/* Title field */}
          <EditableTextField
            value={title}
            onChange={onTitleChange}
            placeholder="Enter sermon title..."
            label="Title"
            icon={<Type size={14} />}
            disabled={disabled}
            className="document-metadata-panel__field"
          />

          {/* Speaker field */}
          <EditableTextField
            value={speaker}
            onChange={onSpeakerChange}
            placeholder="Enter speaker name..."
            label="Speaker"
            icon={<User size={14} />}
            disabled={disabled}
            className="document-metadata-panel__field"
          />

          {/* Bible Reference field */}
          <EditableTextField
            value={biblePassage}
            onChange={onBiblePassageChange}
            placeholder="Enter Bible reference..."
            label="Reference"
            icon={<BookOpen size={14} />}
            disabled={disabled}
            className="document-metadata-panel__field"
          />

          {/* Tags field */}
          <div className="document-metadata-panel__field document-metadata-panel__field--tags">
            <label className="document-metadata-panel__label">
              <Tags size={14} />
              <span>Tags</span>
            </label>
            <TagsInput
              tags={tags}
              onChange={onTagsChange}
              placeholder="Add tag..."
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DocumentMetadataPanel;
