import React, { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BOUNDARY_CHANGE_DEBOUNCE_MS } from '../../../types/quoteReview';
import './QuoteBoundaryEditor.css';

interface QuoteBoundaryEditorProps {
  /** The quote element to wrap with boundary handles */
  quoteElement: HTMLElement;
  /** Current quote text */
  quoteText: string;
  /** Whether boundary editing is active */
  isActive: boolean;
  /** Callback when boundary changes (after debounce) */
  onBoundaryChange: (newText: string, startOffset: number, endOffset: number) => void;
  /** Callback when boundary editing starts */
  onEditStart: () => void;
  /** Callback when boundary editing ends */
  onEditEnd: () => void;
  /** Callback when user drags across paragraph boundary */
  onCrossParagraphDrag: (direction: 'start' | 'end', targetParagraph: HTMLElement) => void;
  /** Enable word-level snapping during drag */
  enableWordSnapping?: boolean;
  /** Snapping threshold in pixels */
  snapThreshold?: number;
}

type DragHandle = 'start' | 'end' | null;

/**
 * Word boundary detection utilities for snapping
 */
interface WordBoundary {
  offset: number;
  position: number; // x position in pixels
  type: 'start' | 'end' | 'both';
}

/**
 * Find the first text node in an element (helper for static function)
 */
function findFirstTextNodeStatic(element: HTMLElement): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = node.textContent?.trim();
      return text && text.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  return walker.nextNode() as Text | null;
}

/**
 * Find all word boundaries in a text string and their approximate positions
 */
function findWordBoundaries(text: string, element: HTMLElement): WordBoundary[] {
  const boundaries: WordBoundary[] = [];
  // Find the actual text node within the element (handles nested structures)
  const textNode = findFirstTextNodeStatic(element);

  if (!textNode) {
    return boundaries;
  }

  // Word boundary regex: matches word starts and ends
  // SAFETY: Ensure we don't get stuck in infinite loops with zero-width matches
  const wordRegex = /\b/g;
  let match;
  let loopCount = 0;
  const MAX_LOOPS = 2000; // Safety limit for very long paragraphs

  // Track last index to ensure we're advancing
  let lastIndex = 0;

  while ((match = wordRegex.exec(text)) !== null) {
    loopCount++;
    if (loopCount > MAX_LOOPS) {
      console.warn('[QuoteBoundaryEditor] Max loop count exceeded in findWordBoundaries');
      break;
    }

    // SAFETY: If regex didn't advance, manually advance to avoid infinite loop
    if (match.index === lastIndex && match.index < text.length) {
      wordRegex.lastIndex++;
    }
    lastIndex = match.index;

    const offset = match.index;

    // Get position using Range API
    const range = document.createRange();
    try {
      range.setStart(textNode, Math.min(offset, text.length));
      range.setEnd(textNode, Math.min(offset + 1, text.length));
      const rect = range.getBoundingClientRect();

      boundaries.push({
        offset,
        position: rect.left,
        type: offset === 0 ? 'start' : offset === text.length ? 'end' : 'both',
      });
    } catch (e) {
      // Ignore range errors
    }
  }

  // Always include start and end
  const firstBoundary = boundaries[0];
  if (boundaries.length === 0 || (firstBoundary && firstBoundary.offset !== 0)) {
    const range = document.createRange();
    try {
      range.setStart(textNode, 0);
      range.setEnd(textNode, 1);
      boundaries.unshift({
        offset: 0,
        position: range.getBoundingClientRect().left,
        type: 'start',
      });
    } catch {
      // Skip if invalid
    }
  }

  const lastBoundary = boundaries[boundaries.length - 1];
  if (boundaries.length === 0 || (lastBoundary && lastBoundary.offset !== text.length)) {
    const range = document.createRange();
    try {
      range.setStart(textNode, Math.max(0, text.length - 1));
      range.setEnd(textNode, text.length);
      boundaries.push({
        offset: text.length,
        position: range.getBoundingClientRect().right,
        type: 'end',
      });
    } catch {
      // Skip if invalid
    }
  }

  return boundaries;
}

/**
 * Find the nearest word boundary to a given x position
 */
function findNearestWordBoundary(
  x: number,
  boundaries: WordBoundary[],
  threshold: number
): WordBoundary | null {
  let nearest: WordBoundary | null = null;
  let nearestDist = Infinity;

  for (const boundary of boundaries) {
    const dist = Math.abs(x - boundary.position);
    if (dist < nearestDist && dist <= threshold) {
      nearest = boundary;
      nearestDist = dist;
    }
  }

  return nearest;
}

/** Default snap threshold in pixels */
const DEFAULT_SNAP_THRESHOLD = 15;

/**
 * Component that provides drag handles and keyboard controls for editing quote boundaries.
 * Renders as an overlay on the quote element.
 *
 * Features:
 * - Drag handles at start/end of quote
 * - Word-level snapping for easier boundary selection
 * - Keyboard controls for fine-grained adjustment
 * - Cross-paragraph drag detection
 */
export function QuoteBoundaryEditor({
  quoteElement,
  quoteText,
  isActive,
  onBoundaryChange,
  onEditStart,
  onEditEnd,
  onCrossParagraphDrag,
  enableWordSnapping = true,
  snapThreshold = DEFAULT_SNAP_THRESHOLD,
}: QuoteBoundaryEditorProps): React.JSX.Element | null {
  // State for visual feedback only - which handle is being dragged
  const [activeHandle, setActiveHandle] = useState<DragHandle>(null);

  // Ref to store drag data that changes during drag without causing re-renders
  const dragDataRef = useRef<{
    handle: DragHandle;
    startX: number;
    startY: number;
    wordBoundaries: WordBoundary[];
    snapTarget: WordBoundary | null;
  }>({
    handle: null,
    startX: 0,
    startY: 0,
    wordBoundaries: [],
    snapTarget: null,
  });

  const [position, setPosition] = useState<{ start: DOMRect | null; end: DOMRect | null }>({
    start: null,
    end: null,
  });

  const debounceTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLDivElement>(null);
  const endHandleRef = useRef<HTMLDivElement>(null);

  /**
   * Find the first text node in an element tree (depth-first traversal)
   */
  const findFirstTextNode = useCallback((element: HTMLElement): Text | null => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip empty text nodes and whitespace-only nodes
        const text = node.textContent?.trim();
        return text && text.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    return walker.nextNode() as Text | null;
  }, []);

  /**
   * Find the last text node in an element tree (depth-first traversal)
   */
  const findLastTextNode = useCallback((element: HTMLElement): Text | null => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip empty text nodes and whitespace-only nodes
        const text = node.textContent?.trim();
        return text && text.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let lastNode: Text | null = null;
    let current = walker.nextNode() as Text | null;
    while (current) {
      lastNode = current;
      current = walker.nextNode() as Text | null;
    }
    return lastNode;
  }, []);

  // Calculate handle positions based on quote element bounds
  const updateHandlePositions = useCallback(() => {
    if (!quoteElement) return;

    // Find the actual text nodes within the bible-passage wrapper
    // The structure is: <div.bible-passage><p>text content</p></div>
    const firstTextNode = findFirstTextNode(quoteElement);
    const lastTextNode = findLastTextNode(quoteElement);

    if (!firstTextNode || !lastTextNode) {
      // Fall back to element bounds if no text nodes found
      const rect = quoteElement.getBoundingClientRect();
      setPosition({
        start: new DOMRect(rect.left, rect.top, 0, rect.height),
        end: new DOMRect(rect.right, rect.top, 0, rect.height),
      });
      return;
    }

    const range = document.createRange();

    // Get start position from first text node
    try {
      range.setStart(firstTextNode, 0);
      range.setEnd(firstTextNode, Math.min(1, firstTextNode.length));
      const startRect = range.getBoundingClientRect();

      // Get end position from last text node
      const lastTextLength = lastTextNode.length;
      range.setStart(lastTextNode, Math.max(0, lastTextLength - 1));
      range.setEnd(lastTextNode, lastTextLength);
      const endRect = range.getBoundingClientRect();

      setPosition({ start: startRect, end: endRect });
    } catch (e) {
      // Fall back to element bounds on any error
      const rect = quoteElement.getBoundingClientRect();
      setPosition({
        start: new DOMRect(rect.left, rect.top, 0, rect.height),
        end: new DOMRect(rect.right, rect.top, 0, rect.height),
      });
    }
  }, [quoteElement, findFirstTextNode, findLastTextNode]);

  // Update positions when active or quote changes
  useEffect(() => {
    if (isActive) {
      updateHandlePositions();

      // Update on resize/scroll
      const handleUpdate = (): void => updateHandlePositions();
      window.addEventListener('resize', handleUpdate);
      window.addEventListener('scroll', handleUpdate, true);

      return () => {
        window.removeEventListener('resize', handleUpdate);
        window.removeEventListener('scroll', handleUpdate, true);
        // NOTE: Don't call onEditEnd here - it should only be called when user
        // explicitly confirms the edit, not when component unmounts due to re-render
      };
    }
    return undefined;
  }, [isActive, quoteText, updateHandlePositions]);

  // Handle mouse down on drag handle
  // Computes word boundaries upfront for snapping during drag
  // ROBUST: All cleanup happens first before any computation
  const handleMouseDown = useCallback(
    (handle: DragHandle) => (e: React.MouseEvent) => {
      console.log('[QuoteBoundaryEditor] mousedown on handle:', handle);

      try {
        e.preventDefault();
        e.stopPropagation();

        // Compute word boundaries NOW at drag start for real-time snapping
        const boundaries = enableWordSnapping ? findWordBoundaries(quoteText, quoteElement) : [];
        console.log('[QuoteBoundaryEditor] precomputed boundaries:', boundaries.length);

        // Store drag data including precomputed boundaries
        dragDataRef.current = {
          handle,
          startX: e.clientX,
          startY: e.clientY,
          wordBoundaries: boundaries,
          snapTarget: null,
        };

        // Set visual state for CSS feedback
        setActiveHandle(handle);

        const handleElement = handle === 'start' ? startHandleRef.current : endHandleRef.current;
        const quoteRect = quoteElement.getBoundingClientRect();

        // Set cursor - we'll reset this in mouseup no matter what
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        // Track mouse position
        let lastMouseX = e.clientX;
        let lastMouseY = e.clientY;

        const handleMouseMove = (moveEvent: MouseEvent) => {
          lastMouseX = moveEvent.clientX;
          lastMouseY = moveEvent.clientY;

          if (handleElement) {
            // Constrain to quote element bounds (horizontally)
            const constrainedX = Math.max(
              quoteRect.left - 10,
              Math.min(quoteRect.right + 10, moveEvent.clientX)
            );

            // Snap to nearest word boundary if enabled
            let snapX = constrainedX;
            if (enableWordSnapping && boundaries.length > 0) {
              const nearestBoundary = findNearestWordBoundary(
                constrainedX,
                boundaries,
                snapThreshold * 2 // Use larger threshold during drag for better snapping
              );
              if (nearestBoundary) {
                snapX = nearestBoundary.position;
                dragDataRef.current.snapTarget = nearestBoundary;
              } else {
                dragDataRef.current.snapTarget = null;
              }
            }

            // Constrain vertical position to quote element bounds (with margin for multi-line quotes)
            const constrainedY = Math.max(
              quoteRect.top - 10,
              Math.min(quoteRect.bottom + 10, moveEvent.clientY)
            );

            // Position the handle at the snapped position
            // Offset by half the handle width (8px) to center on the snap point
            handleElement.style.left = `${snapX - 8}px`;
            // Allow vertical movement within quote bounds for multi-line text
            handleElement.style.top = `${constrainedY - 14}px`; // Center handle vertically (half of 28px height)
          }
        };

        const handleMouseUp = () => {
          console.log('[QuoteBoundaryEditor] mouseup');

          // CRITICAL: Cleanup FIRST, computation AFTER
          // This ensures the app never gets stuck
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';

          // Reset visual state immediately
          setActiveHandle(null);

          // Now do computation in a try-catch so errors don't cause issues
          try {
            const dragData = dragDataRef.current;
            if (!dragData.handle) {
              console.log('[QuoteBoundaryEditor] no active handle, skipping');
              return;
            }

            // Check if we're crossing paragraph boundaries
            const targetElement = document.elementFromPoint(lastMouseX, lastMouseY);
            const targetParagraph = targetElement?.closest('p, div[data-paragraph]');
            const quoteParagraph = quoteElement.closest('p, div[data-paragraph]');

            if (targetParagraph && quoteParagraph && targetParagraph !== quoteParagraph) {
              console.log('[QuoteBoundaryEditor] cross-paragraph drag detected');
              onCrossParagraphDrag(dragData.handle, targetParagraph as HTMLElement);
              dragDataRef.current = {
                handle: null,
                startX: 0,
                startY: 0,
                wordBoundaries: [],
                snapTarget: null,
              };
              return;
            }

            // Use precomputed snap target from drag, or recompute if needed
            let finalOffset: number | null = null;

            // Prefer the snap target that was set during drag
            if (dragData.snapTarget) {
              finalOffset = dragData.snapTarget.offset;
              console.log('[QuoteBoundaryEditor] using precomputed snap target:', finalOffset);
            } else if (enableWordSnapping && dragData.wordBoundaries.length > 0) {
              // Fallback: find nearest boundary to final mouse position
              const snapBoundary = findNearestWordBoundary(
                lastMouseX,
                dragData.wordBoundaries,
                snapThreshold
              );
              if (snapBoundary) {
                finalOffset = snapBoundary.offset;
              }
            }

            // If no snap, try to get position from cursor location
            if (finalOffset === null) {
              const range = document.caretRangeFromPoint?.(lastMouseX, lastMouseY);
              if (range && quoteElement.contains(range.startContainer)) {
                finalOffset = dragData.handle === 'start' ? range.startOffset : range.endOffset;
              }
            }

            console.log('[QuoteBoundaryEditor] final offset:', finalOffset);

            if (finalOffset !== null && dragData.handle) {
              // Debounce the boundary change
              if (debounceTimerRef.current) {
                window.clearTimeout(debounceTimerRef.current);
              }

              const currentHandle = dragData.handle;
              debounceTimerRef.current = window.setTimeout(() => {
                try {
                  const textNode = findFirstTextNodeStatic(quoteElement);
                  if (textNode) {
                    const fullText = textNode.textContent || '';
                    const newText =
                      currentHandle === 'start'
                        ? fullText.slice(finalOffset!)
                        : fullText.slice(0, finalOffset! + 1);

                    const startOffset = currentHandle === 'start' ? finalOffset! : 0;
                    const endOffset = currentHandle === 'end' ? finalOffset! + 1 : fullText.length;

                    onBoundaryChange(newText, startOffset, endOffset);
                  }
                } catch (err) {
                  console.error('[QuoteBoundaryEditor] error in debounced callback:', err);
                }
              }, BOUNDARY_CHANGE_DEBOUNCE_MS);
            }

            // Clear selection
            window.getSelection()?.removeAllRanges();
          } catch (err) {
            console.error('[QuoteBoundaryEditor] error in mouseup computation:', err);
          }

          // Reset drag data
          dragDataRef.current = {
            handle: null,
            startX: 0,
            startY: 0,
            wordBoundaries: [],
            snapTarget: null,
          };
          updateHandlePositions();
        };

        // Add listeners BEFORE calling onEditStart to ensure they're in place
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        console.log('[QuoteBoundaryEditor] listeners added');

        // Notify parent that editing started - do this LAST in mousedown
        // Wrapped in try-catch in case it causes issues
        try {
          onEditStart();
        } catch (err) {
          console.error('[QuoteBoundaryEditor] error in onEditStart:', err);
        }
      } catch (err) {
        console.error('[QuoteBoundaryEditor] error in mousedown:', err);
        // Reset state on error
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setActiveHandle(null);
      }
    },
    [
      enableWordSnapping,
      quoteText,
      quoteElement,
      onEditStart,
      onBoundaryChange,
      onCrossParagraphDrag,
      updateHandlePositions,
      snapThreshold,
    ]
  );

  // Handle keyboard navigation for boundary adjustment
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isActive) return;

      const isShift = e.shiftKey;
      const step = e.ctrlKey || e.metaKey ? 5 : 1; // Larger step with modifier

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          // Move start boundary left (expand) or end boundary left (shrink)
          if (isShift) {
            // Shrink from end
            const textNode = findFirstTextNodeStatic(quoteElement);
            if (textNode?.textContent && textNode.textContent.length > step) {
              const newText = textNode.textContent.slice(0, -step);
              onBoundaryChange(newText, 0, newText.length);
            }
          } else {
            // TODO: Expand from start (requires accessing preceding text)
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          // Move start boundary right (shrink) or end boundary right (expand)
          if (isShift) {
            // TODO: Expand from end (requires accessing following text)
          } else {
            // Shrink from start
            const textNode = findFirstTextNodeStatic(quoteElement);
            if (textNode?.textContent && textNode.textContent.length > step) {
              const newText = textNode.textContent.slice(step);
              onBoundaryChange(newText, step, step + newText.length);
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
    [isActive, quoteElement, onBoundaryChange, onEditEnd]
  );

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  if (!isActive || !quoteElement) {
    return null;
  }

  const quoteRect = quoteElement.getBoundingClientRect();

  // Calculate absolute positions (using fixed positioning)
  const getAbsolutePos = (rect: DOMRect | null, isStart: boolean) => {
    if (!rect) {
      // No position available - position off-screen
      return { top: -9999, left: -9999 };
    }
    return {
      top: rect.top - 4, // Slight offset above
      left: isStart ? rect.left - 8 : rect.right + 2,
    };
  };

  // Render using portal to escape parent container's DOM hierarchy
  // This ensures position: fixed works correctly and pointer events aren't blocked
  const content = (
    <div
      ref={containerRef}
      className={`quote-boundary-editor ${activeHandle ? 'dragging' : ''}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Quote boundary editor. Use arrow keys to adjust boundaries."
    >
      {/* Start handle */}
      <div
        ref={startHandleRef}
        className={`boundary-handle boundary-handle-start ${activeHandle === 'start' ? 'dragging' : ''}`}
        style={getAbsolutePos(position.start, true)}
        onMouseDown={handleMouseDown('start')}
        role="slider"
        aria-label="Adjust quote start boundary"
        aria-valuetext="Drag to adjust start"
        tabIndex={0}
      >
        <div className="boundary-handle-grip">
          <span className="boundary-handle-line" />
          <span className="boundary-handle-line" />
        </div>
      </div>

      {/* End handle */}
      <div
        ref={endHandleRef}
        className={`boundary-handle boundary-handle-end ${activeHandle === 'end' ? 'dragging' : ''}`}
        style={getAbsolutePos(position.end, false)}
        onMouseDown={handleMouseDown('end')}
        role="slider"
        aria-label="Adjust quote end boundary"
        aria-valuetext="Drag to adjust end"
        tabIndex={0}
      >
        <div className="boundary-handle-grip">
          <span className="boundary-handle-line" />
          <span className="boundary-handle-line" />
        </div>
      </div>

      {/* Highlight overlay */}
      <div
        className="boundary-highlight"
        style={{
          top: quoteRect.top - 2,
          left: quoteRect.left - 2,
          width: quoteRect.width + 4,
          height: quoteRect.height + 4,
        }}
      />

      {/* Instructions tooltip */}
      <div className="boundary-instructions">
        {enableWordSnapping
          ? 'Drag handles to adjust • Snaps to word boundaries • Arrow keys for fine control'
          : 'Drag handles to adjust • Arrow keys for fine control • Enter to confirm'}
      </div>
    </div>
  );

  // Render to document.body using portal to escape parent container constraints
  return createPortal(content, document.body);
}

export default QuoteBoundaryEditor;
