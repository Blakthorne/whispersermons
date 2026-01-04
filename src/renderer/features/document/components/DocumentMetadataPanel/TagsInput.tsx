/**
 * TagsInput - Tag pill editor with add/remove functionality
 *
 * Displays existing tags as pill chips with X buttons.
 * Provides an input field for adding new tags via Enter or comma.
 */

import React, { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

export interface TagsInputProps {
  /** Current tags */
  tags: string[];
  /** Callback when tags change */
  onChange: (tags: string[]) => void;
  /** Placeholder for input */
  placeholder?: string;
  /** Maximum number of tags allowed */
  maxTags?: number;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
}

export function TagsInput({
  tags,
  onChange,
  placeholder = 'Add tag...',
  maxTags,
  disabled = false,
  className = '',
}: TagsInputProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = useCallback(
    (tagText: string) => {
      const trimmed = tagText.trim();
      // Don't add empty, duplicate, or if at max
      if (!trimmed) return;
      if (tags.includes(trimmed)) return;
      if (maxTags && tags.length >= maxTags) return;

      onChange([...tags, trimmed]);
      setInputValue('');
    },
    [tags, onChange, maxTags]
  );

  const removeTag = useCallback(
    (index: number) => {
      const newTags = [...tags];
      newTags.splice(index, 1);
      onChange(newTags);
    },
    [tags, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addTag(inputValue);
      } else if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
        // Remove last tag when backspace on empty input
        removeTag(tags.length - 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setInputValue('');
        inputRef.current?.blur();
      }
    },
    [inputValue, tags.length, addTag, removeTag]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Handle comma in paste by splitting and adding tags
      const value = e.target.value;
      if (value.includes(',')) {
        const parts = value.split(',');
        parts.forEach((part, index) => {
          if (index < parts.length - 1) {
            // Add all parts except the last (which stays in input)
            const trimmed = part.trim();
            if (trimmed && !tags.includes(trimmed)) {
              tags.push(trimmed);
            }
          } else {
            setInputValue(part);
          }
        });
        onChange([...tags]);
      } else {
        setInputValue(value);
      }
    },
    [tags, onChange]
  );

  const handleBlur = useCallback(() => {
    // Add tag on blur if there's text
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  }, [inputValue, addTag]);

  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const canAddMore = !maxTags || tags.length < maxTags;

  return (
    <div className={`tags-input ${className} ${disabled ? 'tags-input--disabled' : ''}`}>
      <div
        className="tags-input__container"
        onClick={handleContainerClick}
        role="group"
        aria-label="Tags"
      >
        {/* Existing tags as pills */}
        {tags.map((tag, index) => (
          <span key={`${tag}-${index}`} className="tags-input__tag">
            <span className="tags-input__tag-text">{tag}</span>
            {!disabled && (
              <button
                type="button"
                className="tags-input__tag-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(index);
                }}
                aria-label={`Remove tag ${tag}`}
                tabIndex={-1}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}

        {/* Input for new tags */}
        {!disabled && canAddMore && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={tags.length === 0 ? placeholder : ''}
            className="tags-input__input"
            aria-label="Add new tag"
          />
        )}

        {/* Empty state placeholder */}
        {disabled && tags.length === 0 && <span className="tags-input__empty">No tags</span>}
      </div>
    </div>
  );
}

export default TagsInput;
