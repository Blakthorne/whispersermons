Plan: Fix AST Bible Passage Boundary Alignment
TL;DR: The core issue is a coordinate space mismatch between quote boundaries and the raw text. process_text() in bible_quote_processor.py mutates the transcript text by normalizing Bible references (e.g., "Romans 12 one" → "Romans 12:1") before detecting quote boundaries. The resulting QuoteBoundary.start_pos/end_pos values live in the mutated text's coordinate space. But the AST builder in ast_builder.py slices content from the original raw_text. Every normalized reference that changes length shifts all subsequent boundary positions by the cumulative character difference — causing words to be added/omitted at passage boundaries, punctuation to be missed, and empty nodes to appear.

The fix is to eliminate text mutation from the boundary detection pipeline entirely ("AST-first" principle): detect boundaries on the original text, defer reference normalization to a cosmetic step stored as AST metadata, and never modify the source transcript.

Steps

Phase 1: Eliminate Text Mutation from Boundary Detection
Remove normalize_references_in_text() call from process_text() — In bible_quote_processor.py:3164, the line text = normalize_references_in_text(text, references) mutates the transcript before boundary detection. Delete this line and the subsequent re-detection at bible_quote_processor.py:3167. All of Phase 2 (lines ~3153–3180) becomes unnecessary for boundary purposes.

Keep detect_bible_references() operating on original text — The initial Phase 1 call at bible_quote_processor.py:3148 already operates on original text. After removing the mutation step, Phase 3 (verse fetching) and Phase 4 (boundary detection via find_quote_boundaries_improved()) will also operate in the original text's coordinate space. This is the single most impactful change.

Store normalized reference as metadata, not text replacement — The BibleReference objects already have a to_standard_format() method. Add a normalized_text field to QuoteBoundary (or use the existing reference.to_standard_format()) so the renderer can display the normalized reference without the source text ever being modified. The renderer already handles display formatting.

Update process_text() return value — Currently returns (text, quotes) at bible_quote_processor.py:3579. After removing mutation, text will be identical to the input — confirm this and document it. The function signature and return type remain the same for backward compatibility.

Phase 2: Fix Downstream Consumers of Quote Boundaries
Verify segment_into_paragraph_groups() alignment — In main.py:441, this function receives quote_boundaries to avoid splitting quotes across paragraphs. After the Phase 1 fix, these boundaries will be in the same coordinate space as the sentences (both from original text). Confirm the sentence-boundary overlap checks use start_pos/end_pos correctly.

Verify extract_tags() alignment — In main.py:757, extract_tags uses quote boundaries to exclude Bible text from keyword extraction. The text slicing clean_text[:qb.start_pos] and clean_text[qb.end_pos:] will now be correct since both clean_text and boundary positions reference the original text.

Verify \_split_group_around_passages() alignment — In ast_builder.py:379, this function slices raw_text[current_pos:passage.start_pos] and raw_text[passage.start_pos:passage_end]. After the fix, all positions will be in raw_text coordinates. The comment at ast_builder.py:389 that says "All positions are in raw_text coordinates - no remapping needed" will finally be accurate.

Fix interjection position calculation — In ast_builder.py:484, \_build_passage_node() computes relative interjection positions as rel_start = interj_start - quote.start_pos. If interjection_positions were computed on mutated text, these would also be misaligned. Confirm that interjection_positions on QuoteBoundary objects flow from the same find_quote_boundaries_improved() call and will be corrected by Phase 1.

Phase 3: Clean Up Residual Text Manipulation
Remove the \_pre_normalization_length / \_pre_normalization_text workaround — At bible_quote_processor.py:3172, there's a workaround to stash pre-normalization reference text info. Since normalization no longer happens, these fields (ref.\_pre_normalization_length, ref.\_pre_normalization_text) are unnecessary. Remove them and any code that reads them.

Audit verify_quote_boundaries() — At bible_quote_processor.py:2942, this function adjusts start/end positions post-detection. Ensure it receives and operates on the original transcript text (not any mutated copy). After Phase 1, the text parameter flowing through will be the original, so this should be automatic — but verify explicitly.

Audit validate_start_is_verse_text() and validate_quote_end() — These functions at bible_quote_processor.py:1932 and bible_quote_processor.py:1622 fine-tune boundary positions. They accept a text parameter — confirm they receive the original text after the Phase 1 changes. These are called within find_quote_boundaries_improved() which receives the local text variable from process_text().

Move normalize_references_in_text() to an optional cosmetic post-processing step — Rather than deleting the function entirely, make it available as an optional utility that can be called on the final display text if needed. The AST renderer should handle reference formatting instead, using the normalizedReference field on PassageNode.quoteDetection.

Phase 4: Add Validation and Guards
Add a boundary validation assertion in build_ast() — At the entry point ast_builder.py:509, add validation that every QuoteBoundary.start_pos and end_pos is within [0, len(raw_text)] and that raw_text[start_pos:end_pos] contains non-empty content. Log warnings for any out-of-bounds boundaries rather than silently producing wrong output.

Add a content-match assertion — After extracting passage_content = raw_text[passage.start_pos:passage_end] at ast_builder.py:425, add a debug-mode check that the extracted content has reasonable overlap with quote.verse_text (the expected verse text from the API). This catches coordinate mismatches at the point of impact.

Add end-to-end coordinate consistency test — Create a test in test_ast_passage_boundaries.py that runs the full pipeline (process_text() → tokenize_sentences() → segment_into_paragraph_groups() → build_ast()) on a sample transcript containing references that would change length during normalization (e.g., "Romans 12 one", "Hebrews 725"). Assert that the extracted passage content in the AST matches the expected verse words, not off-by-N garbage.

Phase 5: Harden the "No Text Mutation" Principle
Add an immutability assertion in process_text() — After all processing, assert text == original_input_text (where original_input_text is saved at function entry). This prevents future regressions where someone adds text mutation back into the pipeline.

Update all docstrings and comments — The existing comments in whisper_bridge.py:461 ("We return the original text here because we want subsequent stages to work with the original offsets") and ast_builder.py:389 ("All positions are in raw_text coordinates - no remapping needed") describe the intended behavior that wasn't being achieved. Update them to reflect the actual guarantee.

Document the coordinate contract — Add a clear comment block at the top of process_text() specifying the contract: "All QuoteBoundary.start_pos/end_pos values MUST reference positions in the unmodified input text. No text mutation is permitted during boundary detection."

Verification

Run existing tests: npm run test:run and cd src/python && python -m pytest test_ast_passage_boundaries.py test_passage_isolation.py test_boundary_detection.py test_e2e_pipeline.py -v
The new end-to-end test (Step 15) with normalizable references should pass — previously this would silently produce misaligned boundaries
Process a real sermon with multiple Bible references (especially ones that contain spoken number words like "one" instead of "1") and verify the AST passage nodes contain the correct text with no extra/missing words at boundaries
Enable debug_ast mode and verify the debug logs show correct slicing: Passage (Romans 12:1): 'I beseech you therefore...' rather than off-by-N text
Decisions

Chose Option A (eliminate text mutation) over Option B (position remapping) or Option C (use mutated text everywhere) — Option A is simplest, eliminates the entire class of bugs, and aligns with the codebase's stated-but-not-achieved "immutable text" principle
Reference normalization becomes metadata-only — the renderer already formats references from AST metadata, so normalizing the source text was always cosmetic and caused more harm than good
The normalize_references_in_text() function is preserved but relocated — it remains available if needed for display purposes but is removed from the boundary detection pipeline
