## Analysis: AST-First Pipeline Refactor

### Verdict: **Yes, this change would be beneficial.** Your instinct is correct.

After a thorough review of all 4 core Python modules (3,900+ lines in bible_quote_processor.py, 995 lines in main.py, 602 lines in ast_builder.py, 773 lines in document_model.py), the orchestrator (whisper_bridge.py), the 7 plan documents, and the investigation report, here is my full analysis.

---

### The Core Problem You've Identified

The current pipeline maintains **three parallel data representations** that all reference positions in `raw_text` and must be reconciled at the very end in `build_ast()`:

| Data structure        | Created at                             | Contains                        | Source of truth for    |
| --------------------- | -------------------------------------- | ------------------------------- | ---------------------- |
| `List[QuoteBoundary]` | Step 2 (process_text)                  | Character positions of passages | Where Bible quotes are |
| `List[SentenceInfo]`  | Step 3 (tokenize_sentences)            | Sentence boundaries             | Sentence segmentation  |
| `List[List[int]]`     | Step 3 (segment_into_paragraph_groups) | Sentence index groups           | Paragraph breaks       |

The AST builder then has to **reconcile all three** in a complex reconciliation dance:

1. `_map_passages_to_groups()` — Map passage character positions to paragraph sentence-index groups
2. `_enforce_single_paragraph_passages()` — Merge groups when passages span multiple
3. `_split_group_around_passages()` — Split paragraphs into text-before / passage / text-after

This reconciliation layer is **exactly where every major bug has occurred**:

- **Coordinate space mismatches** (fix-ast-bible-passage-boundary-alignment.md)
- **Wrong passage-to-paragraph mapping** (refactor-ast-passage-boundary-fix-1.md)
- **Passage structural isolation failures** (refactor-passage-structure-isolation-1.md)

Your proposal eliminates this reconciliation layer entirely.

---

### What Would Be Eliminated

These functions / code blocks would be **removed or drastically simplified**:

| Code                                                   | Lines             | Why eliminated                              |
| ------------------------------------------------------ | ----------------- | ------------------------------------------- |
| `ASTBuilder._map_passages_to_groups()`                 | ast_builder.py    | Passages already in AST; no mapping needed  |
| `ASTBuilder._enforce_single_paragraph_passages()`      | ast_builder.py    | Passages already isolated in own paragraphs |
| `ASTBuilder._split_group_around_passages()`            | ast_builder.py    | Splitting done during passage application   |
| Quote-aware logic in `segment_into_paragraph_groups()` | main.py ~30 lines | Passages already removed from text blocks   |
| `quote_ranges` building loop                           | main.py           | Not needed                                  |

That's ~200 lines of the most complex, bug-prone code in the pipeline.

---

### What Would Stay Unchanged

- `process_text()` in bible_quote_processor.py — still detects boundaries, still returns `(text, List[QuoteBoundary])`, still never mutates text
- `find_quote_boundaries_improved()` — the boundary detection algorithm itself is unchanged
- `detect_interjections()`, `detect_commentary_blocks()` — unchanged
- `extract_tags()` — stays but gets simpler (just walk TextNodes, skip PassageNodes)
- `tokenize_sentences()` — still needed for paragraph segmentation
- Semantic similarity analysis — still needed for paragraph break detection
- The EmbeddingGemma model — still used for segmentation and tags

---

### What Would Be Added

Two new functions (relatively simple):

**1. `apply_passages_to_ast(root, raw_text, quote_boundaries)`**

- Takes the initial AST (one big ParagraphNode) and the detected passages
- For each passage (processed in **reverse** order to avoid offset drift):
  - Find the ParagraphNode + TextNode containing that position
  - Split into up to 3 new ParagraphNodes: text-before, passage (isolated), text-after
  - PassageNode creation with interjections happens here (reuses `_build_passage_node()` logic)

**2. `segment_ast_paragraphs(root, similarity_threshold, min_sentences)`**

- Walks all text-only ParagraphNodes
- For each one: tokenize its content → compute embeddings → find break points → split into multiple ParagraphNodes
- Prayer detection still works within each text block
- No need for "don't split inside quotes" — quotes are already separated

---

### Why It Fixes Passage Creation Issues

The current bugs with passage nodes not getting created correctly come from the **indirect mapping** between QuoteBoundary positions and paragraph groups. Consider what happens now:

1. A passage is detected at positions `[5000, 5500]` in raw_text
2. Sentences are tokenized: sentence 47 covers `[4980, 5020]`, sentence 48 covers `[5021, 5100]`, etc.
3. Paragraph groups are computed: sentences 40-55 are group 3
4. `_map_passages_to_groups()` must determine that the passage belongs to group 3
5. `_split_group_around_passages()` must slice `raw_text[group_start:passage.start_pos]` for the text-before, etc.

Any imprecision in step 4 or 5 produces the wrong content in the AST. With AST-first:

1. A passage is detected at positions `[5000, 5500]` in raw_text
2. `apply_passages_to_ast()` directly slices `raw_text[5000:5500]` into a PassageNode
3. Done — no mapping, no reconciliation

The passage content is extracted **once**, at the moment of detection, directly from the raw text. There's no later re-extraction or re-mapping step where things can go wrong.

---

### Risks and Mitigations

| Risk                                                  | Assessment                                                                                                   | Mitigation                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Paragraph segmentation quality on smaller text blocks | **Low** — passages are natural topic breaks anyway; text between passages is typically substantial           | Test with real sermons; fall back to no-split for blocks shorter than `min_sentences` |
| AST mutation complexity                               | **Low** — the tree structure is very simple at this stage (flat list of ParagraphNodes)                      | Process passages in reverse order to avoid index shifting                             |
| `process_text()` coupling to document model           | **None** — `process_text()` stays decoupled; a new wrapper function applies its results to the AST           | Keep clean separation between detection and AST modification                          |
| Introducing sentence tokenization differences         | **Low** — sentences within each text block are independent; boundaries between blocks are passage boundaries | Verify that prayer detection still spans correctly                                    |

---

### Proposed Pipeline

```
CURRENT PIPELINE                          PROPOSED PIPELINE
────────────────                          ─────────────────

1. Transcribe → raw_text                  1. Transcribe → raw_text

                                          2. Create Initial AST
                                             DocumentRoot
                                               └─ ParagraphNode
                                                    └─ TextNode(raw_text)

2. process_text() → QuoteBoundary[]       3. process_text() → QuoteBoundary[]
                                             apply_passages_to_ast(ast, boundaries)
                                             → AST now has passages isolated in
                                               their own paragraph nodes

3. tokenize_sentences() → SentenceInfo[]  4. segment_ast_paragraphs(ast)
   segment_into_paragraph_groups()           For each text-only ParagraphNode:
     → List[List[int]]                        tokenize → embed → find breaks → split
   (with quote-aware don't-split logic)      (no quote-awareness needed)
   (with prayer detection)                   (prayer detection still works)

4. extract_tags(raw_text, boundaries)     5. extract_tags_from_ast(ast)
                                             Collect TextNode content, skip passages
                                             → tags stored on DocumentRoot

5. build_ast(raw_text, sentences,         6. Finalize AST
     paragraph_groups, boundaries)           (already built — just extract references
   → ASTBuilderResult                        from PassageNodes and create DocumentState)
```

**Key difference**: Steps 3-5 in the current pipeline produce intermediate data structures. Step 5 reconciles them. In the proposed pipeline, each step directly modifies the AST, and there is no reconciliation step.

---

### What Becomes Unnecessary

Looking at the current `ASTBuilder` class (602 lines), almost all its complexity becomes unnecessary:

- `_map_passages_to_groups()` — **gone** (passages are already in the AST)
- `_enforce_single_paragraph_passages()` — **gone** (passage paragraphs are created directly)
- `_split_group_around_passages()` — **gone** (splitting done during passage application)
- `_build_paragraph_nodes()` — **drastically simplified** (just wraps existing text in paragraph nodes)
- The `build()` orchestration method — **simplified** (no more multi-stage reconciliation)

The `_build_passage_node()` method and `_verify_content_match()` would be **reused** in the new `apply_passages_to_ast()` function.

---

### Summary

| Criterion                                         | Current                                               | Proposed                                               |
| ------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Intermediate data structures to reconcile         | 3 (QuoteBoundary[], SentenceInfo[], List[List[int]])  | 0 (AST is the single evolving representation)          |
| Lines of reconciliation code                      | ~200                                                  | 0                                                      |
| Points where passage positions are re-interpreted | 3 (mapping, enforcement, splitting)                   | 1 (passage application)                                |
| Risk of coordinate space mismatch                 | Medium (despite immutability contract)                | Near zero (coordinates used once, at extraction)       |
| Paragraph segmentation needing quote awareness    | Yes (30+ lines of special-case logic)                 | No                                                     |
| Conceptual complexity                             | High — "detect everything, then reconcile at the end" | Low — "build incrementally, each step refines the AST" |

**Recommendation**: Implement this change. It eliminates the most bug-prone code in the pipeline, aligns with the document model's design intent (AST as source of truth), and would fix the structural issues that have required multiple rounds of fixes. The `bible_quote_processor` stays untouched, the boundary detection algorithms stay untouched, and only the "how results get into the AST" layer changes.
