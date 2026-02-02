---
goal: Fix AST Passage Structure Isolation - Passages Must Be Standalone in Paragraphs with Accurate Boundaries
version: 1.0
date_created: 2026-02-02
last_updated: 2026-02-02
owner: WhisperSermons Development
status: 'Planned'
tags: [refactor, ast, bible-passages, passage-detection, boundary-detection]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Fix critical AST structural and boundary issues where passage nodes are incorrectly embedded with other text nodes in paragraphs, and passage content boundaries don't accurately match the actual Bible verse text. This plan addresses three interconnected issues:

1. **Structural Issue**: Passage nodes must be the **sole child** of their paragraph node - no sibling text nodes allowed
2. **Start Boundary Issue**: Passage text incorrectly includes introductory/attribution text ("his face. Romans 12 one says Paul writes")
3. **End Boundary Issue**: Passage text excludes the final portion of the verse (" unto God which is your reasonable service.")

## 1. Requirements & Constraints

### Requirements

- **REQ-001**: Passage nodes MUST be the only child of their containing paragraph node
- **REQ-002**: Text before a passage must be split into a separate preceding paragraph node
- **REQ-003**: Text after a passage must be split into a separate following paragraph node
- **REQ-004**: Passage start boundary must begin at the first word of the actual Bible verse (e.g., "I beseech")
- **REQ-005**: Passage end boundary must include the complete verse text up to and including final punctuation
- **REQ-006**: The spoken reference and intro phrases (e.g., "Romans 12 one says Paul writes") must remain in the preceding text node
- **REQ-007**: Confidence scoring must accurately reflect boundary detection quality
- **REQ-008**: All existing tests must continue to pass

### Constraints

- **CON-001**: Changes must be backward compatible with existing document model types
- **CON-002**: Must not break TipTap ↔ AST synchronization
- **CON-003**: Python processing pipeline must maintain existing API contracts
- **CON-004**: Performance must not degrade significantly (< 20% slowdown acceptable)

### Guidelines

- **GUD-001**: Prefer explicit boundary detection over fuzzy/heuristic approaches
- **GUD-002**: Debug logging should be comprehensive for troubleshooting boundary issues
- **GUD-003**: Test with real sermon transcripts containing various quoting patterns

### Patterns

- **PAT-001**: Follow existing passage boundary detection flow: `find_quote_boundaries_improved()` → `QuoteBoundary` → `ASTBuilder`
- **PAT-002**: Maintain single-paragraph passage constraint through structural isolation

## 2. Root Cause Analysis

### Issue 1: Mixed Passage/Text Nodes in Paragraphs

**Current Behavior:**
```json
{
  "type": "paragraph",
  "children": [
    { "type": "text", "content": "...put a smile on " },
    { "type": "passage", "children": [...] },
    { "type": "text", "content": " unto God which is..." }
  ]
}
```

**Root Cause:** The AST builder's `_build_paragraph_children_with_passages()` method is designed to interleave text and passage nodes within a single paragraph. This approach violates the requirement that passages be standalone.

**Location:** `src/python/ast_builder.py`, lines 497-598

**Fix Required:** Restructure the AST builder to:
1. When a passage is detected within a paragraph, split the paragraph into up to 3 separate nodes
2. Create separate paragraph nodes for text-before and text-after
3. Wrap the passage in its own paragraph node (or make passage a direct child of root)

### Issue 2: Start Boundary Includes Attribution Text

**Current Behavior:**
```json
{
  "type": "passage",
  "children": [{
    "type": "text",
    "content": "his face. Romans 12 one says Paul writes I beseech you therefore brethren..."
  }]
}
```

**Expected:**
```json
{
  "type": "passage",
  "children": [{
    "type": "text",
    "content": "I beseech you therefore brethren..."
  }]
}
```

**Root Cause:** The `find_quote_boundaries_improved()` function correctly detects the forward search region starting after the reference+intro, but:
1. The `extract_reference_intro_length()` function may not be capturing all intro patterns (e.g., "says Paul writes")
2. The `find_distinctive_phrases()` matching may be including matches from before the actual verse start due to gap validation issues

**Locations:**
- `src/python/bible_quote_processor.py`, lines 1685-1733 (`extract_reference_intro_length()`)
- `src/python/bible_quote_processor.py`, lines 1733-2010 (`find_quote_boundaries_improved()`)

**Fix Required:**
1. Expand intro phrase patterns to handle multi-word patterns like "says Paul writes"
2. Ensure the forward search region strictly starts AFTER all intro phrases
3. Add validation that first phrase match doesn't include reference/intro text

### Issue 3: End Boundary Excludes Verse Ending

**Current Behavior:** Passage ends at "...living sacrifice wholly acceptable" but excludes " unto God which is your reasonable service."

**Root Cause:** The `validate_quote_end()` function may be aggressively trimming the quote end based on sentence boundary detection that doesn't account for the full verse text. Additionally, the cluster analysis in `find_quote_boundaries_improved()` may not be including the final phrase matches if they're separated by interjection words or punctuation.

**Location:** `src/python/bible_quote_processor.py`, lines 1493-1565 (`validate_quote_end()`)

**Fix Required:**
1. When verse text is known, use it as the authoritative guide for end boundary
2. Implement verse text similarity validation at the end boundary
3. Extend quote to include remaining verse words when they appear in transcript

## 3. Implementation Steps

### Phase 1: AST Structural Isolation

- GOAL-001: Ensure passage nodes are the sole child of their paragraph (or direct child of root)

| Task | Description | Completed | Date |
| ---- | ----------- | --------- | ---- |
| TASK-001 | Refactor `_build_paragraph_nodes()` in `ast_builder.py` to split paragraphs containing passages into separate nodes | | |
| TASK-002 | Create new helper method `_split_paragraph_around_passages()` that returns list of paragraph/passage nodes | | |
| TASK-003 | Update `_build_paragraph_children_with_passages()` to return multiple nodes instead of mixed children | | |
| TASK-004 | Ensure text-before-passage creates its own paragraph node with proper content | | |
| TASK-005 | Ensure text-after-passage creates its own paragraph node with proper content | | |
| TASK-006 | Handle edge case: multiple passages in same original paragraph should each get their own node | | |
| TASK-007 | Update debug logging to trace paragraph splitting decisions | | |

### Phase 2: Start Boundary Detection Fix

- GOAL-002: Accurately detect where the actual Bible verse text begins, excluding reference and intro phrases

| Task | Description | Completed | Date |
| ---- | ----------- | --------- | ---- |
| TASK-008 | Expand `INTRO_PHRASE_PATTERNS` in `bible_quote_processor.py` to handle compound patterns like "says [Name] writes" | | |
| TASK-009 | Add pattern for "says Paul writes", "says Jesus tells us", "writes the apostle", etc. | | |
| TASK-010 | Implement `validate_start_is_verse_text()` function to verify start position matches verse beginning | | |
| TASK-011 | In `find_quote_boundaries_improved()`, add post-processing to trim start if it includes non-verse text | | |
| TASK-012 | Add similarity check between detected quote start and expected verse start (first 5-10 words) | | |
| TASK-013 | When start mismatch detected, search forward from detected start to find actual verse beginning | | |

### Phase 3: End Boundary Detection Fix

- GOAL-003: Ensure passage end boundary includes the complete verse text

| Task | Description | Completed | Date |
| ---- | ----------- | --------- | ---- |
| TASK-014 | Refactor `validate_quote_end()` to use verse text as authoritative guide | | |
| TASK-015 | Implement `find_verse_end_in_transcript()` that locates where verse text ends in transcript | | |
| TASK-016 | Add word-by-word matching from verse text to transcript to find true end position | | |
| TASK-017 | Handle transcription variations (e.g., "unto God" vs "to God", "wholly" vs "holy") | | |
| TASK-018 | Extend `extend_quote_past_interjection()` to also extend past sentence boundaries within verse | | |
| TASK-019 | Add confidence penalty when detected end doesn't include expected verse ending words | | |

### Phase 4: Integration and Orchestration

- GOAL-004: Integrate all fixes into the processing pipeline with proper orchestration

| Task | Description | Completed | Date |
| ---- | ----------- | --------- | ---- |
| TASK-020 | Update `QuoteBoundary` dataclass to include `verified_start_pos` and `verified_end_pos` fields | | |
| TASK-021 | Add boundary verification step in `process_quotes()` that adjusts boundaries after initial detection | | |
| TASK-022 | Ensure AST builder uses verified positions when available | | |
| TASK-023 | Add `boundary_adjustment` metadata to track how much boundaries were shifted | | |
| TASK-024 | Update debug output to show original vs verified boundary positions | | |

### Phase 5: Testing and Validation

- GOAL-005: Comprehensive test coverage for all boundary and structural fixes

| Task | Description | Completed | Date |
| ---- | ----------- | --------- | ---- |
| TASK-025 | Create test case for Romans 12:1 example from user report | | |
| TASK-026 | Add test for passage structural isolation (no sibling text nodes) | | |
| TASK-027 | Add test for start boundary excluding intro phrases | | |
| TASK-028 | Add test for end boundary including complete verse | | |
| TASK-029 | Add test for multiple passages in document with correct isolation | | |
| TASK-030 | Add test for passages with interjections preserving boundaries | | |
| TASK-031 | Run full pipeline test with real sermon transcript | | |
| TASK-032 | Verify TipTap integration still works with new AST structure | | |

## 4. Alternatives

- **ALT-001**: Make PassageNode a direct child of DocumentRootNode instead of wrapping in paragraph
  - Rejected: Would require significant changes to document model and TipTap integration
  
- **ALT-002**: Use ML-based boundary detection instead of rule-based
  - Rejected: Adds complexity and latency; current approach is accurate when properly calibrated
  
- **ALT-003**: Require manual boundary verification for all passages
  - Rejected: Poor UX; automated detection should handle common cases correctly

## 5. Dependencies

- **DEP-001**: No new external Python packages required
- **DEP-002**: Bolls.life Bible API for verse text verification
- **DEP-003**: Existing `sentence-transformers` for similarity calculations if needed

## 6. Files

- **FILE-001**: `src/python/ast_builder.py` - Core AST construction, paragraph splitting logic
- **FILE-002**: `src/python/bible_quote_processor.py` - Boundary detection, intro phrase patterns
- **FILE-003**: `src/python/document_model.py` - Document model types (may need QuoteBoundary updates)
- **FILE-004**: `src/python/test_ast_passage_boundaries.py` - Existing boundary tests
- **FILE-005**: `src/python/test_boundary_detection.py` - Existing detection tests
- **FILE-006**: `src/python/test_passage_isolation.py` - New test file for structural isolation
- **FILE-007**: `src/shared/documentModel.ts` - TypeScript types (verify compatibility)

## 7. Testing

### Unit Tests

- **TEST-001**: `test_passage_structural_isolation()` - Verify passages are sole children of paragraphs
- **TEST-002**: `test_text_before_passage_separate_paragraph()` - Verify text before passage gets own paragraph
- **TEST-003**: `test_text_after_passage_separate_paragraph()` - Verify text after passage gets own paragraph
- **TEST-004**: `test_start_boundary_excludes_reference()` - Verify "Romans 12:1 says" excluded from passage
- **TEST-005**: `test_start_boundary_excludes_compound_intro()` - Verify "says Paul writes" excluded
- **TEST-006**: `test_end_boundary_includes_full_verse()` - Verify "...reasonable service" included
- **TEST-007**: `test_romans_12_1_real_example()` - Full test with provided example
- **TEST-008**: `test_multiple_passages_isolated()` - Multiple passages each get own paragraph

### Integration Tests

- **TEST-009**: Full pipeline test with test_mode_transcript.txt
- **TEST-010**: TipTap roundtrip test with isolated passage structure
- **TEST-011**: Export to DOCX/PDF with properly isolated passages

## 8. Risks & Assumptions

### Risks

- **RISK-001**: Paragraph splitting may break existing document display in TipTap
  - Mitigation: Test TipTap integration thoroughly before merging
  
- **RISK-002**: More aggressive boundary detection may reduce confidence scores
  - Mitigation: Add confidence bonuses for verified boundaries
  
- **RISK-003**: Performance impact from additional boundary verification steps
  - Mitigation: Only verify boundaries when initial detection has moderate confidence

### Assumptions

- **ASSUMPTION-001**: Verse text from Bolls.life API is accurate and can be used as ground truth
- **ASSUMPTION-002**: Speakers typically say the reference before quoting (forward direction)
- **ASSUMPTION-003**: Transcription maintains word order even with minor spelling variations

## 9. Implementation Details

### Detailed Algorithm: `_split_paragraph_around_passages()`

```python
def _split_paragraph_around_passages(
    self,
    para_content: str,
    para_start: int,
    quotes: List[QuoteBoundary]
) -> List[Union[ParagraphNode, PassageNode]]:
    """
    Split a paragraph containing passages into separate nodes.
    
    Returns:
        List of nodes in order: [text_para?, passage, text_para?, passage?, ...]
    """
    nodes = []
    current_pos = 0
    
    for quote in sorted(quotes, key=lambda q: q.start_pos):
        # Calculate relative positions
        passage_start_rel = quote.start_pos - para_start
        passage_end_rel = quote.end_pos - para_start
        
        # Text before passage -> separate paragraph
        if passage_start_rel > current_pos:
            text_before = para_content[current_pos:passage_start_rel].strip()
            if text_before:
                nodes.append(create_paragraph_node(
                    children=[create_text_node(text_before)]
                ))
        
        # Passage -> standalone (wrapped in paragraph for TipTap compatibility)
        passage_content = para_content[passage_start_rel:passage_end_rel]
        passage_node = self._build_passage_node(quote, passage_content)
        # Wrap passage in paragraph to maintain TipTap block structure
        nodes.append(create_paragraph_node(children=[passage_node]))
        
        current_pos = passage_end_rel
    
    # Text after last passage -> separate paragraph
    if current_pos < len(para_content):
        text_after = para_content[current_pos:].strip()
        if text_after:
            nodes.append(create_paragraph_node(
                children=[create_text_node(text_after)]
            ))
    
    return nodes
```

### Detailed Algorithm: Start Boundary Verification

```python
def validate_start_is_verse_text(
    transcript: str,
    detected_start: int,
    verse_text: str,
    max_search_forward: int = 100
) -> int:
    """
    Verify that detected_start points to actual verse text, not intro phrases.
    
    Returns:
        Adjusted start position that matches verse beginning
    """
    verse_words = get_words(verse_text)
    first_verse_words = verse_words[:5]  # First 5 words of verse
    
    # Check if detected start matches verse start
    detected_text = transcript[detected_start:detected_start + 100]
    detected_words = get_words(detected_text)[:5]
    
    # Calculate similarity
    matches = sum(1 for i, w in enumerate(detected_words) 
                  if i < len(first_verse_words) and w == first_verse_words[i])
    
    if matches >= 3:
        return detected_start  # Good match
    
    # Search forward for better match
    for offset in range(0, max_search_forward, 5):
        search_pos = detected_start + offset
        search_text = transcript[search_pos:search_pos + 100]
        search_words = get_words(search_text)[:5]
        
        matches = sum(1 for i, w in enumerate(search_words)
                      if i < len(first_verse_words) and w == first_verse_words[i])
        
        if matches >= 3:
            return search_pos
    
    return detected_start  # Couldn't improve, use original
```

### Detailed Algorithm: End Boundary Extension

```python
def find_verse_end_in_transcript(
    transcript: str,
    start_pos: int,
    verse_text: str,
    max_search: int = 1000
) -> int:
    """
    Find where the verse text ends in the transcript using word matching.
    
    Returns:
        Position in transcript where verse text ends
    """
    verse_words = get_words(verse_text)
    search_region = transcript[start_pos:start_pos + max_search]
    search_words = get_words(search_region)
    
    # Find consecutive matching words from verse
    best_end_idx = 0
    verse_idx = 0
    
    for i, word in enumerate(search_words):
        if verse_idx < len(verse_words):
            # Allow fuzzy matching for transcription variations
            if words_match_fuzzy(word, verse_words[verse_idx]):
                verse_idx += 1
                # Update best end position
                word_pos = find_word_end_position(search_region, word, best_end_idx)
                if word_pos > best_end_idx:
                    best_end_idx = word_pos
            elif verse_idx > 0:
                # Allow skipping one word (interjection)
                if verse_idx + 1 < len(verse_words) and words_match_fuzzy(word, verse_words[verse_idx + 1]):
                    verse_idx += 2
                    word_pos = find_word_end_position(search_region, word, best_end_idx)
                    if word_pos > best_end_idx:
                        best_end_idx = word_pos
    
    # Check coverage - did we find most of the verse?
    coverage = verse_idx / len(verse_words)
    if coverage < 0.7:
        return -1  # Insufficient coverage, boundary unreliable
    
    return start_pos + best_end_idx
```

## 10. Related Specifications / Further Reading

- [refactor-ast-passage-boundary-fix-1.md](refactor-ast-passage-boundary-fix-1.md) - Previous boundary fix plan
- [.github/document-model-instructions.md](../.github/document-model-instructions.md) - Document model architecture
- [.github/copilot-instructions.md](../.github/copilot-instructions.md) - Project coding instructions
