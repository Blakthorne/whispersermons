/**
 * EditableTextField - Inline editable text field with blur-to-save behavior
 *
 * Displays as static text when not focused, becomes an input when clicked.
 * Saves changes on blur or Enter key.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface EditableTextFieldProps {
  /** Current value */
  value: string | undefined;
  /** Callback when value changes (on blur) */
  onChange: (value: string) => void;
  /** Placeholder text when empty */
  placeholder: string;
  /** Field label */
  label: string;
  /** Optional icon element */
  icon?: React.ReactNode;
  /** Additional CSS class */
  className?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
}

export function EditableTextField({
  value,
  onChange,
  placeholder,
  label,
  icon,
  className = '',
  disabled = false,
}: EditableTextFieldProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local value with prop value when it changes externally
  useEffect(() => {
    if (!isEditing) {
      setLocalValue(value ?? '');
    }
  }, [value, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = useCallback(() => {
    if (!disabled) {
      setIsEditing(true);
    }
  }, [disabled]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    const trimmedValue = localValue.trim();
    if (trimmedValue !== (value ?? '')) {
      onChange(trimmedValue);
    }
  }, [localValue, value, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inputRef.current?.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setLocalValue(value ?? '');
        setIsEditing(false);
      }
    },
    [value]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  }, []);

  const displayValue = value ?? '';
  const isEmpty = !displayValue;

  return (
    <div
      className={`editable-text-field ${className} ${disabled ? 'editable-text-field--disabled' : ''}`}
    >
      <label className="editable-text-field__label">
        {icon && <span className="editable-text-field__icon">{icon}</span>}
        <span className="editable-text-field__label-text">{label}</span>
      </label>

      <div
        className={`editable-text-field__content ${isEditing ? 'editable-text-field__content--editing' : ''}`}
        onClick={handleClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label={`Edit ${label}`}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="editable-text-field__input"
            aria-label={label}
          />
        ) : (
          <span
            className={`editable-text-field__value ${isEmpty ? 'editable-text-field__value--empty' : ''}`}
          >
            {isEmpty ? placeholder : displayValue}
          </span>
        )}
      </div>
    </div>
  );
}

export default EditableTextField;
