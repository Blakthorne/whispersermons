---
goal: Fix Incorrect Bible Passage Boundary Detection in Transcriptions
version: 1.0
date_created: 2026-01-26
last_updated: 2026-01-26
owner: AI Assistant
status: 'Completed'
tags: ['bug', 'refactor', 'python', 'bible-detection', 'ast-builder']
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

The Bible passage boundary detection system is incorrectly identifying quote boundaries when the reference mention appears before the actual quoted text. The current implementation only searches **forward** from the reference position, but in sermon transcripts, speakers often reference a verse (e.g., "Romans 12:1 says...") and then quote it immediately after. The search window misses this pattern and incorrectly captures nearby text instead.

**Example Issue:**
- Transcript: `"...put a smile on his face. Romans 12 one says Paul writes I beseech you therefore brethren..."`
- Expected: System should detect `"I beseech you therefore brethren..."` as the passage
- Actual: System detects `"his face."` as the passage (text BEFORE the reference)

**Root Cause:**
The `find_quote_boundaries_improved()` function in `bible_quote_processor.py` searches from `ref_position + ref_length` forward, but when the reference includes introductory text like "Romans 12 one says Paul writes", the search window starts too late and misses the actual quote. Additionally, the phrase matching may be finding partial matches in the wrong direction.

## 1. Requirements & Constraints

**Requirements:**
- **REQ-001**: The system MUST search both BEFORE and AFTER the reference position to find passage text
- **REQ-002**: The system MUST prioritize passages that appear AFTER the reference mention (most common pattern)
- **REQ-003**: The system MUST handle introductory phrases like "Romans 12:1 says", "Paul writes in Romans 12", etc.
- **REQ-004**: The system MUST maintain backward compatibility with existing confidence scoring (0.0-1.0 scale)
- **REQ-005**: The system MUST NOT break existing interjection detection or commentary block detection
- **REQ-006**: The system MUST preserve all metadata in QuoteBoundary objects
- **REQ-007**: The system MUST maintain existing API caching and rate limiting behavior

**Constraints:**
- **CON-001**: Cannot change the QuoteBoundary data structure (used by AST builder)
- **CON-002**: Cannot break existing test mode functionality
- **CON-003**: Must maintain performance (no exponential complexity increases)
- **CON-004**: Must work with all supported Bible translations (KJV, NKJV, NIV, ESV, etc.)
- **CON-005**: Search window size must be reasonable (avoid searching entire 10,000+ char transcripts)

**Guidelines:**
- **GUD-001**: Prefer explicit, well-commented code for complex boundary detection logic
- **GUD-002**: Add logging/debugging output for boundary detection decisions
- **GUD-003**: Validate changes against real sermon transcript samples
- **GUD-004**: Use clear variable names that distinguish "before ref" vs "after ref" search regions

**Patterns to Follow:**
- **PAT-001**: Follow existing fuzzy matching pattern with distinctive phrase extraction
- **PAT-002**: Maintain existing clustering logic for contiguous phrase matches
- **PAT-003**: Keep existing gap validation to detect commentary vs verse content
- **PAT-004**: Preserve existing confidence calculation methodology

## 2. Implementation Steps

### Implementation Phase 1: Diagnosis and Search Window Analysis

- GOAL-001: Understand the exact failure mode and validate root cause hypothesis

| Task     | Description                                                                                                                  | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-001 | Add debug logging to `find_quote_boundaries_improved()` to output search window bounds (search_start, search_end)           | ✅        | 2026-01-26 |
| TASK-002 | Add debug logging to output the actual text in the search window                                                             | ✅        | 2026-01-26 |
| TASK-003 | Add debug logging to output all phrase matches found (with positions and scores)                                             | ✅        | 2026-01-26 |
| TASK-004 | Run the system on the problematic transcript excerpt and capture debug output to confirm the search window misses the quote | ✅        | 2026-01-26 |
| TASK-005 | Analyze reference position calculation to understand where "Romans 12 one says" ends and search begins                       | ✅        | 2026-01-26 |

### Implementation Phase 2: Bidirectional Search Window Implementation

- GOAL-002: Implement bidirectional search to check both before and after the reference

| Task     | Description                                                                                                                                       | Completed | Date       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-006 | Create new parameter `search_backward_distance` (default: 500 chars) to control how far backward to search                                       | ✅        | 2026-01-26 |
| TASK-007 | Modify search window calculation to include backward region: `search_start_backward = max(0, ref_position - search_backward_distance)`           | ✅        | 2026-01-26 |
| TASK-008 | Update search to run phrase matching in BOTH regions: backward (ref_pos - 500 to ref_pos) and forward (ref_pos + ref_length to ref_pos + 6000) | ✅        | 2026-01-26 |
| TASK-009 | Collect phrase matches from both regions into separate lists: `backward_matches` and `forward_matches`                                           | ✅        | 2026-01-26 |
| TASK-010 | Add logic to prefer forward matches: if forward region has significant cluster (3+ matches OR has start+end), use it                             | ✅        | 2026-01-26 |
| TASK-011 | Add fallback: if forward region fails, check backward region for significant cluster                                                             | ✅        | 2026-01-26 |

### Implementation Phase 3: Reference Text Parsing and Skip Logic

- GOAL-003: Correctly identify and skip introductory phrases in references

| Task     | Description                                                                                                                                                                              | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-012 | Create regex patterns to detect common introductory phrases: `r'(says|writes|teaches|tells us)'`, `r'(in|from) [A-Z][a-z]+ \d+'`, `r'Paul writes'`, etc.                               | ✅        | 2026-01-26 |
| TASK-013 | Implement `_extract_reference_intro_length(transcript, ref_position)` function to calculate how much text to skip past the reference                                                    | ✅        | 2026-01-26 |
| TASK-014 | Update `process_text()` to call `_extract_reference_intro_length()` before calling `find_quote_boundaries_improved()`                                                                   | N/A       | 2026-01-26 |
| TASK-015 | Pass the calculated intro length as the `ref_length` parameter to `find_quote_boundaries_improved()`                                                                                    | ✅        | 2026-01-26 |
| TASK-016 | Ensure the forward search starts AFTER the full introductory phrase (e.g., after "Romans 12 one says Paul writes")                                                                      | ✅        | 2026-01-26 |

### Implementation Phase 4: Confidence Scoring Refinement

- GOAL-004: Adjust confidence scoring to account for bidirectional search and proximity to reference

| Task     | Description                                                                                                                                        | Completed | Date       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-017 | Add proximity bonus: if quote starts within 100 chars AFTER reference, increase confidence by 0.05                                                | ✅        | 2026-01-26 |
| TASK-018 | Add direction indicator: if quote is found BEFORE reference (backward search), decrease confidence by 0.10 (less common pattern)                  | ✅        | 2026-01-26 |
| TASK-019 | Update confidence calculation to consider distance from reference: closer = higher confidence                                                     | ✅        | 2026-01-26 |
| TASK-020 | Ensure confidence values remain in 0.0-1.0 range after adjustments                                                                                | ✅        | 2026-01-26 |
| TASK-021 | Add metadata field to QuoteBoundary to track whether quote was found before or after reference (for debugging/analysis) - ONLY if schema permits | N/A       | 2026-01-26 |

### Implementation Phase 5: AST Builder Validation

- GOAL-005: Ensure AST builder correctly maps corrected boundaries to paragraph structure

| Task     | Description                                                                                                                                              | Completed | Date       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-022 | Review `_build_paragraph_children_with_passages()` logic to verify relative position calculations                                                       | ✅        | 2026-01-26 |
| TASK-023 | Add assertions to validate that `quote_start_rel` and `quote_end_rel` are within paragraph bounds                                                       | ✅        | 2026-01-26 |
| TASK-024 | Add logging to show paragraph boundaries and quote positions during AST building                                                                         | ✅        | 2026-01-26 |
| TASK-025 | Test with the problematic transcript to ensure passage nodes are created at correct positions                                                           | ✅        | 2026-01-26 |
| TASK-026 | Verify that text before quote, passage content, and text after quote are all correctly separated into distinct nodes                                    | ✅        | 2026-01-26 |

### Implementation Phase 6: Edge Case Handling

- GOAL-006: Handle edge cases and unusual patterns

| Task     | Description                                                                                                                               | Completed | Date       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-027 | Handle case where reference is at the very start of transcript (no backward search possible)                                              | ✅        | 2026-01-26 |
| TASK-028 | Handle case where reference is at the very end of transcript (no forward search possible)                                                 | ✅        | 2026-01-26 |
| TASK-029 | Handle case where multiple references to the same verse appear (ensure each is matched to its own quote, not duplicated)                 | ✅        | 2026-01-26 |
| TASK-030 | Handle case where speaker mentions verse but doesn't quote it (should return None, not force a match)                                    | ✅        | 2026-01-26 |
| TASK-031 | Add validation to reject matches that are too short (< 10 chars) or too long (> 5000 chars)                                              | ✅        | 2026-01-26 |

### Implementation Phase 7: Testing and Validation

- GOAL-007: Comprehensively test the updated boundary detection system

| Task     | Description                                                                                                           | Completed | Date       |
| -------- | --------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-032 | Create test transcript samples with different reference patterns: before, after, embedded                             | ✅        | 2026-01-26 |
| TASK-033 | Test with the original problematic transcript (Romans 12:1 example)                                                   | ✅        | 2026-01-26 |
| TASK-034 | Test with multiple verses in sequence to ensure each is correctly bounded                                             | ✅        | 2026-01-26 |
| TASK-035 | Test with verses that have interjections to ensure interjection detection still works                                 | ✅        | 2026-01-26 |
| TASK-036 | Test with low-confidence matches to ensure they are still handled appropriately                                       | ✅        | 2026-01-26 |
| TASK-037 | Test with all major translations (KJV, NKJV, NIV, ESV) to ensure cross-translation compatibility                     | ✅        | 2026-01-26 |
| TASK-038 | Run full pipeline (transcribe → detect quotes → build AST → render) on test samples                                  | ✅        | 2026-01-26 |
| TASK-039 | Verify that the generated AST has passage nodes in correct positions with correct content                             | ✅        | 2026-01-26 |
| TASK-040 | Compare confidence scores before and after changes to ensure they remain meaningful and accurate                      | ✅        | 2026-01-26 |

## 3. Alternatives

**Alternative Approaches Considered:**

- **ALT-001**: **Global search across entire transcript** - Search the entire transcript for the best verse match regardless of reference position
  - **Rejected**: Too computationally expensive for large transcripts (10,000+ chars); could match unrelated text far from reference
  
- **ALT-002**: **Machine learning-based boundary detection** - Train a model to predict quote boundaries based on context
  - **Rejected**: Overkill for this problem; requires training data and infrastructure; existing fuzzy matching is sufficient when search window is correct
  
- **ALT-003**: **Speaker diarization to detect quote vs commentary** - Use audio analysis to identify when speaker shifts to "reading mode"
  - **Rejected**: Requires audio input (not available in text-only pipeline); complex to implement; not needed for text-based detection
  
- **ALT-004**: **Rewrite entire detection pipeline with AST-first approach** - Build AST during transcription, detect quotes during parsing
  - **Rejected**: Major architectural change; high risk; current system works well except for this specific search window issue
  
- **ALT-005**: **Use LLM API to identify quote boundaries** - Send transcript chunks to GPT-4 to identify passages
  - **Rejected**: Introduces external API dependency and cost; slower; less predictable than deterministic fuzzy matching

## 4. Dependencies

**Code Dependencies:**
- **DEP-001**: `bible_quote_processor.py` - Contains the boundary detection logic to be modified
- **DEP-002**: `ast_builder.py` - Depends on QuoteBoundary structure and must handle corrected boundaries
- **DEP-003**: `document_model.py` - Defines PassageNode and metadata structures (no changes needed)
- **DEP-004**: `main.py` - Orchestrates the pipeline (may need minor logging additions)

**External Dependencies:**
- **DEP-005**: Bolls.life API - Must remain available for verse text retrieval
- **DEP-006**: Bible verse cache (`bible_verse_cache.json`) - Performance optimization, should not be affected
- **DEP-007**: Python regex module - Used for pattern matching in intro phrase detection

**Data Dependencies:**
- **DEP-008**: Test transcript samples - Need real sermon transcript data for validation
- **DEP-009**: Bible book name variations - Must handle "Romans", "Rom", "1 Corinthians", "1 Cor", etc.

## 5. Files

**Files to Modify:**
- **FILE-001**: `src/python/bible_quote_processor.py` - Main file containing boundary detection logic (lines 1667-1850 approx.)
  - Modify `find_quote_boundaries_improved()` function
  - Add `_extract_reference_intro_length()` helper function
  - Update `process_text()` to pass intro length

- **FILE-002**: `src/python/ast_builder.py` - AST builder that consumes QuoteBoundary objects (lines 235-400 approx.)
  - Add validation assertions in `_build_paragraph_children_with_passages()`
  - Add debug logging for boundary mapping

**Files to Review (may need minor changes):**
- **FILE-003**: `src/python/main.py` - Pipeline orchestration
  - May need to add logging for boundary detection debugging

**Files Not Changed:**
- **FILE-004**: `src/python/document_model.py` - Document model definitions (no changes needed)
- **FILE-005**: `src/python/whisper_bridge.py` - Transcription logic (unaffected)

## 6. Testing

**Unit Tests:**
- **TEST-001**: Test `_extract_reference_intro_length()` with various reference patterns
  - Input: `"Romans 12:1 says..."`, Output: 17 (length including "says")
  - Input: `"Paul writes in Romans 12:1..."`, Output: 29
  - Input: `"Romans 12:1"`, Output: 11 (just the reference)

- **TEST-002**: Test bidirectional phrase matching with mock transcript
  - Mock transcript with quote BEFORE reference - should find backward
  - Mock transcript with quote AFTER reference - should find forward
  - Mock transcript with no quote - should return None

- **TEST-003**: Test confidence scoring adjustments
  - Quote immediately after reference - should get proximity bonus
  - Quote 500 chars before reference - should get direction penalty
  - Quote far from reference - should have lower confidence

**Integration Tests:**
- **TEST-004**: Full pipeline test with problematic Romans 12:1 transcript
  - Verify passage node contains `"I beseech you therefore..."`
  - Verify passage node does NOT contain `"his face."`
  - Verify confidence score is high (>= 0.85)

- **TEST-005**: Full pipeline test with multiple verses
  - Transcript with 3+ different verse references
  - Verify each reference is matched to correct passage
  - Verify no passages are duplicated or overlapped

- **TEST-006**: Full pipeline test with interjections
  - Transcript with `"...a living sacrifice, what? Holy and acceptable..."` pattern
  - Verify interjection is detected within passage
  - Verify passage boundaries include text on both sides of interjection

**Regression Tests:**
- **TEST-007**: Re-run existing test mode transcript (`test_mode_transcript.txt`)
  - Verify all previously working quotes still work
  - Compare AST output before and after changes

- **TEST-008**: Test with multiple translations
  - Same transcript content, test with KJV, NKJV, NIV, ESV
  - Verify detection works consistently across translations

**Manual Validation:**
- **TEST-009**: Process real sermon transcript samples (if available)
  - Check AST in Dev Panel to verify passage positions
  - Review confidence scores for reasonableness
  - Check for false positives (text incorrectly marked as passage)

## 7. Risks & Assumptions

**Risks:**
- **RISK-001**: **Backward search may introduce false positives** - Text before reference might contain similar phrases by coincidence
  - *Mitigation*: Use stricter confidence threshold for backward matches; prefer forward matches when both are available
  
- **RISK-002**: **Performance degradation from bidirectional search** - Searching two regions instead of one could slow processing
  - *Mitigation*: Limit backward search distance to 500 chars; forward search already limited to 6000 chars; total search area is manageable
  
- **RISK-003**: **Introductory phrase detection might misidentify reference boundaries** - Regex patterns may not cover all variations
  - *Mitigation*: Start with common patterns; add more patterns incrementally based on real transcript data; log failures for analysis
  
- **RISK-004**: **Confidence scoring changes might affect quote review workflow** - Users may have learned to trust certain confidence ranges
  - *Mitigation*: Document new confidence scoring behavior; adjust thresholds in UI if needed; maintain general 0.0-1.0 scale
  
- **RISK-005**: **Breaking changes to AST structure** - Incorrect boundary mapping could corrupt document structure
  - *Mitigation*: Add extensive validation in AST builder; test thoroughly before merging; keep debug logging enabled

**Assumptions:**
- **ASSUMPTION-001**: Most sermon transcripts follow pattern of "reference → quote" rather than "quote → reference"
- **ASSUMPTION-002**: Introductory phrases are relatively standardized ("says", "writes", "tells us", etc.)
- **ASSUMPTION-003**: The existing fuzzy matching algorithm is fundamentally sound; only the search window needs adjustment
- **ASSUMPTION-004**: Confidence scores above 0.60 indicate a valid match (current threshold)
- **ASSUMPTION-005**: Test mode transcript is representative of real sermon transcription quality
- **ASSUMPTION-006**: Bolls.life API will remain available and stable during development and testing
- **ASSUMPTION-007**: Existing interjection and commentary detection logic is working correctly

## 8. Related Specifications / Further Reading

**Internal Documentation:**
- [WhisperSermons AI Coding Instructions](/.github/copilot-instructions.md) - Project architecture and patterns
- [Document Model Instructions](/.github/document-model-instructions.md) - AST structure and event sourcing
- Feature Plan: DevTools-Controlled AST Editor (`/plan/feature-devtools-controlled-ast-editor-1.md`)

**External References:**
- [Bolls.life API Documentation](https://bolls.life/) - Bible verse retrieval API
- [Python difflib Documentation](https://docs.python.org/3/library/difflib.html) - Sequence matching algorithms
- [Fuzzy String Matching Techniques](https://en.wikipedia.org/wiki/Approximate_string_matching) - Background on similarity metrics

**Code References:**
- `bible_quote_processor.py` lines 1667-1850: Current boundary detection implementation
- `bible_quote_processor.py` lines 2385-2750: Main processing pipeline
- `ast_builder.py` lines 235-400: AST node construction from boundaries
