/**
 * InterjectionSidePanel Component
 *
 * A side panel for managing interjections within a passage:
 * - Lists all interjections with their text and offsets
 * - Click-to-highlight: clicking an interjection scrolls to and highlights it in the editor
 * - Boundary adjustment controls for each interjection
 * - Add/remove interjection functionality
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { NodeId, InterjectionMetadata, PassageNode } from '../../../../shared/documentModel';
import './InterjectionSidePanel.css';

interface InterjectionSidePanelProps {
  /** The passage being edited */
  passage: PassageNode | null;
  /** Callback when an interjection is selected for highlighting */
  onInterjectionSelect: (interjectionId: NodeId) => void;
  /** Callback when interjection boundaries change */
  onInterjectionBoundaryChange: (
    interjectionId: NodeId,
    newOffsetStart: number,
    newOffsetEnd: number,
    newText: string
  ) => void;
  /** Callback when a new interjection is added */
  onInterjectionAdd: (text: string, offsetStart: number, offsetEnd: number) => void;
  /** Callback when an interjection is removed */
  onInterjectionRemove: (interjectionId: NodeId) => void;
  /** Currently selected interjection ID */
  selectedInterjectionId: NodeId | null;
  /** Whether the panel is in editing mode */
  isEditing: boolean;
  /** Close the panel */
  onClose: () => void;
}

interface InterjectionItemProps {
  interjection: InterjectionMetadata;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onBoundaryChange: (newOffsetStart: number, newOffsetEnd: number, newText: string) => void;
  onRemove: () => void;
  passageText: string;
}

/**
 * Individual interjection item in the list
 */
function InterjectionItem({
  interjection,
  isSelected,
  isEditing,
  onSelect,
  onBoundaryChange,
  onRemove,
  passageText,
}: InterjectionItemProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingOffsets, setEditingOffsets] = useState({
    start: interjection.offsetStart,
    end: interjection.offsetEnd,
  });

  // Get the interjection text from the passage
  const interjectionText = useMemo(() => {
    return passageText.slice(interjection.offsetStart, interjection.offsetEnd);
  }, [passageText, interjection.offsetStart, interjection.offsetEnd]);

  // Get context around the interjection
  const contextBefore = useMemo(() => {
    const start = Math.max(0, interjection.offsetStart - 20);
    return passageText.slice(start, interjection.offsetStart);
  }, [passageText, interjection.offsetStart]);

  const contextAfter = useMemo(() => {
    const end = Math.min(passageText.length, interjection.offsetEnd + 20);
    return passageText.slice(interjection.offsetEnd, end);
  }, [passageText, interjection.offsetEnd]);

  const handleClick = useCallback(() => {
    onSelect();
    setIsExpanded(!isExpanded);
  }, [onSelect, isExpanded]);

  const handleOffsetChange = useCallback(
    (edge: 'start' | 'end', delta: number) => {
      const newStart =
        edge === 'start' ? Math.max(0, editingOffsets.start + delta) : editingOffsets.start;
      const newEnd =
        edge === 'end'
          ? Math.min(passageText.length, editingOffsets.end + delta)
          : editingOffsets.end;

      if (newStart < newEnd) {
        setEditingOffsets({ start: newStart, end: newEnd });
        const newText = passageText.slice(newStart, newEnd);
        onBoundaryChange(newStart, newEnd, newText);
      }
    },
    [editingOffsets, passageText, onBoundaryChange]
  );

  return (
    <li
      className={`interjection-panel-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      <div className="interjection-panel-item-header">
        <span className="interjection-panel-item-text">"{interjection.text}"</span>
        <span className="interjection-panel-item-offsets">
          [{interjection.offsetStart} - {interjection.offsetEnd}]
        </span>
      </div>

      {isExpanded && (
        <div className="interjection-panel-item-details">
          {/* Context preview */}
          <div className="interjection-panel-context">
            <span className="context-before">...{contextBefore}</span>
            <span className="context-highlight">{interjectionText}</span>
            <span className="context-after">{contextAfter}...</span>
          </div>

          {/* Boundary controls (only in editing mode) */}
          {isEditing && (
            <div className="interjection-panel-controls">
              <div className="boundary-control">
                <span className="boundary-label">Start:</span>
                <button
                  className="boundary-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOffsetChange('start', -1);
                  }}
                  title="Expand start"
                >
                  ←
                </button>
                <span className="boundary-value">{editingOffsets.start}</span>
                <button
                  className="boundary-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOffsetChange('start', 1);
                  }}
                  title="Shrink start"
                >
                  →
                </button>
              </div>

              <div className="boundary-control">
                <span className="boundary-label">End:</span>
                <button
                  className="boundary-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOffsetChange('end', -1);
                  }}
                  title="Shrink end"
                >
                  ←
                </button>
                <span className="boundary-value">{editingOffsets.end}</span>
                <button
                  className="boundary-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOffsetChange('end', 1);
                  }}
                  title="Expand end"
                >
                  →
                </button>
              </div>

              <button
                className="interjection-remove-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Remove interjection"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Side panel for managing interjections
 */
export function InterjectionSidePanel({
  passage,
  onInterjectionSelect,
  onInterjectionBoundaryChange,
  onInterjectionAdd,
  onInterjectionRemove,
  selectedInterjectionId,
  isEditing,
  onClose,
}: InterjectionSidePanelProps): React.JSX.Element | null {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newInterjectionText, setNewInterjectionText] = useState('');

  // Extract passage text content
  const passageText = useMemo(() => {
    if (!passage) return '';
    return passage.children
      .filter((child) => child.type === 'text')
      .map((child) => (child as { content: string }).content)
      .join('');
  }, [passage]);

  const interjections = passage?.metadata.interjections ?? [];

  // Handle adding a new interjection
  const handleAddInterjection = useCallback(() => {
    if (!newInterjectionText.trim()) return;

    // Find the text in the passage
    const index = passageText.indexOf(newInterjectionText);
    if (index >= 0) {
      onInterjectionAdd(newInterjectionText, index, index + newInterjectionText.length);
      setNewInterjectionText('');
      setShowAddForm(false);
    } else {
      // Text not found - show error or allow manual offset entry
      alert('Text not found in passage. Please select text that exists in the passage.');
    }
  }, [newInterjectionText, passageText, onInterjectionAdd]);

  if (!passage) {
    return null;
  }

  return (
    <div className="interjection-side-panel">
      <div className="interjection-panel-header">
        <h3>Interjections</h3>
        <button className="interjection-panel-close" onClick={onClose} title="Close panel">
          ×
        </button>
      </div>

      <div className="interjection-panel-info">
        <p>
          Click an interjection to highlight it in the editor.
          {isEditing && ' Use the controls to adjust boundaries.'}
        </p>
      </div>

      {interjections.length === 0 ? (
        <div className="interjection-panel-empty">
          <p>No interjections in this passage.</p>
          {isEditing && (
            <p className="hint">
              Interjections are audience responses or speaker asides within a Bible quote (e.g.,
              "Amen!", "A what?").
            </p>
          )}
        </div>
      ) : (
        <ul className="interjection-panel-list">
          {interjections.map((interjection) => (
            <InterjectionItem
              key={interjection.id}
              interjection={interjection}
              isSelected={selectedInterjectionId === interjection.id}
              isEditing={isEditing}
              onSelect={() => onInterjectionSelect(interjection.id)}
              onBoundaryChange={(start, end, text) =>
                onInterjectionBoundaryChange(interjection.id, start, end, text)
              }
              onRemove={() => onInterjectionRemove(interjection.id)}
              passageText={passageText}
            />
          ))}
        </ul>
      )}

      {/* Add interjection form */}
      {isEditing && (
        <div className="interjection-panel-add">
          {showAddForm ? (
            <div className="interjection-add-form">
              <input
                type="text"
                value={newInterjectionText}
                onChange={(e) => setNewInterjectionText(e.target.value)}
                placeholder="Enter interjection text..."
                className="interjection-add-input"
                autoFocus
              />
              <div className="interjection-add-actions">
                <button
                  className="interjection-add-confirm"
                  onClick={handleAddInterjection}
                  disabled={!newInterjectionText.trim()}
                >
                  Add
                </button>
                <button
                  className="interjection-add-cancel"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewInterjectionText('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="interjection-add-btn" onClick={() => setShowAddForm(true)}>
              + Add Interjection
            </button>
          )}
        </div>
      )}

      {/* Keyboard shortcuts */}
      <div className="interjection-panel-shortcuts">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>Enter</kbd> Expand/Collapse
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </div>
  );
}

export default InterjectionSidePanel;
