import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, Undo2 } from 'lucide-react';
import { Button } from '../Button/Button';
import './FloatingActionToolbar.css';

interface FloatingActionToolbarProps {
  /** Callback when user confirms action */
  onConfirm: () => void;
  /** Callback when user cancels action */
  onCancel: () => void;
  /** Optional callback to reset to original state */
  onReset?: () => void;
  /** Label for confirm button (default: "Save") */
  confirmLabel?: string;
  /** Label for cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Main message/hint to display */
  title?: string;
  /** Whether the toolbar is user-visible */
  isVisible: boolean;
  /** Optional container for portal (default: document.body) */
  container?: Element | DocumentFragment;
}

/**
 * FloatingActionToolbar
 *
 * A fixed pill-shaped toolbar that floats at the bottom of the screen.
 * Used for confirming contextual edit modes (e.g., Edit Boundary).
 * Renders into a Portal to ensure it sits above all z-indexes.
 */
export const FloatingActionToolbar: React.FC<FloatingActionToolbarProps> = ({
  onConfirm,
  onCancel,
  onReset,
  confirmLabel = 'Done',
  cancelLabel = 'Cancel',
  title,
  isVisible,
  container = document.body,
}) => {
  // Use state to handle hydration/mounting check for portal
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        // Cmd+Enter or Ctrl+Enter to confirm
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onCancel, onConfirm]);

  if (!mounted || !isVisible) return null;

  return createPortal(
    <div className="floating-action-toolbar-overlay">
      <div className="floating-action-toolbar" role="toolbar" aria-label="Action Toolbar">
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          icon={<X size={16} />}
          aria-label={cancelLabel}
        >
          {cancelLabel}
        </Button>

        {onReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            iconOnly={true}
            icon={<Undo2 size={16} />}
            aria-label="Reset Changes"
          />
        )}

        {(title || onReset) && <div className="floating-action-toolbar__divider" />}

        {title && <span className="floating-action-toolbar__hint">{title}</span>}

        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
          icon={<Check size={16} />}
          className="font-semibold"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>,
    container
  );
};

export default FloatingActionToolbar;
