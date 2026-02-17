---
goal: Refactor Pipeline to AST-First Architecture - Eliminate Reconciliation Layer
version: 1.0
date_created: 2026-02-16
last_updated: 2026-02-16
owner: WhisperSermons Development
status: 'Planned'
tags: [refactor, ast, pipeline, bible-passages, paragraph-segmentation, architecture]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Refactor the Python processing pipeline from a "detect everything, then reconcile at the end" architecture to an "AST-first, build incrementally" architecture. The current pipeline maintains three parallel data representations (`List[QuoteBoundary]`, `List[SentenceInfo]`, `List[List[int]]`) that are reconciled in `build_ast()` — a complex and bug-prone process responsible for every major boundary and structural bug to date (~200 lines of reconciliation code). The new pipeline creates an initial AST immediately and refines it at each stage, eliminating the reconciliation layer entirely.

**Key change**: Each processing stage directly mutates the AST instead of producing intermediate data structures that must later be aligned. Passage positions are used exactly once — at the moment of extraction — eliminating all coordinate-space mismatch bugs.

See [Analysis: AST-First Pipeline Refactor.md](Analysis%3A%20AST-First%20Pipeline%20Refactor.md) for the full analysis backing this plan.

## 1. Requirements & Constraints

### Requirements

- **REQ-001**: The AST must be the single evolving data representation throughout the pipeline — no parallel intermediate structures that require later reconciliation
- **REQ-002**: `bible_quote_processor.process_text()` and all boundary detection algorithms must remain completely unchanged
- **REQ-003**: Passage nodes must remain the sole child of their containing paragraph node (structural isolation)
- **REQ-004**: Passage content must be extracted directly from `raw_text` at detection time — no re-extraction or re-mapping
- **REQ-005**: Paragraph segmentation must still use semantic similarity (EmbeddingGemma) for topic-change detection
- **REQ-006**: Prayer detection must continue to work (break before prayer start, after Amen)
- **REQ-007**: Tag extraction must produce identical results (excluding passage text from analysis)
- **REQ-008**: The `DocumentState` output schema must remain identical — no changes to `document_model.py` types or `documentModel.ts`
- **REQ-009**: `ASTBuilderResult` return type and `ProcessingMetadata` must remain the same
- **REQ-010**: All metadata (confidence, translation, interjections, references) must be preserved on passage nodes

### Constraints

- **CON-001**: No changes to `bible_quote_processor.py` (3,900+ lines) — it stays untouched
- **CON-002**: No changes to `document_model.py` types — only factory functions are consumed, not modified
- **CON-003**: No changes to `src/shared/documentModel.ts` or renderer code — the AST output schema is identical
- **CON-004**: No changes to `src/preload/index.ts` or IPC contracts
- **CON-005**: Performance must not degrade; embedding computation dominates latency, not AST construction
- **CON-006**: Must maintain backward compatibility with `whisper_bridge.py` `process_sermon()` return format

### Guidelines

- **GUD-001**: Process passages in reverse order (by `start_pos`) to avoid index shifting when splitting paragraph nodes
- **GUD-002**: Maintain comprehensive debug logging with `debug=True` flag throughout new functions
- **GUD-003**: Keep clean separation between detection (`process_text()`) and AST modification (new functions)
- **GUD-004**: All new functions should have clear docstrings documenting inputs, outputs, and invariants
- **GUD-005**: Prefer explicit node splitting over in-place mutation — create new nodes, replace old ones in children list

### Patterns

- **PAT-001**: Use existing `document_model.py` factory functions (`create_text_node()`, `create_paragraph_node()`, `create_passage_node()`, `create_document_root()`) for all node creation
- **PAT-002**: Reuse `ASTBuilder._build_passage_node()` and `_verify_content_match()` for passage node construction
- **PAT-003**: Follow the existing test pattern: custom `main()` runner with assertions and print-based output (matching `test_ast_passage_boundaries.py`, `test_passage_isolation.py`, etc.)

## 2. Implementation Steps

### Phase 1: Create `apply_passages_to_ast()` Function

- GOAL-001: Implement the core function that takes an initial flat AST and splits it around detected passages, creating isolated passage paragraph nodes

| Task     | Description                                                                                                                                                                                                                                                                             | Completed | Date |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-001 | Create new function `apply_passages_to_ast(root, raw_text, quote_boundaries, debug)` in `ast_builder.py` that accepts a `DocumentRootNode` (containing one `ParagraphNode` → one `TextNode(raw_text)`), filters passages by confidence, and processes them in reverse `start_pos` order |           |      |
| TASK-002 | For each passage: locate the `ParagraphNode` + `TextNode` containing the passage's character range, then split into up to 3 new `ParagraphNode`s: text-before (if non-empty), passage (sole child, using `_build_passage_node()`), text-after (if non-empty)                            |           |      |
| TASK-003 | Replace the original `ParagraphNode` in `root.children` with the 1–3 new nodes, adjusting the children list in place                                                                                                                                                                    |           |      |
| TASK-004 | Handle edge case: multiple passages within the same `ParagraphNode` (after a previous passage split, subsequent passages may land in a text-after node) — iterate correctly after each split                                                                                            |           |      |
| TASK-005 | Handle edge case: passage at the very start or very end of a text block — ensure no empty `TextNode`s or empty `ParagraphNode`s are created                                                                                                                                             |           |      |
| TASK-006 | Handle edge case: adjacent passages with no text between them — produce two passage paragraphs with no intervening text paragraph                                                                                                                                                       |           |      |
| TASK-007 | Add debug logging: for each passage, log reference, start_pos, end_pos, extracted content preview, and the node it was found in                                                                                                                                                         |           |      |
| TASK-008 | Reuse `_verify_content_match()` to validate passage content against verse text in debug mode                                                                                                                                                                                            |           |      |

### Phase 2: Create `segment_ast_paragraphs()` Function

- GOAL-002: Implement paragraph segmentation that operates directly on text-only `ParagraphNode`s in the AST, splitting them based on semantic similarity

| Task     | Description                                                                                                                                                                                                                                                 | Completed | Date |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-009 | Create new function `segment_ast_paragraphs(root, similarity_threshold, min_sentences, window_size, debug)` in `ast_builder.py` (or a new `ast_segmentation.py` module)                                                                                     |           |      |
| TASK-010 | Walk `root.children`, identify text-only `ParagraphNode`s (those whose children contain only `TextNode`s, not `PassageNode`s) — skip passage paragraphs entirely                                                                                            |           |      |
| TASK-011 | For each text-only paragraph: extract concatenated text content, call `tokenize_sentences()` to get `SentenceInfo` list, then run the semantic similarity + break-point logic (embedding, cosine similarity, smoothing, threshold comparison)               |           |      |
| TASK-012 | Port the prayer detection logic from `segment_into_paragraph_groups()` into `segment_ast_paragraphs()`: detect `PRAYER_START_PATTERNS` and `AMEN_END_PATTERN` within each text block, force breaks before prayer starts and after Amen sentences            |           |      |
| TASK-013 | When breaks are found, split the single `ParagraphNode` into multiple `ParagraphNode`s, each containing a `TextNode` with the appropriate sentence range's text. Replace the original in `root.children`                                                    |           |      |
| TASK-014 | For text blocks shorter than `min_sentences`, skip segmentation (keep as single paragraph)                                                                                                                                                                  |           |      |
| TASK-015 | Remove the quote-aware "don't break inside quotes" logic (`sentences_in_quotes`, `quote_ranges` building, and the guard in `segment_into_paragraph_groups()`) — this is no longer needed because passages are already isolated in their own paragraph nodes |           |      |
| TASK-016 | Add debug logging: for each text-only paragraph, log sentence count, break points found, resulting paragraph count                                                                                                                                          |           |      |

### Phase 3: Create `extract_tags_from_ast()` Function

- GOAL-003: Implement tag extraction that walks AST `TextNode`s, skipping `PassageNode`s, instead of using raw text + boundary exclusion

| Task     | Description                                                                                                                                                                                            | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-017 | Create new function `extract_tags_from_ast(root, max_tags, verbose, semantic_threshold)` in `main.py` that walks `root.children`, collecting text content from `TextNode`s and skipping `PassageNode`s |           |      |
| TASK-018 | Concatenate collected text (with space separator), pass to existing `get_semantic_themes()` for embedding-based tag inference                                                                          |           |      |
| TASK-019 | Ensure identical output to current `extract_tags()` — same tag format, same ordering, same `max_tags` behavior                                                                                         |           |      |

### Phase 4: Rewrite `build_ast()` Orchestration

- GOAL-004: Replace the current multi-stage reconciliation `build_ast()` with a clean 3-step pipeline: create initial AST → apply passages → segment paragraphs

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                              | Completed | Date |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-020 | Rewrite `ASTBuilder.build()` (or create a new `build_ast_v2()`) to follow the new pipeline: (1) create initial AST with `create_document_root()` containing one `ParagraphNode` → one `TextNode(raw_text)`, (2) call `apply_passages_to_ast()`, (3) call `segment_ast_paragraphs()`, (4) extract references from passage nodes, (5) create `DocumentState` and return `ASTBuilderResult` |           |      |
| TASK-021 | Update the `build_ast()` convenience function signature: it no longer needs `sentences` or `paragraph_groups` parameters — it only needs `raw_text`, `quote_boundaries`, `title`, `bible_passage`, `speaker`, `tags`, `debug`                                                                                                                                                            |           |      |
| TASK-022 | Remove eliminated methods: `_map_passages_to_groups()`, `_enforce_single_paragraph_passages()`, `_split_group_around_passages()`, `_build_paragraph_nodes()`                                                                                                                                                                                                                             |           |      |
| TASK-023 | Keep and potentially refactor `_build_passage_node()`, `_verify_content_match()`, `_filter_passages()`, `_extract_references()` as standalone functions or methods on a simplified `ASTBuilder`                                                                                                                                                                                          |           |      |
| TASK-024 | Maintain `ProcessingMetadata` timing with `_start_stage()` / `_end_stage()` for the new stages                                                                                                                                                                                                                                                                                           |           |      |

### Phase 5: Update Pipeline Orchestration

- GOAL-005: Update `whisper_bridge.py` and `main.py` CLI to use the new pipeline order

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                         | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-025 | Update `process_sermon()` in `whisper_bridge.py`: remove `segment_paragraphs()` call (Stage 4) and `extract_tags()` call (Stage 5) — these now happen inside `build_ast()` or as AST-based operations                                                                                                                                                                                                               |           |      |
| TASK-026 | Update `process_sermon()` Stage 6 (`build_ast()` call): pass simplified arguments (no `sentences`, no `paragraph_groups`). Tags can still be extracted separately and passed to `build_ast()`, OR be extracted from the AST after construction                                                                                                                                                                      |           |      |
| TASK-027 | Decide on tag extraction ordering: Option A — extract tags from raw text before AST (current approach works, just exclude passages via boundaries); Option B — extract tags from AST after construction (new `extract_tags_from_ast()`). Both are valid; Option A requires no change to tag extraction. Recommend Option A for minimal disruption, with `extract_tags_from_ast()` available as a future improvement |           |      |
| TASK-028 | Update `main.py` `__main__` block (CLI entrypoint, ~L870-L995) to follow the same new pipeline order                                                                                                                                                                                                                                                                                                                |           |      |
| TASK-029 | Update `segment_paragraphs()` in `whisper_bridge.py` — either remove it or convert it to a thin wrapper that's no longer needed                                                                                                                                                                                                                                                                                     |           |      |
| TASK-030 | Remove the import of `SentenceInfo` from `ast_builder.py` (it's no longer needed at the AST builder level — sentence tokenization is internal to `segment_ast_paragraphs()`)                                                                                                                                                                                                                                        |           |      |

### Phase 6: Clean Up `segment_into_paragraph_groups()`

- GOAL-006: Simplify or deprecate the standalone `segment_into_paragraph_groups()` function in `main.py`

| Task     | Description                                                                                                                                                                                          | Completed | Date |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-031 | Determine if `segment_into_paragraph_groups()` is still called from anywhere other than `whisper_bridge.py` and `main.py` CLI. If not, mark it as deprecated or remove it                            |           |      |
| TASK-032 | If kept for backward compatibility, remove the quote-aware logic (~30 lines: `sentences_in_quotes`, `quote_ranges` building, don't-break-inside-quotes guard) since this is no longer needed         |           |      |
| TASK-033 | Extract the core segmentation logic (embedding computation, similarity calculation, smoothing, break-point detection, prayer detection) into a reusable helper that `segment_ast_paragraphs()` calls |           |      |

### Phase 7: Testing — Unit Tests

- GOAL-007: Comprehensive unit test coverage for all new functions

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-034 | Create `test_ast_first_pipeline.py` — new test file for the AST-first refactor                                                                                                                                                                                                                                                                                             |           |      |
| TASK-035 | **TEST: Initial AST creation** — verify `create_document_root()` with one `ParagraphNode` → one `TextNode(raw_text)` produces correct structure                                                                                                                                                                                                                            |           |      |
| TASK-036 | **TEST: Single passage application** — create a `QuoteBoundary` at known positions in a text, call `apply_passages_to_ast()`, verify: (a) 3 paragraph nodes created (text-before, passage, text-after), (b) passage node is sole child of its paragraph, (c) passage content matches `raw_text[start_pos:end_pos]`, (d) text-before and text-after contain correct content |           |      |
| TASK-037 | **TEST: Multiple passages application** — create 2-3 `QuoteBoundary` objects, verify all are correctly isolated in their own paragraphs with correct text between them                                                                                                                                                                                                     |           |      |
| TASK-038 | **TEST: Passage at text start** — passage starts at position 0, verify only 2 nodes created (passage, text-after), no empty text-before paragraph                                                                                                                                                                                                                          |           |      |
| TASK-039 | **TEST: Passage at text end** — passage ends at `len(raw_text)`, verify only 2 nodes created (text-before, passage), no empty text-after paragraph                                                                                                                                                                                                                         |           |      |
| TASK-040 | **TEST: Adjacent passages** — two passages with no text between them, verify 2 passage paragraphs with no empty text paragraph between them                                                                                                                                                                                                                                |           |      |
| TASK-041 | **TEST: Passage with interjections** — verify `_build_passage_node()` correctly creates `InterjectionNode`s within the passage, preserving interjection metadata                                                                                                                                                                                                           |           |      |
| TASK-042 | **TEST: Passage content verification** — verify `_verify_content_match()` correctly validates passage content against verse text                                                                                                                                                                                                                                           |           |      |
| TASK-043 | **TEST: Reverse-order processing** — verify that processing passages in reverse `start_pos` order avoids index corruption (create 3 passages and verify all 3 are correct)                                                                                                                                                                                                 |           |      |

### Phase 8: Testing — Paragraph Segmentation Tests

- GOAL-008: Verify paragraph segmentation works correctly on text-only AST nodes

| Task     | Description                                                                                                                                                                                              | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-044 | **TEST: Text block segmentation** — create a text-only paragraph with 20+ sentences spanning 2-3 topics, run `segment_ast_paragraphs()`, verify it produces multiple paragraphs at semantic break points |           |      |
| TASK-045 | **TEST: Short text block skipped** — text block with fewer than `min_sentences` sentences is not split                                                                                                   |           |      |
| TASK-046 | **TEST: Passage paragraphs skipped** — verify `segment_ast_paragraphs()` does not attempt to split passage-containing paragraphs                                                                         |           |      |
| TASK-047 | **TEST: Prayer detection preserved** — text block containing a prayer ("Father God, we thank you... Amen.") gets paragraph breaks before prayer start and after Amen                                     |           |      |
| TASK-048 | **TEST: Mixed structure** — AST with text → passage → text → passage → text, verify segmentation only touches text paragraphs, leaving passages and their ordering intact                                |           |      |

### Phase 9: Testing — Integration and End-to-End Tests

- GOAL-009: Full pipeline integration tests verifying end-to-end correctness

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                       | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-049 | **TEST: Full pipeline with Romans 12:1** — use the `test_mode_transcript.txt` (or equivalent real transcript), run new `build_ast()`, verify: (a) passage node exists for Romans 12:1, (b) passage content starts with "I beseech" (not intro text), (c) passage content includes "reasonable service", (d) passage is sole child of its paragraph, (e) text-before contains the spoken reference |           |      |
| TASK-050 | **TEST: Full pipeline produces valid DocumentState** — run new `build_ast()`, verify returned `ASTBuilderResult` has valid `DocumentState` with correct `root`, `node_index`, `passage_index`, and serializes correctly via `to_dict()`                                                                                                                                                           |           |      |
| TASK-051 | **TEST: Output parity with old pipeline** — for a known transcript, run both old and new pipelines, verify: (a) same number of passage nodes, (b) same passage references, (c) same passage content (or improved content), (d) same tags, (e) comparable paragraph count (±20% acceptable due to improved segmentation)                                                                           |           |      |
| TASK-052 | **TEST: No empty nodes** — after full pipeline, walk entire AST and verify no `TextNode` has empty content, no `ParagraphNode` has zero children                                                                                                                                                                                                                                                  |           |      |
| TASK-053 | **TEST: Content completeness** — concatenate all `TextNode` content and `PassageNode` content from the AST, verify it accounts for all of `raw_text` (no text lost during splitting)                                                                                                                                                                                                              |           |      |
| TASK-054 | **TEST: Multiple passages in transcript** — use or create a transcript with 3+ Bible passages, verify all are correctly detected, isolated, and that text between them is correctly segmented                                                                                                                                                                                                     |           |      |
| TASK-055 | **TEST: Transcript with no passages** — verify the pipeline still produces correct paragraph segmentation when no Bible quotes are detected                                                                                                                                                                                                                                                       |           |      |
| TASK-056 | **TEST: Tag extraction parity** — compare tags from `extract_tags()` (old) vs `extract_tags_from_ast()` (new) on same transcript, verify identical or equivalent results                                                                                                                                                                                                                          |           |      |
| TASK-057 | **TEST: ProcessingMetadata accuracy** — verify `ProcessingMetadata` reports correct `passage_count`, `paragraph_count`, `interjection_count`, and `stage_times`                                                                                                                                                                                                                                   |           |      |

### Phase 10: Testing — Regression and Edge Cases

- GOAL-010: Ensure no regressions from the refactor and cover edge cases

| Task     | Description                                                                                                                                                                                                                                        | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-058 | Run all existing tests (`test_ast_passage_boundaries.py`, `test_boundary_detection.py`, `test_e2e_pipeline.py`, `test_passage_isolation.py`, `test_tag_extraction.py`) and update any that call the old `build_ast()` signature to use the new one |           |      |
| TASK-059 | **TEST: Coordinate immutability** — verify that `raw_text` is never modified during pipeline processing, and that all character positions in `QuoteBoundary` objects remain valid throughout                                                       |           |      |
| TASK-060 | **TEST: Large transcript performance** — time the new pipeline on a 10,000+ word transcript, verify it completes within acceptable bounds (< 20% slower than old pipeline, excluding embedding time)                                               |           |      |
| TASK-061 | **TEST: TipTap compatibility** — verify the AST output produces valid TipTap JSON when converted (passages as sole paragraph children, text nodes with correct content)                                                                            |           |      |
| TASK-062 | **TEST: whisper_bridge.py integration** — call `process_sermon()` with `skip_transcription=True` (test mode), verify the full result dict has correct `documentState`, `tags`, `references`, `body`                                                |           |      |
| TASK-063 | Manually test with the Dev AST panel in the Electron app to verify passage structure and paragraph breaks render correctly                                                                                                                         |           |      |

### Phase 11: Cleanup and Documentation

- GOAL-011: Remove dead code, update documentation, finalize

| Task     | Description                                                                                  | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-064 | Remove dead code: eliminated methods from `ASTBuilder`, unused imports, deprecated functions |           |      |
| TASK-065 | Update code comments in `ast_builder.py` explaining the new pipeline flow                    |           |      |
| TASK-066 | Update `.github/document-model-instructions.md` to reflect the new pipeline architecture     |           |      |
| TASK-067 | Update `.github/copilot-instructions.md` if pipeline description needs updating              |           |      |
| TASK-068 | Update `CHANGELOG.md` with refactor details                                                  |           |      |

## 3. Alternatives

- **ALT-001**: Keep `segment_into_paragraph_groups()` as a standalone function and only refactor AST building
  - Rejected: The quote-aware logic in `segment_into_paragraph_groups()` is tightly coupled to the reconciliation approach; keeping it adds unnecessary complexity and maintains the don't-break-inside-quotes logic that becomes redundant
- **ALT-002**: Create new modules (`ast_passage_applier.py`, `ast_segmenter.py`) instead of modifying `ast_builder.py`
  - Rejected: The new functions are tightly related to AST building and should live alongside `_build_passage_node()` and other reused methods. A single module keeps the build pipeline cohesive

- **ALT-003**: Use a two-pass approach (build full AST with old pipeline, then restructure)
  - Rejected: Defeats the purpose of the refactor — avoids the reconciliation layer rather than building on top of it

- **ALT-004**: Keep tag extraction unchanged (raw text + boundary exclusion) instead of creating `extract_tags_from_ast()`
  - Accepted as fallback: The current `extract_tags()` already works correctly. `extract_tags_from_ast()` is a nice-to-have improvement but not required for the core refactor. Implement both, prefer AST-based extraction going forward

## 4. Dependencies

- **DEP-001**: `bible_quote_processor.py` — provides `QuoteBoundary` objects (unchanged)
- **DEP-002**: `document_model.py` — provides node types and factory functions (unchanged)
- **DEP-003**: `main.py` — provides `tokenize_sentences()` and `PRAYER_START_PATTERNS` / `AMEN_END_PATTERN` (reused)
- **DEP-004**: `embedding_model.py` — provides `encode_texts()` for semantic similarity (unchanged)
- **DEP-005**: No new external Python packages required

## 5. Files

- **FILE-001**: `src/python/ast_builder.py` — Primary file: rewrite `build()`, add `apply_passages_to_ast()`, add `segment_ast_paragraphs()`, remove 4 eliminated methods
- **FILE-002**: `src/python/whisper_bridge.py` — Update `process_sermon()` pipeline orchestration, simplify stage ordering
- **FILE-003**: `src/python/main.py` — Add `extract_tags_from_ast()`, simplify or deprecate `segment_into_paragraph_groups()`, update CLI entrypoint
- **FILE-004**: `src/python/test_ast_first_pipeline.py` — New comprehensive test file (TASK-034 through TASK-063)
- **FILE-005**: `src/python/test_ast_passage_boundaries.py` — Update to new `build_ast()` signature
- **FILE-006**: `src/python/test_e2e_pipeline.py` — Update to new pipeline flow
- **FILE-007**: `src/python/test_passage_isolation.py` — Update to new pipeline flow
- **FILE-008**: `.github/document-model-instructions.md` — Update pipeline documentation
- **FILE-009**: `CHANGELOG.md` — Document refactor

## 6. Testing

### Unit Tests (Phase 7)

- **TEST-001**: Initial AST creation validity (TASK-035)
- **TEST-002**: Single passage application — 3-node split (TASK-036)
- **TEST-003**: Multiple passages application (TASK-037)
- **TEST-004**: Passage at text start — no empty text-before (TASK-038)
- **TEST-005**: Passage at text end — no empty text-after (TASK-039)
- **TEST-006**: Adjacent passages — no empty separator (TASK-040)
- **TEST-007**: Passage with interjections preserved (TASK-041)
- **TEST-008**: Passage content verification against verse text (TASK-042)
- **TEST-009**: Reverse-order processing correctness (TASK-043)

### Segmentation Tests (Phase 8)

- **TEST-010**: Text block generates multiple paragraphs at topic changes (TASK-044)
- **TEST-011**: Short text blocks are not split (TASK-045)
- **TEST-012**: Passage paragraphs are never split (TASK-046)
- **TEST-013**: Prayer detection produces correct breaks (TASK-047)
- **TEST-014**: Mixed text/passage structure preserved during segmentation (TASK-048)

### Integration Tests (Phase 9)

- **TEST-015**: Full pipeline with Romans 12:1 transcript (TASK-049)
- **TEST-016**: Valid DocumentState produced (TASK-050)
- **TEST-017**: Output parity with old pipeline (TASK-051)
- **TEST-018**: No empty nodes in output AST (TASK-052)
- **TEST-019**: Content completeness — no text lost (TASK-053)
- **TEST-020**: Multiple passages in single transcript (TASK-054)
- **TEST-021**: Transcript with no passages (TASK-055)
- **TEST-022**: Tag extraction parity (TASK-056)
- **TEST-023**: ProcessingMetadata accuracy (TASK-057)

### Regression Tests (Phase 10)

- **TEST-024**: Existing test suite passes with updated signatures (TASK-058)
- **TEST-025**: Coordinate immutability verified (TASK-059)
- **TEST-026**: Performance benchmark on large transcript (TASK-060)
- **TEST-027**: TipTap JSON compatibility (TASK-061)
- **TEST-028**: whisper_bridge `process_sermon()` integration (TASK-062)
- **TEST-029**: Manual Dev AST panel verification (TASK-063)

## 7. Risks & Assumptions

### Risks

- **RISK-001**: Paragraph segmentation quality may differ on smaller text blocks (text between passages)
  - Mitigation: Text blocks shorter than `min_sentences` are kept as single paragraphs; passages are natural topic breaks anyway

- **RISK-002**: Prayer detection may behave differently when operating on individual text blocks vs. the full transcript
  - Mitigation: Prayer patterns ("Father God, we thank you...") and Amen endings are localized — they don't depend on global context. Test with real transcripts containing prayers (TASK-047)

- **RISK-003**: AST node splitting could produce unexpected results with edge-case boundary positions (e.g., boundary at whitespace, boundary mid-word)
  - Mitigation: Use `.strip()` on text-before and text-after content; validate no empty nodes; add comprehensive edge-case tests (TASK-038 through TASK-040)

- **RISK-004**: Existing tests depend on old `build_ast()` signature with `sentences` and `paragraph_groups` parameters
  - Mitigation: Update all existing test files in Phase 10 (TASK-058); keep old function available temporarily if needed during transition

- **RISK-005**: The `segment_into_paragraph_groups()` function may be used by other code paths not identified during analysis
  - Mitigation: Search all callers before removal (TASK-031); deprecate before removing

### Assumptions

- **ASSUMPTION-001**: Passages are always valid character ranges within `raw_text` (enforced by `bible_quote_processor.py`)
- **ASSUMPTION-002**: The initial AST is always a flat structure (one `DocumentRootNode` → one `ParagraphNode` → one `TextNode`) — no pre-existing structure to preserve
- **ASSUMPTION-003**: Passage boundaries never overlap (enforced by `_filter_passages()` and `process_text()` deduplication)
- **ASSUMPTION-004**: Text between passages is typically substantial enough for meaningful semantic segmentation (validated by the `min_sentences` guard)
- **ASSUMPTION-005**: `tokenize_sentences()` produces identical results whether run on the full `raw_text` or on individual text blocks — sentence tokenization is context-independent

## 8. Related Specifications / Further Reading

- [Analysis: AST-First Pipeline Refactor.md](Analysis%3A%20AST-First%20Pipeline%20Refactor.md) — Full analysis backing this plan
- [refactor-ast-passage-boundary-fix-1.md](refactor-ast-passage-boundary-fix-1.md) — Previous boundary mapping fix (problems this refactor eliminates)
- [refactor-passage-structure-isolation-1.md](refactor-passage-structure-isolation-1.md) — Structural isolation requirements (fulfilled by this refactor)
- [refactor-passage-boundary-detection-1.md](refactor-passage-boundary-detection-1.md) — Boundary detection improvements (orthogonal, unchanged)
- [.github/document-model-instructions.md](../.github/document-model-instructions.md) — Document model architecture
- [.github/copilot-instructions.md](../.github/copilot-instructions.md) — Project coding instructions
