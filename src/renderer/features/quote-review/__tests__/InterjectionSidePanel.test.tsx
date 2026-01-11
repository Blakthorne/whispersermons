/**
 * InterjectionSidePanel Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InterjectionSidePanel } from '../components/InterjectionSidePanel';
import type { PassageNode, InterjectionMetadata, NodeId } from '../../../../shared/documentModel';

// Helper to create a mock PassageNode
function createMockPassage(interjections: InterjectionMetadata[] = []): PassageNode {
  return {
    id: 'passage-1' as NodeId,
    type: 'passage',
    version: 1,
    updatedAt: new Date().toISOString(),
    metadata: {
      reference: {
        book: 'John',
        chapter: 3,
        verseStart: 16,
        verseEnd: null,
        originalText: 'John 3:16',
        normalizedReference: 'John 3:16',
      },
      interjections,
      userVerified: false,
    },
    children: [
      {
        id: 'text-1' as NodeId,
        type: 'text',
        version: 1,
        updatedAt: new Date().toISOString(),
        content: 'For God so loved the world',
        marks: [],
      },
    ],
  };
}

// Helper to create mock interjection
function createMockInterjection(
  id: string,
  text: string,
  offsetStart: number,
  offsetEnd: number
): InterjectionMetadata {
  return {
    id: id as NodeId,
    text,
    offsetStart,
    offsetEnd,
  };
}

describe('InterjectionSidePanel', () => {
  const defaultProps = {
    passage: createMockPassage(),
    onInterjectionSelect: vi.fn(),
    onInterjectionBoundaryChange: vi.fn(),
    onInterjectionAdd: vi.fn(),
    onInterjectionRemove: vi.fn(),
    selectedInterjectionId: null,
    isEditing: false,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when passage is null', () => {
    const { container } = render(<InterjectionSidePanel {...defaultProps} passage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders empty state when no interjections', () => {
    render(<InterjectionSidePanel {...defaultProps} />);
    expect(screen.getByText('No interjections in this passage.')).toBeInTheDocument();
  });

  it('renders interjection list when interjections exist', () => {
    const interjections = [
      createMockInterjection('int-1', 'Amen!', 4, 9),
      createMockInterjection('int-2', 'Hallelujah!', 15, 26),
    ];
    const passage = createMockPassage(interjections);

    render(<InterjectionSidePanel {...defaultProps} passage={passage} />);

    expect(screen.getByText('"Amen!"')).toBeInTheDocument();
    expect(screen.getByText('"Hallelujah!"')).toBeInTheDocument();
  });

  it('shows offsets for each interjection', () => {
    const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
    const passage = createMockPassage(interjections);

    render(<InterjectionSidePanel {...defaultProps} passage={passage} />);

    expect(screen.getByText('[4 - 9]')).toBeInTheDocument();
  });

  it('calls onInterjectionSelect when clicking an interjection', () => {
    const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
    const passage = createMockPassage(interjections);
    const onSelect = vi.fn();

    render(
      <InterjectionSidePanel {...defaultProps} passage={passage} onInterjectionSelect={onSelect} />
    );

    fireEvent.click(screen.getByText('"Amen!"'));
    expect(onSelect).toHaveBeenCalledWith('int-1');
  });

  it('applies selected class to selected interjection', () => {
    const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
    const passage = createMockPassage(interjections);

    render(
      <InterjectionSidePanel
        {...defaultProps}
        passage={passage}
        selectedInterjectionId={'int-1' as NodeId}
      />
    );

    const listItem = screen.getByText('"Amen!"').closest('.interjection-panel-item');
    expect(listItem).toHaveClass('selected');
  });

  it('shows add button in editing mode', () => {
    render(<InterjectionSidePanel {...defaultProps} isEditing={true} />);
    expect(screen.getByText('+ Add Interjection')).toBeInTheDocument();
  });

  it('hides add button when not in editing mode', () => {
    render(<InterjectionSidePanel {...defaultProps} isEditing={false} />);
    expect(screen.queryByText('+ Add Interjection')).not.toBeInTheDocument();
  });

  it('shows add form when clicking add button', () => {
    render(<InterjectionSidePanel {...defaultProps} isEditing={true} />);

    fireEvent.click(screen.getByText('+ Add Interjection'));

    expect(screen.getByPlaceholderText('Enter interjection text...')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onClose when clicking close button', () => {
    const onClose = vi.fn();
    render(<InterjectionSidePanel {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTitle('Close panel'));

    expect(onClose).toHaveBeenCalled();
  });

  it('shows keyboard shortcut hints', () => {
    render(<InterjectionSidePanel {...defaultProps} />);

    expect(screen.getByText('Navigate')).toBeInTheDocument();
    expect(screen.getByText('Expand/Collapse')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  describe('Boundary editing', () => {
    it('shows boundary controls when editing mode is enabled and item is expanded', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);

      render(<InterjectionSidePanel {...defaultProps} passage={passage} isEditing={true} />);

      // Click to expand
      fireEvent.click(screen.getByText('"Amen!"'));

      // Check for boundary control labels
      expect(screen.getByText('Start:')).toBeInTheDocument();
      expect(screen.getByText('End:')).toBeInTheDocument();
    });

    it('shows remove button in editing mode when expanded', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);

      render(<InterjectionSidePanel {...defaultProps} passage={passage} isEditing={true} />);

      // Click to expand
      fireEvent.click(screen.getByText('"Amen!"'));

      expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('calls onInterjectionRemove when clicking remove button', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);
      const onRemove = vi.fn();

      render(
        <InterjectionSidePanel
          {...defaultProps}
          passage={passage}
          isEditing={true}
          onInterjectionRemove={onRemove}
        />
      );

      // Click to expand
      fireEvent.click(screen.getByText('"Amen!"'));

      // Click remove
      fireEvent.click(screen.getByText('Remove'));

      expect(onRemove).toHaveBeenCalledWith('int-1');
    });
  });

  describe('Context display', () => {
    it('shows context preview when expanded', () => {
      const interjections = [createMockInterjection('int-1', 'God', 4, 7)];
      const passage = createMockPassage(interjections);

      render(<InterjectionSidePanel {...defaultProps} passage={passage} />);

      // Click to expand
      fireEvent.click(screen.getByText('"God"'));

      // Context should be visible
      const contextElement = document.querySelector('.interjection-panel-context');
      expect(contextElement).toBeInTheDocument();
    });
  });
});
