import React, { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FloatingActionToolbar } from '../../../components/ui/FloatingActionToolbar';
import { BOUNDARY_CHANGE_DEBOUNCE_MS } from '../../../types/quoteReview';
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
  // Editor container reference
  const editorContainerRef = useRef<HTMLElement | null>(null);

  // Current selection state
  const [selection, setSelection] = useState<SelectionRange | null>(null);

  // Which handle is being dragged
  const [activeHandle, setActiveHandle] = useState<DragHandle>(null);

  // Refs for handle elements
  const startHandleRef = useRef<HTMLDivElement>(null);
  const endHandleRef = useRef<HTMLDivElement>(null);

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

    // Find editor container
    const container = findEditorContainer(quoteElement);
    editorContainerRef.current = container;

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
  }, [isActive, quoteElement]);

  // Handle scroll events to update handle positions
  useEffect(() => {
    if (!isActive) return;

    // Force update function utilizing state setter with spread to trigger re-render
    const handleScroll = () => {
      setSelection((prev) => (prev ? { ...prev } : null));
    };

    // Use a passive listener on capture for better performance,
    // attached to window to catch any scrolling parent
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('resize', handleScroll);
    };
  }, [isActive]); // Rerender when selection changes to attach new closure if needed, though handleScroll creates fresh one anyway

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
        if (selection && editorContainerRef.current) {
          const newText = getTextBetweenPositions(
            selection.start,
            selection.end,
            editorContainerRef.current
          );

          const affectedParagraphs = getAffectedParagraphs(selection.start, selection.end);
          // Check for cross-paragraph
          if (affectedParagraphs.length > 1) {
            // console.log('[QuoteBoundaryEditor] Cross-paragraph selection:', paragraphIds);
          }

          // Don't auto-commit. User must confirm via FloatingActionToolbar.
          // We leave the selection as-is on screen.
        }

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

  // Check bounds relative to editor container to handle clipping/scrolling
  const editorBounds = editorContainerRef.current?.getBoundingClientRect();

  // Get highlight rectangles and filter/clamp to editor bounds
  const highlightRects = getSelectionRects(selection.start, selection.end)
    .map((rect) => {
      if (!editorBounds) return rect;

      // Calculate intersection
      const top = Math.max(rect.top, editorBounds.top);
      const bottom = Math.min(rect.bottom, editorBounds.bottom);

      // If no intersection, return null (filter out later)
      if (top >= bottom) return null;

      // Return clamped rect
      return {
        ...rect.toJSON(), // ensuring we have a plain object
        top,
        height: bottom - top,
        left: rect.left,
        width: rect.width,
      };
    })
    .filter((rect): rect is DOMRect => rect !== null);

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

  // Render using portal
  const content = (
    <div
      className={`quote-boundary-editor ${activeHandle ? 'dragging' : ''}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Quote boundary editor. Drag handles to adjust selection. Arrow keys for fine control."
    >
      {/* Text-flow highlight - one rectangle per line */}
      {highlightRects.map((rect, index) => (
        <div
          key={index}
          className="boundary-highlight boundary-highlight-line"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}

      {/* Start handle */}
      {startRect && isStartVisible && (
        <div
          ref={startHandleRef}
          className={`boundary-handle boundary-handle-start ${activeHandle === 'start' ? 'dragging' : ''}`}
          style={{
            top: startRect.top, // Align with top of text
            height: startRect.height, // Match text height
            left: startRect.left - 12, // Center the 24px wide container (24/2 = 12)
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

      {/* End handle */}
      {endRect && isEndVisible && (
        <div
          ref={endHandleRef}
          className={`boundary-handle boundary-handle-end ${activeHandle === 'end' ? 'dragging' : ''}`}
          style={{
            top: endRect.top, // Align with top of text
            height: endRect.height, // Match text height
            left: endRect.right - 12, // Center the 24px wide container
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
