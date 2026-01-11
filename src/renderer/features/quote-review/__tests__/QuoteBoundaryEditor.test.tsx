import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuoteBoundaryEditor } from '../components/QuoteBoundaryEditor';

describe('QuoteBoundaryEditor', () => {
  let quoteElement: HTMLDivElement;
  const onBoundaryChange = vi.fn();
  const onEditStart = vi.fn();
  const onEditEnd = vi.fn();
  const onCrossParagraphDrag = vi.fn();

  beforeEach(() => {
    // Setup mock quote element
    quoteElement = document.createElement('div');
    quoteElement.textContent = 'For God so loved the world';
    quoteElement.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 100,
        right: 300,
        bottom: 120,
        width: 200,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => {},
      }) as DOMRect;
    document.body.appendChild(quoteElement);
  });

  afterEach(() => {
    document.body.removeChild(quoteElement);
    vi.clearAllMocks();
  });

  it('constrains handle to quote element bounds during drag', () => {
    render(
      <QuoteBoundaryEditor
        quoteElement={quoteElement}
        quoteText="For God so loved the world"
        isActive={true}
        onBoundaryChange={onBoundaryChange}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        onCrossParagraphDrag={onCrossParagraphDrag}
        enableWordSnapping={false}
      />
    );

    const handles = screen.getAllByRole('slider');
    const startHandle = handles[0];

    // Initial position
    expect(startHandle.style.top).toBe('96px');
    expect(startHandle.style.left).toBe('92px');

    // Simulate Mouse Down
    fireEvent.mouseDown(startHandle, {
      clientX: 102,
      clientY: 106,
    });

    // Try to drag WAY outside the quote bounds (e.g., to x=500)
    fireEvent.mouseMove(document, {
      clientX: 500,
      clientY: 106,
    });

    // Handle should be constrained to quote right edge (300) + 10px margin - 8px offset = 302px
    // quoteRect.right (300) + 10 - 8 = 302
    expect(startHandle.style.left).toBe('302px');

    // Vertical position should be constrained within quote bounds
    // mouseY=106, constrained to [90, 130], then -14 for centering = 92px
    expect(startHandle.style.top).toBe('92px');

    expect(startHandle.className).toContain('dragging');
  });

  it('constrains handle to left boundary during drag', () => {
    render(
      <QuoteBoundaryEditor
        quoteElement={quoteElement}
        quoteText="For God so loved the world"
        isActive={true}
        onBoundaryChange={onBoundaryChange}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        onCrossParagraphDrag={onCrossParagraphDrag}
        enableWordSnapping={false}
      />
    );

    const handles = screen.getAllByRole('slider');
    const startHandle = handles[0];

    // Simulate Mouse Down
    fireEvent.mouseDown(startHandle, {
      clientX: 102,
      clientY: 106,
    });

    // Try to drag WAY outside to the left (e.g., to x=0)
    fireEvent.mouseMove(document, {
      clientX: 0,
      clientY: 106,
    });

    // Handle should be constrained to quote left edge (100) - 10px margin - 8px offset = 82px
    // quoteRect.left (100) - 10 - 8 = 82
    expect(startHandle.style.left).toBe('82px');
  });
});
