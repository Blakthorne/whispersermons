/**
 * useInterjectionPanel Hook Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInterjectionPanel } from '../hooks/useInterjectionPanel';
import type { PassageNode, InterjectionMetadata, NodeId } from '../../../../shared/documentModel';

// Mock useDocumentMutations
const mockChangeInterjectionBoundary = vi.fn();
vi.mock('../../document', () => ({
  useDocumentMutations: () => ({
    changeInterjectionBoundary: mockChangeInterjectionBoundary,
  }),
}));

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

describe('useInterjectionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with null selectedInterjectionId', () => {
      const passage = createMockPassage();
      const { result } = renderHook(() => useInterjectionPanel({ passage }));

      expect(result.current.selectedInterjectionId).toBeNull();
    });

    it('starts with hasPendingChanges as false', () => {
      const passage = createMockPassage();
      const { result } = renderHook(() => useInterjectionPanel({ passage }));

      expect(result.current.hasPendingChanges).toBe(false);
    });

    it('returns empty interjections array when passage has none', () => {
      const passage = createMockPassage([]);
      const { result } = renderHook(() => useInterjectionPanel({ passage }));

      expect(result.current.interjections).toEqual([]);
    });

    it('returns interjections from passage', () => {
      const interjections = [
        createMockInterjection('int-1', 'Amen!', 4, 9),
        createMockInterjection('int-2', 'Hallelujah!', 15, 26),
      ];
      const passage = createMockPassage(interjections);
      const { result } = renderHook(() => useInterjectionPanel({ passage }));

      expect(result.current.interjections).toHaveLength(2);
      expect(result.current.interjections[0]?.text).toBe('Amen!');
      expect(result.current.interjections[1]?.text).toBe('Hallelujah!');
    });
  });

  describe('selectInterjection', () => {
    it('sets selectedInterjectionId', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);
      const { result } = renderHook(() => useInterjectionPanel({ passage }));

      act(() => {
        result.current.selectInterjection('int-1' as NodeId);
      });

      expect(result.current.selectedInterjectionId).toBe('int-1');
    });

    it('calls onInterjectionHighlight callback', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);
      const onHighlight = vi.fn();
      
      const { result } = renderHook(() =>
        useInterjectionPanel({
          passage,
          onInterjectionHighlight: onHighlight,
        })
      );

      act(() => {
        result.current.selectInterjection('int-1' as NodeId);
      });

      expect(onHighlight).toHaveBeenCalledWith('int-1', 4, 9);
    });
  });

  describe('clearSelection', () => {
    it('clears the selected interjection', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);
      const { result } = renderHook(() => useInterjectionPanel({ passage }));

      act(() => {
        result.current.selectInterjection('int-1' as NodeId);
      });

      expect(result.current.selectedInterjectionId).toBe('int-1');

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedInterjectionId).toBeNull();
    });
  });

  describe('changeInterjectionBoundary', () => {
    it('calls mutation with correct parameters', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);
      const { result } = renderHook(() => useInterjectionPanel({ passage }));

      act(() => {
        result.current.changeInterjectionBoundary(
          'int-1' as NodeId,
          3, // new start
          10, // new end
          'n Am' // new text
        );
      });

      expect(mockChangeInterjectionBoundary).toHaveBeenCalledWith(
        'passage-1',
        'int-1',
        3,
        10,
        'n Am'
      );
    });

    it('calls onBoundaryChangeComplete callback', () => {
      const interjections = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage = createMockPassage(interjections);
      const onComplete = vi.fn();
      
      const { result } = renderHook(() =>
        useInterjectionPanel({
          passage,
          onBoundaryChangeComplete: onComplete,
        })
      );

      act(() => {
        result.current.changeInterjectionBoundary('int-1' as NodeId, 3, 10, 'n Am');
      });

      expect(onComplete).toHaveBeenCalled();
    });

    it('does nothing when passage is null', () => {
      const { result } = renderHook(() => useInterjectionPanel({ passage: null }));

      act(() => {
        result.current.changeInterjectionBoundary('int-1' as NodeId, 3, 10, 'n Am');
      });

      expect(mockChangeInterjectionBoundary).not.toHaveBeenCalled();
    });
  });

  describe('passage change handling', () => {
    it('clears selection when passage changes', () => {
      const interjections1 = [createMockInterjection('int-1', 'Amen!', 4, 9)];
      const passage1 = createMockPassage(interjections1);
      
      const interjections2 = [createMockInterjection('int-2', 'Praise!', 10, 16)];
      const passage2: PassageNode = {
        ...createMockPassage(interjections2),
        id: 'passage-2' as NodeId,
      };

      const { result, rerender } = renderHook(
        ({ passage }) => useInterjectionPanel({ passage }),
        { initialProps: { passage: passage1 } }
      );

      // Select an interjection
      act(() => {
        result.current.selectInterjection('int-1' as NodeId);
      });

      expect(result.current.selectedInterjectionId).toBe('int-1');

      // Change passage
      rerender({ passage: passage2 });

      // Selection should be cleared
      expect(result.current.selectedInterjectionId).toBeNull();
    });
  });
});
