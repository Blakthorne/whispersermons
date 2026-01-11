/**
 * UndoToast Component
 *
 * A prominent toast notification that appears when auto-merge or other
 * undoable actions occur. Provides a clear "Undo" button with countdown.
 *
 * Features:
 * - Auto-dismiss after timeout (default 5 seconds)
 * - Visual countdown indicator
 * - Keyboard shortcut support (Ctrl/Cmd+Z)
 * - Multiple toast stacking
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './UndoToast.css';

export interface UndoToastItem {
  id: string;
  message: string;
  actionLabel?: string;
  onUndo: () => void;
  autoHideDuration?: number;
}

interface UndoToastProps {
  toasts: UndoToastItem[];
  onDismiss: (id: string) => void;
}

interface SingleToastProps {
  toast: UndoToastItem;
  onDismiss: () => void;
}

/**
 * Single toast notification
 */
function SingleToast({ toast, onDismiss }: SingleToastProps): React.JSX.Element {
  const duration = toast.autoHideDuration ?? 5000;
  const [remaining, setRemaining] = useState(duration);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Countdown timer
  useEffect(() => {
    if (isPaused) return;

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 100) {
          onDismiss();
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPaused, onDismiss]);

  // Handle keyboard undo shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        toast.onUndo();
        onDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toast, onDismiss]);

  const handleUndo = useCallback(() => {
    toast.onUndo();
    onDismiss();
  }, [toast, onDismiss]);

  const progressPercent = (remaining / duration) * 100;

  return (
    <div
      className="undo-toast"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="alert"
      aria-live="polite"
    >
      <div className="undo-toast-content">
        <div className="undo-toast-icon">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </div>
        <span className="undo-toast-message">{toast.message}</span>
        <button className="undo-toast-button" onClick={handleUndo}>
          {toast.actionLabel ?? 'Undo'}
          <span className="undo-toast-shortcut">⌘Z</span>
        </button>
        <button className="undo-toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
      <div className="undo-toast-progress">
        <div className="undo-toast-progress-bar" style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

/**
 * Toast container that manages multiple toasts
 */
export function UndoToastContainer({
  toasts,
  onDismiss,
}: UndoToastProps): React.JSX.Element | null {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="undo-toast-container">
      {toasts.map((toast) => (
        <SingleToast key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

/**
 * Hook to manage undo toast state
 */
export interface UseUndoToastReturn {
  toasts: UndoToastItem[];
  showToast: (toast: Omit<UndoToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;
}

export function useUndoToast(): UseUndoToastReturn {
  const [toasts, setToasts] = useState<UndoToastItem[]>([]);
  const toastIdCounter = useRef(0);

  const showToast = useCallback((toast: Omit<UndoToastItem, 'id'>): string => {
    const id = `toast-${++toastIdCounter.current}-${Date.now()}`;
    const newToast: UndoToastItem = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    showToast,
    dismissToast,
    clearAllToasts,
  };
}

export default UndoToastContainer;
