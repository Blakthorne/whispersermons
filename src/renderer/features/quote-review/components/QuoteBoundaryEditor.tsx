import React, { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FloatingActionToolbar } from '../../../components/ui/FloatingActionToolbar';
import './QuoteBoundaryEditor.css';

/**
 * Position in the document represented by a text node and offset
 */
interface TextPosition {
  /** The text node */
  node: Text;
  /** Character offset within the text node */
  offset: number;
  /** Global character offset from start of editor */
  globalOffset: number;
}

/**
 * Selection range with start and end positions
 */
interface SelectionRange {
  start: TextPosition;
  end: TextPosition;
}

interface QuoteBoundaryEditorProps {
  /** The quote element that defines initial selection */
  quoteElement: HTMLElement;
  /** Current quote text */
  quoteText: string;
  /** Whether boundary editing is active */
  isActive: boolean;
  /** Callback when boundary changes (after debounce) */
  onBoundaryChange: (
    newText: string,
    startOffset: number,
    endOffset: number,
    affectedParagraphs?: string[]
  ) => void;
  /** Callback when boundary editing starts */
  onEditStart: () => void;
  /** Callback when boundary editing ends */
  onEditEnd: () => void;
  /** Callback when selection spans multiple paragraphs (for AST restructuring) */
  onCrossParagraphDrag: (direction: 'start' | 'end', targetParagraph: HTMLElement) => void;
  /** Enable word-level snapping during drag */
  enableWordSnapping?: boolean;
  /** Snapping threshold in pixels */
  snapThreshold?: number;
}

type DragHandle = 'start' | 'end' | null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the visible bounds of an element by intersecting with all
 * ancestor clipping containers (overflow: hidden/scroll/auto).
 * This accounts for scrollable parents and overflow-hidden wrappers.
 */
function getVisibleBounds(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  let top = rect.top;
  let left = rect.left;
  let bottom = rect.bottom;
  let right = rect.right;

  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;

    if (
      overflowX === 'hidden' || overflowX === 'scroll' || overflowX === 'auto' ||
      overflowY === 'hidden' || overflowY === 'scroll' || overflowY === 'auto'
    ) {
      const parentRect = current.getBoundingClientRect();
      top = Math.max(top, parentRect.top);
      left = Math.max(left, parentRect.left);
      bottom = Math.min(bottom, parentRect.bottom);
      right = Math.min(right, parentRect.right);

      if (top >= bottom || left >= right) {
        return new DOMRect(0, 0, 0, 0);
      }
    }

    current = current.parentElement;
  }

  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Find the TipTap/ProseMirror editor container
 */
function findEditorContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.classList.contains('ProseMirror') ||
      current.classList.contains('tiptap') ||
      current.classList.contains('editor-content') ||
      current.getAttribute('contenteditable') === 'true'
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Find the scrollable container that clips the editor content.
 * This is typically `.sermon-editor-content` which has `overflow-y: auto`.
 * The highlights must be clipped to this container's bounds, not the inner editor.
 */
function findScrollableContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    // Check for sermon-editor-content specifically (our scrollable container)
    if (current.classList.contains('sermon-editor-content')) {
      return current;
    }
    // Generic fallback: check for overflow scroll/auto
    const style = window.getComputedStyle(current);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Find all text nodes within an element (recursive)
 */
function findAllTextNodes(element: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Accept all text nodes, even whitespace-only (for accurate offset calculation)
      return node.textContent && node.textContent.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  let current = walker.nextNode() as Text | null;
  while (current) {
    nodes.push(current);
    current = walker.nextNode() as Text | null;
  }
  return nodes;
}

/**
 * Build a cache of node offsets for O(1) lookups
 */
function buildNodeOffsetCache(root: HTMLElement): Map<Node, number> {
  const map = new Map<Node, number>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.textContent && node.textContent.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });

  let offset = 0;
  let node = walker.nextNode();
  while (node) {
    map.set(node, offset);
    offset += node.textContent?.length || 0;
    node = walker.nextNode();
  }
  return map;
}

/**
 * Calculate global offset for a text node within the editor
 */
function getGlobalOffset(
  textNode: Text,
  localOffset: number,
  editorContainer: HTMLElement,
  cache?: Map<Node, number> | null
): number {
  // Use cache if available (O(1))
  if (cache?.has(textNode)) {
    return (cache.get(textNode) || 0) + localOffset;
  }

  // Fallback to DOM traversal (O(N))
  const allNodes = findAllTextNodes(editorContainer);
  let globalOffset = 0;

  for (const node of allNodes) {
    if (node === textNode) {
      return globalOffset + localOffset;
    }
    globalOffset += node.textContent?.length || 0;
  }

  return globalOffset + localOffset;
}

/**
 * Convert global offset back to text node + local offset
 */
function globalOffsetToPosition(
  globalOffset: number,
  editorContainer: HTMLElement,
  cache?: Map<Node, number> | null
): TextPosition | null {
  // Use cache if available
  if (cache) {
    for (const [node, offset] of cache.entries()) {
      const length = node.textContent?.length || 0;
      if (globalOffset >= offset && globalOffset <= offset + length) {
        return {
          node: node as Text,
          offset: globalOffset - offset,
          globalOffset,
        };
      }
    }
    // Fallback?
  }

  const allNodes = findAllTextNodes(editorContainer);
  let currentOffset = 0;

  for (const node of allNodes) {
    const nodeLength = node.textContent?.length || 0;
    if (currentOffset + nodeLength >= globalOffset) {
      return {
        node,
        offset: globalOffset - currentOffset,
        globalOffset,
      };
    }
    currentOffset += nodeLength;
  }

  // Return last position if offset is beyond content
  if (allNodes.length > 0) {
    const lastNode = allNodes[allNodes.length - 1];
    if (lastNode) {
      const lastLength = lastNode.textContent?.length || 0;
      return {
        node: lastNode,
        offset: lastLength,
        globalOffset: currentOffset,
      };
    }
  }

  return null;
}

/**
 * Get text position from mouse coordinates using caret APIs
 * Uses caretPositionFromPoint (standard) or caretRangeFromPoint (WebKit)
 */
function getTextPositionFromPoint(
  x: number,
  y: number,
  editorContainer: HTMLElement,
  cache?: Map<Node, number> | null
): TextPosition | null {
  // Try standard API first
  if ('caretPositionFromPoint' in document) {
    const pos = (document as any).caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
      const textNode = pos.offsetNode as Text;
      if (editorContainer.contains(textNode)) {
        return {
          node: textNode,
          offset: pos.offset,
          globalOffset: getGlobalOffset(textNode, pos.offset, editorContainer, cache),
        };
      }
    }
  }

  // Fallback to WebKit API
  if ('caretRangeFromPoint' in document) {
    const range = document.caretRangeFromPoint(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      if (editorContainer.contains(textNode)) {
        return {
          node: textNode,
          offset: range.startOffset,
          globalOffset: getGlobalOffset(textNode, range.startOffset, editorContainer, cache),
        };
      }
    }
  }

  return null;
}

/**
 * Get the DOMRect for a position in text
 */
function getPositionRect(position: TextPosition): DOMRect | null {
  try {
    const range = document.createRange();
    const maxOffset = position.node.textContent?.length || 0;
    const safeOffset = Math.min(position.offset, maxOffset);

    range.setStart(position.node, safeOffset);
    range.setEnd(position.node, Math.min(safeOffset + 1, maxOffset));

    const rects = range.getClientRects();
    if (rects.length > 0) {
      return rects[0] || null;
    }

    // Fallback: get rect for the whole node
    range.selectNodeContents(position.node);
    return range.getBoundingClientRect();
  } catch {
    return null;
  }
}

/**
 * Find word boundary at position
 * For start handle: snap to word START (beginning of word)
 * For end handle: snap to word END (end of word)
 */
function findWordBoundary(
  position: TextPosition,
  direction: 'start' | 'end',
  editorContainer: HTMLElement,
  cache?: Map<Node, number> | null
): TextPosition {
  const text = position.node.textContent || '';
  let offset = position.offset;

  if (direction === 'start') {
    // Move backwards to find word start
    while (offset > 0) {
      const prevChar = text[offset - 1];
      if (prevChar !== undefined && /\s/.test(prevChar)) break;
      offset--;
    }
  } else {
    // Move forwards to find word end
    while (offset < text.length) {
      const currentChar = text[offset];
      if (currentChar !== undefined && /\s/.test(currentChar)) break;
      offset++;
    }
  }

  return {
    node: position.node,
    offset,
    globalOffset: getGlobalOffset(position.node, offset, editorContainer, cache),
  };
}

/**
 * Get all DOMRects for a range (one per line for multi-line selection)
 */
function getSelectionRects(startPos: TextPosition, endPos: TextPosition): DOMRect[] {
  try {
    const range = document.createRange();

    const startMaxOffset = startPos.node.textContent?.length || 0;
    const endMaxOffset = endPos.node.textContent?.length || 0;

    range.setStart(startPos.node, Math.min(startPos.offset, startMaxOffset));
    range.setEnd(endPos.node, Math.min(endPos.offset, endMaxOffset));

    // getClientRects() returns one rect per line for inline content
    const rects = Array.from(range.getClientRects());

    // Filter out zero-dimension rects and deduplicate
    return rects.filter(
      (rect, index, arr) =>
        rect.width > 0 &&
        rect.height > 0 &&
        !arr
          .slice(0, index)
          .some(
            (r) =>
              Math.abs(r.top - rect.top) < 2 &&
              Math.abs(r.left - rect.left) < 2 &&
              Math.abs(r.width - rect.width) < 2
          )
    );
  } catch {
    return [];
  }
}

/**
 * Get text content between two positions
 */
function getTextBetweenPositions(
  startPos: TextPosition,
  endPos: TextPosition,
  editorContainer: HTMLElement
): string {
  const allNodes = findAllTextNodes(editorContainer);
  let text = '';
  let inRange = false;

  for (const node of allNodes) {
    if (node === startPos.node) {
      inRange = true;
      if (node === endPos.node) {
        // Same node
        text += node.textContent?.slice(startPos.offset, endPos.offset) || '';
        break;
      } else {
        text += node.textContent?.slice(startPos.offset) || '';
      }
    } else if (node === endPos.node) {
      text += node.textContent?.slice(0, endPos.offset) || '';
      break;
    } else if (inRange) {
      text += node.textContent || '';
    }
  }

  return text;
}

/**
 * Get all paragraph elements that contain the selection
 */
function getAffectedParagraphs(startPos: TextPosition, endPos: TextPosition): HTMLElement[] {
  const paragraphs: HTMLElement[] = [];

  // Find paragraph containing start
  let startPara = startPos.node.parentElement;
  while (startPara && startPara.tagName !== 'P' && !startPara.hasAttribute('data-paragraph')) {
    startPara = startPara.parentElement;
  }

  // Find paragraph containing end
  let endPara = endPos.node.parentElement;
  while (endPara && endPara.tagName !== 'P' && !endPara.hasAttribute('data-paragraph')) {
    endPara = endPara.parentElement;
  }

  if (startPara) {
    paragraphs.push(startPara);
  }

  // If different paragraphs, collect all in between
  if (startPara && endPara && startPara !== endPara) {
    let current = startPara.nextElementSibling;
    while (current && current !== endPara) {
      if (current.tagName === 'P' || current.hasAttribute('data-paragraph')) {
        paragraphs.push(current as HTMLElement);
      }
      current = current.nextElementSibling;
    }
    paragraphs.push(endPara);
  }

  return paragraphs;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * QuoteBoundaryEditor V2 - Text-flow selection with unbounded handles
 *
 * Features:
 * - Text-flow highlighting (like browser selection) - multiple line rectangles
 * - Handles can be dragged anywhere in the editor
 * - Start handle snaps to word START, end handle snaps to word END
 * - Start cannot pass end (maintains document order)
 * - Cross-paragraph selection with AST restructuring on commit
 */
export function QuoteBoundaryEditor({
  quoteElement,
  quoteText: _quoteText,
  isActive,
  onBoundaryChange,
  onEditStart,
  onEditEnd,
  onCrossParagraphDrag: _onCrossParagraphDrag,
  enableWordSnapping = true,
  snapThreshold: _snapThreshold = 20,
}: QuoteBoundaryEditorProps): React.JSX.Element | null {
  // Editor container reference (ProseMirror element)
  const editorContainerRef = useRef<HTMLElement | null>(null);
  
  // Scrollable container reference (sermon-editor-content - for bounds clipping)
  const scrollableContainerRef = useRef<HTMLElement | null>(null);

  // Current selection state
  const [selection, setSelection] = useState<SelectionRange | null>(null);

  // Which handle is being dragged
  const [activeHandle, setActiveHandle] = useState<DragHandle>(null);

  // Refs for handle elements
  const startHandleRef = useRef<HTMLDivElement>(null);
  const endHandleRef = useRef<HTMLDivElement>(null);

  // Refs for highlight elements (for direct DOM manipulation during scroll)
  const highlightContainerRef = useRef<HTMLDivElement>(null);
  
  // Ref to track pending animation frame (for scroll updates)
  const animationFrameRef = useRef<number | null>(null);
  
  // Selection ref for scroll-based position updates (avoids React re-renders)
  const selectionRef = useRef<SelectionRange | null>(null);

  // Debounce timer
  const debounceTimerRef = useRef<number | null>(null);

  // Drag state ref (to avoid stale closures)
  const dragStateRef = useRef<{
    handle: DragHandle;
    initialSelection: SelectionRange | null;
  }>({
    handle: null,
    initialSelection: null,
  });

  // Node Offset Cache for O(1) lookups during drag
  const nodeCacheRef = useRef<Map<Node, number> | null>(null);

  // Initialize editor container, selection, and cache
  useEffect(() => {
    if (!isActive || !quoteElement) return;

    // Find editor container (ProseMirror)
    const container = findEditorContainer(quoteElement);
    editorContainerRef.current = container;

    // Find scrollable container for bounds clipping
    const scrollContainer = findScrollableContainer(quoteElement);
    scrollableContainerRef.current = scrollContainer;

    if (!container) {
      console.warn('[QuoteBoundaryEditor] Could not find editor container');
      return;
    }

    // Build cache
    nodeCacheRef.current = buildNodeOffsetCache(container);

    // Initialize selection from quote element bounds
    const textNodes = findAllTextNodes(quoteElement);
    if (textNodes.length === 0) return;

    const firstNode = textNodes[0];
    const lastNode = textNodes[textNodes.length - 1];

    if (!firstNode || !lastNode) return;

    const startPos: TextPosition = {
      node: firstNode,
      offset: 0,
      globalOffset: getGlobalOffset(firstNode, 0, container, nodeCacheRef.current),
    };

    const lastLength = lastNode.textContent?.length || 0;
    const endPos: TextPosition = {
      node: lastNode,
      offset: lastLength,
      globalOffset: getGlobalOffset(lastNode, lastLength, container, nodeCacheRef.current),
    };

    setSelection({ start: startPos, end: endPos });
    selectionRef.current = { start: startPos, end: endPos };
  }, [isActive, quoteElement]);

  // Sync selection ref when state changes (for drag operations that update state)
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Handle scroll events to update handle positions using RAF for smooth updates
  useEffect(() => {
    if (!isActive) return;

    // Update positions directly via refs without triggering React re-renders
    const updatePositions = () => {
      const sel = selectionRef.current;
      if (!sel) return;

      const scrollContainer = scrollableContainerRef.current;
      const editorBounds = scrollContainer
        ? scrollContainer.getBoundingClientRect()
        : editorContainerRef.current
          ? getVisibleBounds(editorContainerRef.current)
          : undefined;

      // Update highlight container clip-path
      if (highlightContainerRef.current && editorBounds) {
        highlightContainerRef.current.style.clipPath = 
          `inset(${editorBounds.top}px ${window.innerWidth - editorBounds.right}px ${window.innerHeight - editorBounds.bottom}px ${editorBounds.left}px)`;
      }

      // Get RAW position rects for highlights (unfiltered - we'll handle visibility per-element)
      const rawHighlightRects = getSelectionRects(sel.start, sel.end);

      // Update highlight elements via direct DOM manipulation
      const highlightContainer = highlightContainerRef.current;
      if (highlightContainer) {
        const highlightElements = highlightContainer.querySelectorAll('.boundary-highlight-line');
        highlightElements.forEach((el, index) => {
          if (!(el instanceof HTMLElement)) return;
          
          const rawRect = rawHighlightRects[index];
          if (!rawRect || !editorBounds) {
            // No rect for this element - hide it
            el.style.visibility = 'hidden';
            return;
          }

          // Check if rect is completely outside editor bounds (not just partially clipped)
          const isCompletelyAbove = rawRect.bottom <= editorBounds.top;
          const isCompletelyBelow = rawRect.top >= editorBounds.bottom;
          const isCompletelyLeft = rawRect.right <= editorBounds.left;
          const isCompletelyRight = rawRect.left >= editorBounds.right;

          if (isCompletelyAbove || isCompletelyBelow || isCompletelyLeft || isCompletelyRight) {
            // Completely out of view - hide it entirely
            el.style.visibility = 'hidden';
            return;
          }

          // Partially or fully in view - show it at its actual position (no clamping)
          // The clip-path on the container will handle clipping
          el.style.transform = `translate3d(${rawRect.left}px, ${rawRect.top}px, 0)`;
          el.style.width = `${rawRect.width}px`;
          el.style.height = `${rawRect.height}px`;
          el.style.visibility = 'visible';
        });
      }

      // Update handle positions
      const startRect = getPositionRect(sel.start);
      const endRect = getPositionRect(sel.end);

      const isStartVisible = startRect && editorBounds
        ? startRect.top >= editorBounds.top && startRect.bottom <= editorBounds.bottom
        : true;
      const isEndVisible = endRect && editorBounds
        ? endRect.top >= editorBounds.top && endRect.bottom <= editorBounds.bottom
        : true;

      if (startHandleRef.current) {
        if (startRect && isStartVisible) {
          startHandleRef.current.style.transform = `translate3d(${startRect.left - 12}px, ${startRect.top}px, 0)`;
          startHandleRef.current.style.height = `${startRect.height}px`;
          startHandleRef.current.style.visibility = 'visible';
        } else {
          startHandleRef.current.style.visibility = 'hidden';
        }
      }

      if (endHandleRef.current) {
        if (endRect && isEndVisible) {
          endHandleRef.current.style.transform = `translate3d(${endRect.right - 12}px, ${endRect.top}px, 0)`;
          endHandleRef.current.style.height = `${endRect.height}px`;
          endHandleRef.current.style.visibility = 'visible';
        } else {
          endHandleRef.current.style.visibility = 'hidden';
        }
      }
    };

    const handleScroll = () => {
      // Cancel any pending animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Schedule position update on next frame for smooth sync
      animationFrameRef.current = requestAnimationFrame(updatePositions);
    };

    // Initial position update
    updatePositions();

    // Use a passive listener on capture for better performance,
    // attached to window to catch any scrolling parent
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('resize', handleScroll);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive]); // Only re-attach when isActive changes

  // Handle mouse down on drag handle
  const handleMouseDown = useCallback(
    (handle: DragHandle) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!selection || !editorContainerRef.current) return;

      console.log('[QuoteBoundaryEditor] mousedown on handle:', handle);

      // Store initial state
      dragStateRef.current = {
        handle,
        initialSelection: { ...selection },
      };

      setActiveHandle(handle);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const editorContainer = editorContainerRef.current;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const { handle: dragHandle, initialSelection } = dragStateRef.current;
        if (!dragHandle || !initialSelection || !editorContainer) return;

        // Get text position from mouse coordinates
        let newPos = getTextPositionFromPoint(
          moveEvent.clientX,
          moveEvent.clientY,
          editorContainer,
          nodeCacheRef.current
        );

        if (!newPos) return;

        // Apply word snapping
        if (enableWordSnapping) {
          newPos = findWordBoundary(newPos, dragHandle, editorContainer, nodeCacheRef.current);
        }

        // Enforce start < end constraint
        if (dragHandle === 'start') {
          // Start handle cannot pass end handle
          if (newPos.globalOffset >= selection.end.globalOffset) {
            // Clamp to just before end
            newPos =
              globalOffsetToPosition(
                Math.max(0, selection.end.globalOffset - 1),
                editorContainer,
                nodeCacheRef.current
              ) || newPos;
          }

          setSelection((prev) => (prev ? { ...prev, start: newPos! } : null));
        } else {
          // End handle cannot pass start handle
          if (newPos.globalOffset <= selection.start.globalOffset) {
            // Clamp to just after start
            newPos =
              globalOffsetToPosition(
                selection.start.globalOffset + 1,
                editorContainer,
                nodeCacheRef.current
              ) || newPos;
          }

          setSelection((prev) => (prev ? { ...prev, end: newPos! } : null));
        }

        // Note: Visual position update is handled by React render in V2
        // We rely on high-frequency state updates which are batched by React 18+
        // If this is still slow, we can use direct DOM manipulation here as optimization V3
      };

      const handleMouseUp = () => {
        console.log('[QuoteBoundaryEditor] mouseup');

        // Cleanup
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        setActiveHandle(null);

        // Commit the change
        // Reset drag state
        dragStateRef.current = {
          handle: null,
          initialSelection: null,
        };
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      // Notify parent
      try {
        onEditStart();
      } catch (err) {
        console.error('[QuoteBoundaryEditor] error in onEditStart:', err);
      }
    },
    [selection, enableWordSnapping, onEditStart, onBoundaryChange]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isActive || !selection || !editorContainerRef.current) return;

      const step = e.ctrlKey || e.metaKey ? 5 : 1;
      const editorContainer = editorContainerRef.current;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            // Shrink from end
            const newEndOffset = Math.max(
              selection.start.globalOffset + 1,
              selection.end.globalOffset - step
            );
            const newEnd = globalOffsetToPosition(newEndOffset, editorContainer);
            if (newEnd) {
              setSelection((prev) => (prev ? { ...prev, end: newEnd } : null));
            }
          } else {
            // Expand from start
            const newStartOffset = Math.max(0, selection.start.globalOffset - step);
            const newStart = globalOffsetToPosition(newStartOffset, editorContainer);
            if (newStart) {
              setSelection((prev) => (prev ? { ...prev, start: newStart } : null));
            }
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            // Expand from end
            const totalLength = findAllTextNodes(editorContainer).reduce(
              (sum, n) => sum + (n.textContent?.length || 0),
              0
            );
            const newEndOffset = Math.min(totalLength, selection.end.globalOffset + step);
            const newEnd = globalOffsetToPosition(newEndOffset, editorContainer);
            if (newEnd) {
              setSelection((prev) => (prev ? { ...prev, end: newEnd } : null));
            }
          } else {
            // Shrink from start
            const newStartOffset = Math.min(
              selection.end.globalOffset - 1,
              selection.start.globalOffset + step
            );
            const newStart = globalOffsetToPosition(newStartOffset, editorContainer);
            if (newStart) {
              setSelection((prev) => (prev ? { ...prev, start: newStart } : null));
            }
          }
          break;

        case 'Escape':
          onEditEnd();
          break;

        case 'Enter':
          onEditEnd();
          break;
      }
    },
    [isActive, selection, onEditEnd]
  );

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Don't render if not active
  if (!isActive || !quoteElement || !selection) {
    return null;
  }

  // Compute visible bounds - prefer the scrollable container for accurate clipping
  // The scrollable container (sermon-editor-content) is the actual viewport that clips content
  // Fall back to computing from editor container with ancestor clipping
  const scrollableContainer = scrollableContainerRef.current;
  const editorBounds = scrollableContainer
    ? scrollableContainer.getBoundingClientRect()
    : editorContainerRef.current
      ? getVisibleBounds(editorContainerRef.current)
      : undefined;

  // Get ALL highlight rectangles (unfiltered) - visibility is controlled via CSS/DOM updates
  // This ensures React renders all elements so DOM manipulation can update them on scroll
  const rawHighlightRects = getSelectionRects(selection.start, selection.end);
  
  // Compute initial visibility for each rect (used for initial render only)
  const highlightRectsWithVisibility = rawHighlightRects.map((rect) => {
    if (!editorBounds) {
      return { rect, isVisible: true };
    }
    // Check if completely outside bounds
    const isCompletelyAbove = rect.bottom <= editorBounds.top;
    const isCompletelyBelow = rect.top >= editorBounds.bottom;
    const isCompletelyLeft = rect.right <= editorBounds.left;
    const isCompletelyRight = rect.left >= editorBounds.right;
    const isVisible = !isCompletelyAbove && !isCompletelyBelow && !isCompletelyLeft && !isCompletelyRight;
    return { rect, isVisible };
  });

  // Get handle positions
  const startRect = getPositionRect(selection.start);
  const endRect = getPositionRect(selection.end);

  // Hide handles if they are not strictly fully visible within editor bounds
  // This prevents handles from floating over headers/footers
  const isStartVisible =
    startRect && editorBounds
      ? startRect.top >= editorBounds.top && startRect.bottom <= editorBounds.bottom
      : true;

  const isEndVisible =
    endRect && editorBounds
      ? endRect.top >= editorBounds.top && endRect.bottom <= editorBounds.bottom
      : true;

  // Build clip-path to ensure highlights don't visually overflow the editor area
  // This is needed because the container has high z-index that paints over other UI
  const clipPath = editorBounds
    ? `inset(${editorBounds.top}px ${window.innerWidth - editorBounds.right}px ${window.innerHeight - editorBounds.bottom}px ${editorBounds.left}px)`
    : undefined;

  // Render using portal
  const content = (
    <div
      ref={highlightContainerRef}
      className={`quote-boundary-editor ${activeHandle ? 'dragging' : ''}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Quote boundary editor. Drag handles to adjust selection. Arrow keys for fine control."
      style={clipPath ? { clipPath } : undefined}
    >
      {/* Text-flow highlight - one rectangle per line, using transform for GPU-accelerated positioning */}
      {/* Render ALL rects; visibility controlled here and updated via DOM manipulation on scroll */}
      {highlightRectsWithVisibility.map(({ rect, isVisible }, index) => (
        <div
          key={index}
          className="boundary-highlight boundary-highlight-line"
          style={{
            transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
            width: rect.width,
            height: rect.height,
            visibility: isVisible ? 'visible' : 'hidden',
          }}
        />
      ))}

      {/* Start handle - using transform for GPU-accelerated positioning */}
      {startRect && isStartVisible && (
        <div
          ref={startHandleRef}
          className={`boundary-handle boundary-handle-start ${activeHandle === 'start' ? 'dragging' : ''}`}
          style={{
            transform: `translate3d(${startRect.left - 12}px, ${startRect.top}px, 0)`,
            height: startRect.height,
          }}
          onMouseDown={handleMouseDown('start')}
          role="slider"
          aria-label="Adjust quote start boundary"
          aria-valuetext="Drag to adjust start"
          tabIndex={0}
        >
          <div className="boundary-cursor-line" />
          <div className="boundary-handle-grip" />
        </div>
      )}

      {/* End handle - using transform for GPU-accelerated positioning */}
      {endRect && isEndVisible && (
        <div
          ref={endHandleRef}
          className={`boundary-handle boundary-handle-end ${activeHandle === 'end' ? 'dragging' : ''}`}
          style={{
            transform: `translate3d(${endRect.right - 12}px, ${endRect.top}px, 0)`,
            height: endRect.height,
          }}
          onMouseDown={handleMouseDown('end')}
          role="slider"
          aria-label="Adjust quote end boundary"
          aria-valuetext="Drag to adjust end"
          tabIndex={0}
        >
          <div className="boundary-cursor-line" />
          <div className="boundary-handle-grip" />
        </div>
      )}

      <FloatingActionToolbar
        isVisible={isActive}
        title="Adjusting Passage Boundary"
        confirmLabel="Save & Close"
        onConfirm={() => {
          if (!selection || !editorContainerRef.current) {
            onEditEnd();
            return;
          }

          const newText = getTextBetweenPositions(
            selection.start,
            selection.end,
            editorContainerRef.current
          );
          const affectedParagraphs = getAffectedParagraphs(selection.start, selection.end);
          const paragraphIds = affectedParagraphs
            .map((p) => p.getAttribute('data-node-id') || p.getAttribute('data-paragraph-id'))
            .filter(Boolean) as string[];

          onBoundaryChange(
            newText,
            selection.start.globalOffset,
            selection.end.globalOffset,
            paragraphIds.length > 1 ? paragraphIds : undefined
          );

          onEditEnd();
        }}
        onCancel={() => {
          onEditEnd();
        }}
      />

      {/* Instructions */}
      <div className="boundary-instructions">
        Drag handles to expand/contract passage • Snaps to words • Cross paragraphs allowed
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

export default QuoteBoundaryEditor;
