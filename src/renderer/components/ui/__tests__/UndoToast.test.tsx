/**
 * UndoToast Component Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UndoToastContainer, useUndoToast, UndoToastItem } from '../UndoToast';
import { renderHook } from '@testing-library/react';

describe('UndoToastContainer', () => {
  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when toasts array is empty', () => {
    const { container } = render(<UndoToastContainer toasts={[]} onDismiss={mockOnDismiss} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a toast when provided', () => {
    const toasts: UndoToastItem[] = [
      { id: 'toast-1', message: 'Paragraphs merged', onUndo: vi.fn() },
    ];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('Paragraphs merged')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    const toasts: UndoToastItem[] = [
      { id: 'toast-1', message: 'First action', onUndo: vi.fn() },
      { id: 'toast-2', message: 'Second action', onUndo: vi.fn() },
    ];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('First action')).toBeInTheDocument();
    expect(screen.getByText('Second action')).toBeInTheDocument();
  });

  it('shows Undo button by default', () => {
    const toasts: UndoToastItem[] = [{ id: 'toast-1', message: 'Action taken', onUndo: vi.fn() }];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('shows custom action label when provided', () => {
    const toasts: UndoToastItem[] = [
      { id: 'toast-1', message: 'Action taken', onUndo: vi.fn(), actionLabel: 'Revert' },
    ];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('Revert')).toBeInTheDocument();
  });

  it('calls onUndo when undo button is clicked', () => {
    const onUndo = vi.fn();
    const toasts: UndoToastItem[] = [{ id: 'toast-1', message: 'Action taken', onUndo }];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    fireEvent.click(screen.getByText('Undo'));

    expect(onUndo).toHaveBeenCalled();
    expect(mockOnDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const toasts: UndoToastItem[] = [{ id: 'toast-1', message: 'Action taken', onUndo: vi.fn() }];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    fireEvent.click(screen.getByLabelText('Dismiss'));

    expect(mockOnDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('auto-dismisses after timeout', async () => {
    const toasts: UndoToastItem[] = [
      { id: 'toast-1', message: 'Action taken', onUndo: vi.fn(), autoHideDuration: 1000 },
    ];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(mockOnDismiss).not.toHaveBeenCalled();

    // Fast-forward timer
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(mockOnDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('shows keyboard shortcut hint', () => {
    const toasts: UndoToastItem[] = [{ id: 'toast-1', message: 'Action taken', onUndo: vi.fn() }];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('⌘Z')).toBeInTheDocument();
  });

  it('shows progress bar', () => {
    const toasts: UndoToastItem[] = [{ id: 'toast-1', message: 'Action taken', onUndo: vi.fn() }];

    render(<UndoToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(document.querySelector('.undo-toast-progress-bar')).toBeInTheDocument();
  });
});

describe('useUndoToast hook', () => {
  it('starts with empty toast array', () => {
    const { result } = renderHook(() => useUndoToast());

    expect(result.current.toasts).toEqual([]);
  });

  it('adds a toast when showToast is called', () => {
    const { result } = renderHook(() => useUndoToast());

    act(() => {
      result.current.showToast({ message: 'Test toast', onUndo: vi.fn() });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.message).toBe('Test toast');
  });

  it('returns toast id when showToast is called', () => {
    const { result } = renderHook(() => useUndoToast());

    let toastId: string = '';
    act(() => {
      toastId = result.current.showToast({ message: 'Test toast', onUndo: vi.fn() });
    });

    expect(toastId).toBeDefined();
    expect(toastId.startsWith('toast-')).toBe(true);
  });

  it('removes toast when dismissToast is called', () => {
    const { result } = renderHook(() => useUndoToast());

    let toastId: string = '';
    act(() => {
      toastId = result.current.showToast({ message: 'Test toast', onUndo: vi.fn() });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.dismissToast(toastId);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('clears all toasts when clearAllToasts is called', () => {
    const { result } = renderHook(() => useUndoToast());

    act(() => {
      result.current.showToast({ message: 'Toast 1', onUndo: vi.fn() });
      result.current.showToast({ message: 'Toast 2', onUndo: vi.fn() });
      result.current.showToast({ message: 'Toast 3', onUndo: vi.fn() });
    });

    expect(result.current.toasts).toHaveLength(3);

    act(() => {
      result.current.clearAllToasts();
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('generates unique ids for each toast', () => {
    const { result } = renderHook(() => useUndoToast());

    let id1: string = '';
    let id2: string = '';

    act(() => {
      id1 = result.current.showToast({ message: 'Toast 1', onUndo: vi.fn() });
      id2 = result.current.showToast({ message: 'Toast 2', onUndo: vi.fn() });
    });

    expect(id1).not.toBe(id2);
  });
});
