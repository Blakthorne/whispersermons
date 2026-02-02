---
goal: Fix AST Construction - Passage Node Boundary Misalignment
version: 1.1
date_created: 2026-02-02
last_updated: 2026-02-02
owner: WhisperSermons Development
status: 'Completed'
tags: [bug, refactor, ast, bible-passages, passage-detection]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-green)

Fix critical AST construction bug where passage nodes contain incorrect text due to boundary calculation errors. The Bible passage detection correctly identifies verses with high confidence, but the AST builder incorrectly maps the detected passage boundaries to paragraph content, resulting in passage nodes that contain trailing text instead of the actual Bible verse.

## Implementation Summary (COMPLETED)

### Key Fixes Applied

1. **Passage-to-Paragraph Mapping** (`ast_builder.py::_map_quotes_to_paragraphs()`):
   - Changed from overlap-based mapping to START-position-based mapping
   - Passage is now assigned to the paragraph containing its START position, not just any overlapping paragraph
   - This ensures passages are assigned to the correct paragraph

2. **Single-Paragraph Passage Constraint** (`ast_builder.py::_enforce_single_paragraph_passages()`):
   - Added new method to detect when a passage would span multiple paragraphs
   - Automatically merges paragraphs that would split a passage
   - Logs warnings when merging occurs for debugging

3. **Content Normalization** (`ast_builder.py::_build_passage_node()`):
   - Passage content is normalized to remove internal paragraph breaks (`\n\n`)
   - Ensures passage content is continuous text within the AST

4. **Debug Logging Infrastructure**:
   - Added comprehensive debug logging throughout the AST builder
   - Debug mode can be enabled via `debug=True` parameter in `build_ast()`
   - Logs passage boundaries, paragraph mapping, and content extraction

5. **Test Suite** (`test_ast_passage_boundaries.py`):
   - Created comprehensive test suite for passage boundary handling
   - Tests passage mapping by start position
   - Tests single-paragraph constraint enforcement
   - Tests multiple passages in a document
   - Tests full pipeline integration

### Files Modified

- `src/python/ast_builder.py` - Core fixes and debug logging
- `src/python/whisper_bridge.py` - Added `debug_ast` flag support
- `src/python/test_ast_passage_boundaries.py` - New test suite (created)

### All Tests Passing

```
======================================================================
TEST SUMMARY
======================================================================
  ✓ PASS: Passage mapping by START position
  ✓ PASS: Single-paragraph constraint
  ✓ PASS: Multiple passages in document
  ✓ PASS: Full pipeline integration

Results: 4/4 tests passed
```

---

## Problem Summary

**Current Behavior:**
```json
{
  "type": "paragraph",
  "children": [
    { "type": "text", "content": "...put a smile on " },
    {
      "type": "passage",
      "metadata": { "reference": "Romans 12:1", "confidence": 0.966 },
      "children": [{ "type": "text", "content": "his face." }]  // ❌ WRONG
    }
  ]
},
{
  "type": "paragraph",
  "children": [{
    "type": "text",
    "content": "Romans 12 one says Paul writes I beseech you therefore..."  // ✅ Actual passage
  }]
}
```

**Expected Behavior:**
```json
{
  "type": "paragraph",
  "children": [{
    "type": "text",
    "content": "...put a smile on his face. Romans 12:1 says Paul writes"
  }]
},
{
  "type": "passage",
  "metadata": { "reference": "Romans 12:1", "confidence": 0.966 },
  "children": [{
    "type": "text",
    "content": "I beseech you therefore brethren by the mercies of God..."
  }]
},
{
  "type": "paragraph",
  "children": [{ "type": "text", "content": "What is Paul saying..." }]
}
```

## Root Cause Analysis

### Phase 1: Passage Detection (✅ Working Correctly)

`bible_quote_processor.py::find_quote_boundaries_improved()` correctly identifies:
- **Reference position**: Where "Romans 12:1" appears in transcript
- **Effective reference length**: Including intro phrases ("says Paul writes")
- **Passage start**: Position where actual verse text begins ("I beseech you...")
- **Passage end**: Position where verse text ends

The passage boundary object (`QuoteBoundary`) contains:
```python
QuoteBoundary(
    start_pos=X,    # Points to "I beseech you..."
    end_pos=Y,      # Points to end of verse
    reference=...,
    verse_text="I beseech you therefore...",
    confidence=0.966
)
```

### Phase 2: Paragraph Splitting (❌ Issue Here)

`ast_builder.py::_split_into_paragraphs()` splits text on double newlines:
```python
# Returns: List[(para_start, para_end, para_content)]
[
    (0, 500, "...put a smile on his face."),
    (502, 1200, "Romans 12 one says...What is Paul saying...")
]
```

**Problem**: The passage boundaries (start_pos, end_pos) are in the SECOND paragraph, but the paragraph splitting happens BEFORE passage mapping.

### Phase 3: Passage-to-Paragraph Mapping (❌ Major Bug)

`ast_builder.py::_map_quotes_to_paragraphs()` checks if a passage boundary overlaps with a paragraph:
```python
if quote.start_pos < para_end and quote.end_pos > para_start:
    paragraph_quotes[para_idx].append(quote)
```

**Issue**: This can map a passage to the WRONG paragraph if boundaries span multiple paragraphs.

### Phase 4: Building Paragraph Children (❌ Incorrect Calculations)

`ast_builder.py::_build_paragraph_children_with_passages()`:
```python
# Convert absolute positions to relative positions
quote_start_rel = quote.start_pos - para_start
quote_end_rel = quote.end_pos - para_start

# Extract content
text_before = para_content[current_pos:quote_start_rel]
quote_content = para_content[quote_start_rel:quote_end_rel]
```

**Critical Issue**: If `start_pos` is in a DIFFERENT paragraph than where it's mapped, the relative calculation produces NEGATIVE or OUT-OF-BOUNDS indices, which get clamped:
```python
quote_start_rel = max(0, quote_start_rel)  # Clamps negative to 0
quote_end_rel = min(len(para_content), quote_end_rel)  # Clamps overflow
```

This clamping causes the passage node to extract the WRONG text from the paragraph.

## Testing Evidence Needed

Before implementation, we need to:

1. **Test Passage Boundary Output**: Run `bible_quote_processor.py` on sample transcript and log:
   - Exact `start_pos` and `end_pos` values
   - Character positions in full transcript
   - Actual text at those positions

2. **Test Paragraph Splitting**: Log paragraph boundaries:
   - Start/end positions for each paragraph
   - Actual content of each paragraph
   - Verify alignment with transcript

3. **Test Passage-Paragraph Mapping**: Check which paragraph each passage is assigned to:
   - Expected paragraph (based on content)
   - Actual paragraph (based on overlap logic)
   - Identify mismatches

4. **Test Relative Position Calculation**: Log the math:
   - Absolute positions: `quote.start_pos`, `quote.end_pos`
   - Paragraph positions: `para_start`, `para_end`
   - Relative positions: `quote_start_rel`, `quote_end_rel`
   - Extracted content vs expected content

## 1. Requirements & Constraints

- **REQ-001**: Passage nodes MUST contain only the actual Bible verse text from the transcript
- **REQ-002**: Spoken references (e.g., "Romans 12:1 says Paul writes") MUST remain in the preceding paragraph text
- **REQ-003**: Passage boundaries from `bible_quote_processor.py` must be preserved and used correctly
- **REQ-004**: Passages MUST NOT span multiple paragraphs; paragraph transcription MUST prevent passage splits
- **REQ-005**: If a user edit causes a passage to span multiple paragraphs, the AST MUST be restructured to preserve the single-paragraph passage constraint
- **REQ-006**: Must handle edge cases: multiple passages per paragraph, overlapping passage ranges
- **REQ-007**: Must maintain backward compatibility with existing document model types
- **REQ-008**: Must preserve all metadata (confidence, translation, interjections)
- **REQ-009**: Must work with all Bible translations and reference formats
- **CON-001**: Cannot modify `bible_quote_processor.py` output format (would break upstream dependencies)
- **CON-002**: Cannot change document model schema (would break renderer/editor)
- **CON-003**: Must maintain performance for large transcripts (10,000+ words)
- **GUD-001**: Prioritize correctness over performance - AST building is done once per transcription
- **GUD-002**: Add comprehensive debug logging to trace boundary calculations
- **PAT-001**: Use defensive programming - validate all boundary calculations before string slicing

## 2. Implementation Steps

### Implementation Phase 1: Add Comprehensive Debug Logging

- GOAL-001: Add detailed logging to trace boundary calculation bugs and validate fixes

| Task     | Description                                                                                                  | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-001 | Add `--debug-ast` flag to `main.py` to enable AST builder debug mode                                        |           |      |
| TASK-002 | Log passage boundaries in `bible_quote_processor.py` (start_pos, end_pos, reference, actual text at positions) |           |      |
| TASK-003 | Log paragraph splitting in `ast_builder.py` (para_start, para_end, content preview)                         |           |      |
| TASK-004 | Log passage-to-paragraph mapping (which passages assigned to which paragraphs)                               |           |      |
| TASK-005 | Log relative position calculations (absolute → relative conversions, clamping events)                        |           |      |
| TASK-006 | Log extracted content for passages (expected vs actual text)                                                 |           |      |
| TASK-007 | Create test transcript with known boundary issues (Romans 12:1 example)                                      |           |      |
| TASK-008 | Run test and collect debug output to validate root cause analysis                                            |           |      |

### Implementation Phase 2: Fix Passage-Paragraph Mapping Logic

- GOAL-002: Correctly assign passages to paragraphs based on where the passage content actually appears

| Task     | Description                                                                                                        | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-009 | Modify `_map_quotes_to_paragraphs()` to check if passage START is within paragraph (not just overlap)             |           |      |
| TASK-010 | Enforce single-paragraph passages during paragraph transcription (merge or adjust paragraph breaks as needed)    |           |      |
| TASK-011 | Add validation: Log warning if passage boundaries are far outside assigned paragraph (>500 chars)                 |           |      |
| TASK-012 | Add unit test: Verify passages are assigned to correct paragraphs (use test transcript from TASK-007)             |           |      |
| TASK-013 | Add integration test: Process full transcript and verify all passages mapped correctly                            |           |      |

### Implementation Phase 3: Fix Boundary Calculation in Paragraph Building

- GOAL-003: Correctly calculate relative positions and extract passage content

| Task     | Description                                                                                                        | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-014 | Modify `_build_paragraph_children_with_passages()` to validate passage is within paragraph bounds BEFORE calculation |           |      |
| TASK-015 | Add assertion: `quote.start_pos >= para_start and quote.end_pos <= para_end` (multi-paragraph passages not allowed) |           |      |
| TASK-016 | Remove clamping logic (should not be needed if mapping is correct)                                                |           |      |
| TASK-017 | Add detailed error message if passage is outside paragraph: include reference, positions, paragraph content preview |           |      |
| TASK-018 | If a passage spans multiple paragraphs, restructure AST to move/merge content so passage is contained in one paragraph |           |      |
| TASK-019 | Add unit test: Verify relative position calculations are correct for various passage positions                    |           |      |

### Implementation Phase 4: Handle Edge Cases

- GOAL-004: Robustly handle single-paragraph passages, multiple passages, and overlapping boundaries

| Task     | Description                                                                                                        | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-020 | On user edits that span paragraphs, restructure AST to keep each passage contained in a single paragraph          |           |      |
| TASK-021 | Handle overlapping passages: Sort by start_pos, warn if overlap >10 chars, use first passage for overlapping region |           |      |
| TASK-022 | Handle passage with no content: Skip if `quote_end_rel - quote_start_rel < 5` chars (log warning)                  |           |      |
| TASK-023 | Handle paragraph with no text between passages: Ensure empty text nodes are not created                           |           |      |
| TASK-024 | Add comprehensive test suite: single-paragraph enforcement, overlapping passages, edge-to-edge passages           |           |      |

### Implementation Phase 5: Validate and Test End-to-End

- GOAL-005: Verify fixes work correctly across diverse sermon transcripts with various reference patterns

| Task     | Description                                                                                                        | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-025 | Test with Romans 12:1 transcript (original bug report)                                                             |           |      |
| TASK-026 | Test with multiple references in single paragraph (e.g., "John 3:16 and Romans 8:28 say...")                       |           |      |
| TASK-027 | Test with chapter-only references (e.g., "Galatians 4 says...")                                                    |           |      |
| TASK-028 | Test with verse ranges (e.g., "Matthew 5:3-12")                                                                    |           |      |
| TASK-029 | Test with spoken references (e.g., "Romans twelve one")                                                            |           |      |
| TASK-030 | Test with passages containing interjections (e.g., "...your heart, what? Also.")                                   |           |      |
| TASK-031 | Run full transcription pipeline on 5+ diverse sermons                                                              |           |      |
| TASK-032 | Manually verify AST structure in Dev AST panel for each test                                                       |           |      |
| TASK-033 | Compare passage node content against API verse text (should match closely)                                         |           |      |
| TASK-034 | Test user edits that attempt to span passages across paragraphs and verify AST restructuring                       |           |      |

### Implementation Phase 6: Cleanup and Documentation

- GOAL-006: Remove temporary debug code, update documentation, prepare for production

| Task     | Description                                                                                                        | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-035 | Make debug logging opt-in via `--debug-ast` flag (don't log by default)                                           |           |      |
| TASK-036 | Add code comments explaining boundary calculation logic                                                            |           |      |
| TASK-037 | Update `.github/document-model-instructions.md` with passage boundary details                                      |           |      |
| TASK-038 | Add troubleshooting guide for passage detection issues                                                             |           |      |
| TASK-039 | Run final integration test with debug logging disabled                                                             |           |      |
| TASK-040 | Update CHANGELOG.md with fix details                                                                               |           |      |

## 3. Alternatives

- **ALT-001**: Modify `bible_quote_processor.py` to return paragraph-aware boundaries
  - **Rejected**: Would require major refactor of passage detection pipeline; breaks separation of concerns
  
- **ALT-002**: Change paragraph splitting to avoid splitting mid-passage
  - **Rejected**: Passages must be single-paragraph; paragraph transcription will be constrained to enforce this
  
- **ALT-003**: Use TipTap editor to handle passage boundaries instead of AST
  - **Rejected**: Violates "AST is source of truth" architectural principle; would break undo/redo
  
- **ALT-004**: Post-process AST to fix misaligned passages
  - **Rejected**: Band-aid solution; doesn't fix root cause; would add complexity

## 4. Dependencies

- **DEP-001**: Python `bible_quote_processor.py` - Provides passage boundaries (no changes needed)
- **DEP-002**: Python `document_model.py` - Defines PassageNode, BibleReferenceMetadata (no changes needed)
- **DEP-003**: Python `ast_builder.py` - Core module being fixed
- **DEP-004**: Dev AST panel in renderer - Used for manual verification of fixes

## 5. Files

- **FILE-001**: `src/python/ast_builder.py` - Primary file being modified
  - `_split_into_paragraphs()` - Enforce single-paragraph passages + logging
  - `_map_quotes_to_paragraphs()` - Fix passage mapping logic
  - `_build_paragraph_children_with_passages()` - Fix boundary calculations
  
- **FILE-002**: `src/python/bible_quote_processor.py` - Add logging only
  - `find_quote_boundaries_improved()` - Log boundary detection results
  - `process_text_with_quotes()` - Log passage boundary creation
  
- **FILE-003**: `src/python/main.py` - Add debug flag
  - Add `--debug-ast` CLI argument
  - Pass debug flag to AST builder
  
- **FILE-004**: `src/python/test_boundary_detection.py` - Create comprehensive tests
  - Test passage-paragraph mapping
  - Test relative position calculations
  - Test single-paragraph enforcement

## 6. Testing

- **TEST-001**: Unit test for `_split_into_paragraphs()` - Verify paragraph boundaries are correct
- **TEST-002**: Unit test for `_map_quotes_to_paragraphs()` - Verify passages assigned to correct paragraphs
- **TEST-003**: Unit test for `_build_paragraph_children_with_passages()` - Verify relative calculations
- **TEST-004**: Integration test for Romans 12:1 example (original bug)
- **TEST-005**: Integration test for single-paragraph passage enforcement
- **TEST-006**: Integration test for overlapping passages
- **TEST-007**: Integration test for edge cases (empty text, no passages, etc.)
- **TEST-008**: End-to-end test with 5+ diverse sermon transcripts
- **TEST-009**: Performance test with 10,000+ word transcript
- **TEST-010**: User edit test: attempt to span passage across paragraphs, verify AST restructuring

## 7. Risks & Assumptions

- **RISK-001**: Fix may reveal other boundary detection issues in `bible_quote_processor.py`
  - **Mitigation**: Comprehensive logging will help identify upstream issues
  
- **RISK-002**: Edge cases may exist that aren't covered by test transcripts
  - **Mitigation**: Add extensive logging; monitor production usage for new edge cases
  
- **RISK-003**: Single-paragraph passage enforcement may alter paragraph segmentation
  - **Mitigation**: Validate paragraph transcription rules and review Dev AST panel output
  
- **ASSUMPTION-001**: `bible_quote_processor.py` boundaries are always accurate
  - **Validation Needed**: TASK-008 will validate this assumption
  
- **ASSUMPTION-002**: Paragraph splitting on double newlines is always semantic
  - **Known Limitation**: May split mid-passage if transcript has formatting errors
  
- **ASSUMPTION-003**: Passage start_pos is always the beginning of the verse text (not the reference)
  - **Validation Needed**: TASK-002 logging will confirm this

## 8. Related Specifications / Further Reading

- [WhisperSermons Document Model Instructions](.github/document-model-instructions.md)
- [WhisperSermons Coding Instructions](.github/copilot-instructions.md)
- [Bible Passage Processor Pipeline](.github/copilot-instructions.md#bible-quote-detection)
- [AST ↔ TipTap Sync Pattern](.github/copilot-instructions.md#tiptap-integration-patterns)
