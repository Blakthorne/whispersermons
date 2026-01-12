import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FloatingActionToolbar } from '../FloatingActionToolbar';

describe('FloatingActionToolbar', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const onReset = vi.fn();

  it('should not render when not visible', () => {
    render(<FloatingActionToolbar isVisible={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('should render when visible', () => {
    render(<FloatingActionToolbar isVisible={true} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });

  it('should call onConfirm when save button is clicked', () => {
    render(
      <FloatingActionToolbar
        isVisible={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
        confirmLabel="Save Changes"
      />
    );
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('should call onCancel when cancel button is clicked', () => {
    render(<FloatingActionToolbar isVisible={true} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('should render title hint', () => {
    render(
      <FloatingActionToolbar
        isVisible={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
        title="Adjusting Boundary"
      />
    );
    expect(screen.getByText('Adjusting Boundary')).toBeInTheDocument();
  });

  it('should handle keyboard shortcuts', () => {
    render(<FloatingActionToolbar isVisible={true} onConfirm={onConfirm} onCancel={onCancel} />);

    // Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();

    // Cmd+Enter
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).toHaveBeenCalled();
  });
});
