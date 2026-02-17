---
goal: Fix Interjection/Commentary Detection Gaps in Bible Passage Processing
version: 1.0
date_created: 2026-02-16
last_updated: 2026-02-16
owner: WhisperSermons Development
status: 'Planned'
tags: [bug, python, bible-detection, interjection, commentary, passage-processing]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Fix four bugs in the Bible passage interjection/commentary detection system where speaker commentary within quoted passages is not correctly identified. The bugs manifest when processing sermon transcriptions of multi-verse passages (e.g., Galatians 1:6-12) where the speaker interleaves their own commentary between quoted verses.

**Bugs:**

1. **Bug 1 — Interjection tail inclusion error**: A detected interjection incorrectly includes the beginning of the next verse ("But I certify, you brethren,") because the phrase-matching logic that determines where verse text resumes fails to match normalized text against raw punctuated text.

2. **Bug 2 — Missed interjection #1**: A commentary block ("Is there actually another gospel that you would pervert? No, there's really only one gospel...") is not detected because the speaker reuses Bible vocabulary ("gospel", "pervert"), causing the word-set overlap ratio to exceed the 40% threshold.

3. **Bug 3 — Missed interjection #2**: A long paraphrase ("So Paul says, even if I come back to you and I preach something contrary...") is not detected for the same reason — shared theological vocabulary creates false word overlap with the verse text.

4. **Bug 4 — Missing trailing period**: The passage ends with "Jesus Christ" instead of "Jesus Christ." because `find_verse_end_in_transcript()` uses `\b\w+\b` word matching which excludes trailing punctuation.

**Key Insight**: Bugs 2 and 3 share a fundamental root cause — the word-overlap detection approach (`set(get_words(chunk)) ∩ set(get_words(verse_text))`) ignores word ORDER. Commentary that paraphrases the verse reuses the same words in different sequence/context, defeating set-based overlap. The fix requires **sequential matching** that considers word order, not just word presence.

## 1. Requirements & Constraints

### Requirements

- **REQ-001**: Commentary blocks where the speaker paraphrases verse content using similar vocabulary MUST be detected, even when 40%+ of words appear in the verse text
- **REQ-002**: Interjection boundaries MUST NOT include the start of the next verse — the boundary must end precisely where verse text resumes
- **REQ-003**: Passage boundary `end_pos` MUST include trailing punctuation (period, colon, etc.) after the last matched word
- **REQ-004**: All three commentary blocks in the Galatians 1:6-12 test case MUST be correctly detected with accurate boundaries
- **REQ-005**: Existing correctly-detected passages MUST NOT regress (no new false positives where verse text is incorrectly marked as commentary)

### Constraints

- **CON-001**: Do NOT change the `QuoteBoundary` data structure signature
- **CON-002**: Do NOT change the coordinate contract — all positions reference original raw text
- **CON-003**: Do NOT change document model types (`PassageNode`, `InterjectionNode`, etc.)
- **CON-004**: Prefer algorithmic improvements in `detect_commentary_blocks()` and `find_verse_end_in_transcript()` over adding new pipeline stages
- **CON-005**: All existing tests in `src/python/test_*.py` must continue to pass
- **CON-006**: Performance must remain acceptable — no exponential-time algorithms on typical passage lengths (< 2000 chars)

### Guidelines

- **GUD-001**: Prefer word-level sequential matching over string-level matching to handle punctuation and transcription variations
- **GUD-002**: Add comprehensive debug logging for commentary detection decisions
- **GUD-003**: Test with the specific Galatians 1:6-12 example as the primary integration test
- **GUD-004**: Design the sequential matching to be reusable for future boundary detection improvements

### Patterns

- **PAT-001**: Follow existing data flow: `detect_commentary_blocks()` → `all_exclusions` → `QuoteBoundary.interjection_positions` → `_build_passage_node()` → `InterjectionNode` children
- **PAT-002**: Use `get_words()` / `normalize_for_comparison()` for all text normalization (existing pattern)
- **PAT-003**: Return commentary blocks as `List[Tuple[int, int]]` in raw_text coordinates (existing contract)

---

## 2. Root Cause Analysis

### Bug 1: Interjection Tail Inclusion Error

**Symptom**: The detected interjection `" Paul says, I'm not here pushing my own opinion... But I certify, you brethren, "` incorrectly includes `"But I certify, you brethren, "` which is the start of verse 11.

**Code Path**: `detect_commentary_blocks()` at `bible_quote_processor.py:2791`

**Root Cause**: When a commentary block is detected, the function searches for where verse text resumes using this logic (lines 2869-2883):

```python
verse_phrases = find_distinctive_phrases(verse_text)
commentary_end = end_pos  # Default to end of quote

for phrase in verse_phrases:
    phrase_text = ' '.join(phrase)
    for match in re.finditer(re.escape(phrase_text[:20]), remaining_text, re.IGNORECASE):
        ...
```

There are TWO failures here:

1. **Normalized-vs-raw text mismatch**: `find_distinctive_phrases()` calls `get_words()` which calls `normalize_for_comparison()`, stripping all punctuation and lowercasing. So `phrase_text` is e.g., `"certify you brethren that the gospel which was"`. But the search target `remaining_text` is raw transcript text containing commas: `"certify, you brethren, that the gospel which was"`. The regex `re.escape("certify you brethren")` does NOT match `"certify, you brethren,"` because the commas are absent in the search pattern.

2. **Phrase ordering doesn't prioritize proximity**: Phrases are generated from the start of the verse text. Early phrases (verse 6-7) don't appear in the remaining text (already passed). Later phrases may skip over the actual resumption point. The first phrase that matches might be `"that the gospel which was preached"` (in verse 11, after "But I certify you brethren"), causing the end to be placed AFTER "But I certify, you brethren," instead of BEFORE it.

**Result**: The phrase `"But I certify, you brethren,"` gets swallowed into the commentary block because the phrase match finds verse text resuming later than the actual resumption point.

### Bug 2: Completely Missed Interjection #1

**Symptom**: The commentary `"Is there actually another gospel that you would pervert? No, there's really only one gospel, but there are those that teach something that is different. Similar but different. Paul writes, "` is not detected.

**Code Path**: `detect_commentary_blocks()` at lines 2848-2860

**Root Cause**: The sentence boundary at "gospel of Christ. Is there" IS correctly detected by the pattern `([.!?])\s+([A-Z])`. The chunk after this boundary starts with `"Is there actually another gospel that you would pervert? No, there's really only one gospel, but th"`. Word analysis:

| Chunk word | In verse_words_set? |
| ---------- | ------------------- |
| is         | ✅                  |
| there      | ✅                  |
| actually   | ❌                  |
| another    | ✅                  |
| gospel     | ✅                  |
| that       | ✅                  |
| you        | ✅                  |
| would      | ✅                  |
| pervert    | ✅                  |
| no         | ❌                  |
| theres     | ❌                  |
| really     | ❌                  |
| only       | ❌                  |
| one        | ❌                  |
| gospel     | ✅                  |
| but        | ✅                  |

**Result**: 10 of ~16 words match → `match_ratio ≈ 0.625 > 0.4` → NOT flagged as commentary.

The word-SET overlap approach is fundamentally broken for this case. The speaker says "Is there actually another gospel that you would pervert?" — reusing "gospel", "pervert", "another" etc. from the verse. But these words appear in an entirely different ORDER and CONTEXT than the verse. The verse says "would pervert the gospel of Christ" but the speaker says "another gospel that you would pervert" — same words, different sentence structure.

### Bug 3: Completely Missed Interjection #2

**Symptom**: The long paraphrase `"So Paul says, even if I come back to you and I preach something contrary to what I told you before..."` is not detected.

**Code Path**: Same as Bug 2

**Root Cause**: Same fundamental issue. The speaker's paraphrase reuses key verse vocabulary: "angel", "heaven", "preach", "contrary" (related to verse's "pervert"), "gospel", "you", etc. The word-set overlap exceeds 40% because theological paraphrases naturally reuse the same domain-specific vocabulary.

**Additional factor**: This commentary starts at "So Paul says," — the word "so" starts with a capital S after the sentence boundary, and the pattern matches `([.!?])\s+([A-Z])`. However, even if the boundary is detected, the word overlap check falsely passes it.

### Bug 4: Missing Trailing Period

**Symptom**: Passage text ends with `"...by the revelation of Jesus Christ"` instead of `"...by the revelation of Jesus Christ."`.

**Code Path**: `find_verse_end_in_transcript()` at `bible_quote_processor.py:1525`

**Root Cause**: The word matching pattern `r'\b\w+\b'` matches word characters only. When the last verse word "Christ" is matched, `last_matched_pos = word_matches[i].end()` gives the position right after "Christ" but before the period. The `\b\w+\b` pattern explicitly excludes punctuation.

In `ast_builder.py:451`, the passage content is extracted as `raw_text[passage.start_pos:passage_end]` where `passage_end` comes from `QuoteBoundary.end_pos`, which was set by `find_verse_end_in_transcript()` to this punctuation-exclusive position.

---

## 3. Solution Design

### Solution for Bugs 2 & 3: Sequential Word Alignment (LCS-Based Commentary Detection)

**Approach**: Replace the word-set overlap check with a **sequential word alignment** algorithm that considers word ORDER, not just word presence.

**Algorithm — LCS-Inspired Verse Alignment**:

1. Normalize both the chunk text and verse text into word lists using `get_words()`
2. Walk through the chunk words and attempt to match them against the verse words IN ORDER using a sliding pointer into the verse word list
3. Track "aligned runs" — consecutive chunk words that match consecutive verse words (with small skip tolerance)
4. When a gap of N+ consecutive chunk words fails to match the verse sequence, that gap is a potential commentary region
5. Calculate the ratio of sequentially-aligned words vs. total chunk words
6. If the **sequential alignment ratio** is below a threshold (e.g., 0.35), flag as commentary

**Why this works for the bug cases**:

- "Is there actually another gospel that you would pervert?" — The word "is" matches verse word "is" at position ~3, but then "there" matches at position ~4, then "actually" has NO match, then "another" jumps back to position ~15 in verse (before "gospel"), then "gospel" is at position ~16 — but this is a BACKWARD jump from verse position perspective. Sequential matching requires FORWARD progress through the verse. The words match the verse SET but NOT the verse SEQUENCE.

- "So Paul says, even if I come back to you..." — "Paul" doesn't appear in the verse at all, "says" doesn't, "even" doesn't, "if" matches but out of sequence, "come" doesn't appear. Very few sequential matches.

**Why this is better than alternatives**:

- **N-gram matching**: Would require specific N choice, more complex, and doesn't handle transcription variations well
- **Embedding-based similarity**: Too heavyweight for per-sentence checks; adds latency and model dependency
- **Lowering the threshold**: Would cause false positives on actual verse text that has minor transcription variations

**Implementation**: Add a new helper function `compute_sequential_alignment()` and use it as the PRIMARY check in `detect_commentary_blocks()`, with the existing word-set overlap as a SECONDARY fallback signal.

### Solution for Bug 1: Word-Level Verse Resumption Detection

**Approach**: Replace the broken `re.escape(phrase_text[:20])` string search with **word-level matching** to find where verse text resumes after a commentary block.

**Algorithm**:

1. Normalize the remaining text after the commentary start into words
2. For each position in the remaining text words, attempt to align a sliding window against the verse words
3. When a consecutive run of 3+ matching verse words is found (in order), that's where the verse resumes
4. Map the match position back to raw text coordinates

**Why this fixes Bug 1**: Word-level matching is immune to punctuation differences. "certify, you brethren," matches verse words ["certify", "you", "brethren"] even with commas in the raw text, because matching happens on normalized words while position tracking uses raw text word boundaries.

### Solution for Bug 4: Trailing Punctuation Capture

**Approach**: After `find_verse_end_in_transcript()` determines the last matched word position, scan forward past any trailing punctuation characters (`.`, `,`, `:`, `;`, `!`, `?`, `"`, `'`, `)`) and include them in the end position.

**Implementation**: Add a small post-processing step at the end of `find_verse_end_in_transcript()` that extends `last_matched_pos` to include adjacent punctuation.

---

## 4. Implementation Steps

### Phase 1: Add Sequential Word Alignment Helper

**GOAL-001**: Create the core algorithmic building block for order-aware verse matching.

| Task     | Description                                                                                                                             | File                                          | Function                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| TASK-001 | Create `compute_sequential_alignment(chunk_words, verse_words)` function that returns `(alignment_ratio, aligned_indices, gap_regions)` | `bible_quote_processor.py`                    | NEW: `compute_sequential_alignment()` |
| TASK-002 | Add unit tests for `compute_sequential_alignment()` with verse-match, commentary, and paraphrase cases                                  | `test_boundary_detection.py` or new test file | NEW tests                             |

**TASK-001 Details — `compute_sequential_alignment()`**:

```python
def compute_sequential_alignment(
    chunk_words: List[str],
    verse_words: List[str],
    max_verse_skip: int = 3,
    max_chunk_skip: int = 2
) -> Tuple[float, List[int], List[Tuple[int, int]]]:
    """
    Compute how well chunk_words align sequentially against verse_words.

    Uses a greedy forward-matching algorithm: walk through chunk_words and
    try to match each against verse_words in order, allowing controlled skips.

    Args:
        chunk_words: Normalized words from the transcript chunk
        verse_words: Normalized words from the Bible verse text
        max_verse_skip: Max verse words to skip when looking for next match
        max_chunk_skip: Max chunk words to skip (for interjections)

    Returns:
        Tuple of:
        - alignment_ratio: fraction of chunk words that aligned sequentially (0.0-1.0)
        - aligned_indices: list of chunk word indices that were aligned
        - gap_regions: list of (start_idx, end_idx) in chunk_words that were NOT aligned
    """
```

**Algorithm pseudocode**:

```
verse_ptr = 0
aligned = []
for i, chunk_word in enumerate(chunk_words):
    # Try to match chunk_word against verse_words[verse_ptr ... verse_ptr + max_verse_skip]
    found = False
    for j in range(verse_ptr, min(verse_ptr + max_verse_skip + 1, len(verse_words))):
        if words_match_fuzzy(chunk_word, verse_words[j]):
            aligned.append(i)
            verse_ptr = j + 1
            found = True
            break
    # If not found, chunk_word is non-matching (potential commentary)

alignment_ratio = len(aligned) / len(chunk_words)
gap_regions = extract_gaps(aligned, len(chunk_words))
return (alignment_ratio, aligned, gap_regions)
```

The key property: verse_ptr only moves FORWARD. Words that appear in the verse but in a different order won't create matches because the pointer can't go backward.

### Phase 2: Replace Word-Overlap Check in Commentary Detection

**GOAL-002**: Use sequential alignment as the primary commentary detection signal.

| Task     | Description                                                                                                                 | File                       | Function                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------- |
| TASK-003 | Replace the word-set overlap check (lines ~2848-2860) with `compute_sequential_alignment()` in `detect_commentary_blocks()` | `bible_quote_processor.py` | `detect_commentary_blocks()` |
| TASK-004 | Add combined scoring: use sequential alignment ratio as primary signal, word-set overlap as secondary confirmation          | `bible_quote_processor.py` | `detect_commentary_blocks()` |
| TASK-005 | Add debug logging for alignment decisions (alignment_ratio, matched words, gap regions)                                     | `bible_quote_processor.py` | `detect_commentary_blocks()` |

**TASK-003 Details**:

Replace the existing block:

```python
# CURRENT (broken):
chunk_words = get_words(chunk[:100])
if len(chunk_words) >= 5:
    matching = sum(1 for w in chunk_words if w in verse_words_set)
    match_ratio = matching / len(chunk_words)
    if match_ratio < 0.4:
        is_commentary = True
```

With:

```python
# NEW: Sequential alignment check
chunk_words = get_words(chunk[:150])  # Increased window for better alignment context
if len(chunk_words) >= 5:
    alignment_ratio, aligned_indices, gap_regions = compute_sequential_alignment(
        chunk_words, verse_words_list
    )

    # Primary check: low sequential alignment → commentary
    if alignment_ratio < 0.35:
        is_commentary = True
    elif alignment_ratio < 0.55:
        # Borderline: check if words match in set but NOT in sequence
        # (paraphrase detection)
        set_matching = sum(1 for w in chunk_words if w in verse_words_set)
        set_ratio = set_matching / len(chunk_words)

        # High set overlap but low sequential alignment = paraphrase
        if set_ratio > 0.4 and alignment_ratio < 0.45:
            is_commentary = True
```

**Important**: `verse_words_list` must be prepared as an ordered list (not a set) at the top of `detect_commentary_blocks()`:

```python
verse_words_list = get_words(verse_text)  # Ordered list for sequential matching
verse_words_set = set(verse_words_list)    # Set for fast lookups (existing)
```

### Phase 3: Fix Verse Resumption Detection (Bug 1 Fix)

**GOAL-003**: Replace broken string-based phrase matching with word-level verse alignment for finding where verse text resumes after commentary.

| Task     | Description                                                                                                           | File                         | Function                             |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| TASK-006 | Create `find_verse_resumption_point(remaining_text, verse_words, min_run_length=3)` helper function                   | `bible_quote_processor.py`   | NEW: `find_verse_resumption_point()` |
| TASK-007 | Replace the `re.escape(phrase_text[:20])` search in `detect_commentary_blocks()` with `find_verse_resumption_point()` | `bible_quote_processor.py`   | `detect_commentary_blocks()`         |
| TASK-008 | Add unit tests for verse resumption detection with punctuation variations                                             | `test_boundary_detection.py` | NEW tests                            |

**TASK-006 Details — `find_verse_resumption_point()`**:

```python
def find_verse_resumption_point(
    remaining_raw_text: str,
    verse_words: List[str],
    offset: int,
    min_run_length: int = 3
) -> Optional[int]:
    """
    Find where verse text resumes in the remaining raw text after a commentary block.

    Uses word-level matching (immune to punctuation differences) to find a run of
    min_run_length consecutive verse words in the remaining text.

    Args:
        remaining_raw_text: Raw transcript text after the commentary start
        verse_words: Full ordered verse word list (normalized)
        offset: Absolute position offset to add to returned position
        min_run_length: Minimum consecutive verse word matches to confirm resumption

    Returns:
        Absolute position in raw text where verse resumes, or None
    """
```

**Algorithm**:

1. Tokenize `remaining_raw_text` into words using `re.finditer(r'\b\w+\b', ...)` to get word positions
2. Normalize each word
3. For each starting position `i` in remaining words:
   - Attempt sequential alignment: match `remaining_words[i], remaining_words[i+1], ...` against `verse_words[j], verse_words[j+1], ...` for some `j`
   - If `min_run_length` consecutive matches are found, return `offset + word_matches[i].start()` (the raw text position of the first matching word)
4. To find the right `j` (where in the verse to start matching): for each `i`, scan verse_words to find the first `j` where `verse_words[j]` matches `remaining_words[i]`, then verify the next `min_run_length - 1` words also match consecutively
5. Return the position of the EARLIEST such run that is past the minimum commentary length

**TASK-007 Details**:

Replace the existing block (lines ~2869-2883):

```python
# CURRENT (broken):
verse_phrases = find_distinctive_phrases(verse_text)
commentary_end = end_pos

for phrase in verse_phrases:
    phrase_text = ' '.join(phrase)
    for match in re.finditer(re.escape(phrase_text[:20]), remaining_text, re.IGNORECASE):
        potential_end = start_pos + boundary_pos + match.start()
        if potential_end > commentary_start + 20:
            commentary_end = potential_end
            break
    if commentary_end < end_pos:
        break
```

With:

```python
# NEW: Word-level verse resumption detection
commentary_end = end_pos  # Default to end of quote

resumption_pos = find_verse_resumption_point(
    remaining_text,
    verse_words_list,
    offset=start_pos + boundary_pos,
    min_run_length=3
)

if resumption_pos is not None and resumption_pos > commentary_start + 20:
    commentary_end = resumption_pos
```

### Phase 4: Fix Trailing Punctuation (Bug 4 Fix)

**GOAL-004**: Include trailing punctuation in passage `end_pos`.

| Task     | Description                                                                 | File                         | Function                         |
| -------- | --------------------------------------------------------------------------- | ---------------------------- | -------------------------------- |
| TASK-009 | Add punctuation-capture post-processing to `find_verse_end_in_transcript()` | `bible_quote_processor.py`   | `find_verse_end_in_transcript()` |
| TASK-010 | Add unit test verifying trailing period inclusion                           | `test_boundary_detection.py` | NEW test                         |

**TASK-009 Details**:

At the end of `find_verse_end_in_transcript()`, before the return statement (currently `return start_pos + last_matched_pos`), add:

```python
# Capture trailing punctuation after the last matched word
end_absolute = start_pos + last_matched_pos
trailing_text = transcript[end_absolute:end_absolute + 5]  # Look at next few chars

# Extend past punctuation characters that are part of the verse ending
punct_match = re.match(r'^[.,:;!?\'")\]]+', trailing_text)
if punct_match:
    end_absolute += punct_match.end()

return end_absolute
```

This handles periods, commas, colons, semicolons, exclamation/question marks, and closing quotes/brackets.

### Phase 5: Improve Commentary Detection Scope

**GOAL-005**: Ensure commentary detection can find MULTIPLE commentary blocks within a single passage, and handles the case where a commentary block's end detection previously swallowed remaining content.

| Task     | Description                                                                                                                                                                      | File                       | Function                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------- | ---- | -------------------- | ---------------------- | --- | --- | --------------------------------------------- | -------------------------- | ---------------------------- |
| TASK-011 | After finding a commentary block, advance the boundary iteration past the commentary end to continue checking remaining text                                                     | `bible_quote_processor.py` | `detect_commentary_blocks()` |
| TASK-012 | Add COMMENTARY_PATTERNS for additional speaker cues: `r'^\s\*Paul\s+(says                                                                                                        | writes                     | said)\b'`, `r'^\s\*So\s+(he  | Paul | the apostle)\s+(says | said)\b'`, `r'^\s\*(Is | Are | Was | Were)\s+there\b.\*\?'` (rhetorical questions) | `bible_quote_processor.py` | `detect_commentary_blocks()` |
| TASK-013 | Lower the `chunk[:100]` window to `chunk[:150]` for alignment context, and explore starting alignment from the CURRENT verse position (not the entire verse) for better locality | `bible_quote_processor.py` | `detect_commentary_blocks()` |

**TASK-011 Details**:

Currently, when a commentary block is found, the for loop continues iterating over pre-computed `boundaries`. But if a boundary falls INSIDE a detected commentary block, it wastes computation and may produce overlapping blocks (which then get merged). More importantly, the verse resumption detection needs to be correct so that boundaries AFTER the commentary block are processed against the correct remaining verse text.

Add a skip mechanism:

```python
skip_until = 0  # Absolute position to skip to

for boundary_pos in boundaries:
    abs_pos = start_pos + boundary_pos
    if abs_pos < skip_until:
        continue  # Inside a previously detected commentary block

    # ... existing detection logic ...

    if is_commentary:
        # ... find commentary_end ...
        commentary_blocks.append((commentary_start, commentary_end))
        skip_until = commentary_end  # Skip boundaries inside this block
```

**TASK-012 Details**:

Add patterns that capture the speaker's typical commentary lead-ins that appear in the test case:

```python
COMMENTARY_PATTERNS = [
    # ... existing patterns ...
    r'^\s*(?:so\s+)?(?:Paul|he|she|the\s+apostle|the\s+author)\s+(?:says|writes|said|wrote)\b',
    r'^\s*(?:Is|Are|Was|Were|Do|Does|Did|Can|Could|Should)\s+(?:there|we|you|they|it)\b.*\?',
    r"^\s*(?:So|Now|See|Look|Notice)\s*,?\s+(?:he|she|Paul|we|I|you)\b",
    r"^\s*I(?:'m| am)\s+(?:not\s+)?(?:here|just|simply)\b",
]
```

### Phase 6: Integration Testing

**GOAL-006**: Verify all four bugs are fixed with the Galatians 1:6-12 test case, and confirm no regressions.

| Task     | Description                                                                                                                                                      | File                         | Function       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------- |
| TASK-014 | Create integration test `test_galatians_commentary_detection()` that verifies all 3 interjections are detected with correct boundaries                           | `test_boundary_detection.py` | NEW test       |
| TASK-015 | Create integration test `test_trailing_punctuation_in_end_pos()` for Bug 4                                                                                       | `test_boundary_detection.py` | NEW test       |
| TASK-016 | Run existing tests to verify no regressions: `test_ast_passage_boundaries.py`, `test_passage_isolation.py`, `test_boundary_detection.py`, `test_e2e_pipeline.py` | All test files               | Existing tests |
| TASK-017 | Run full pipeline on the Galatians 1:6-12 example and verify AST output has correct TextNode/InterjectionNode interleaving                                       | Manual or test               | End-to-end     |

**TASK-014 Details — Integration Test Structure**:

```python
def test_galatians_commentary_detection():
    """Verify all 3 commentary blocks in Galatians 1:6-12 are detected."""
    verse_text = (
        "I marvel that ye are so soon removed from him that called you "
        "into the grace of Christ unto another gospel: Which is not another; "
        "but there be some that trouble you, and would pervert the gospel of Christ. "
        "But though we, or an angel from heaven, preach any other gospel unto you "
        "than that which we have preached unto you, let him be accursed. "
        "As we said before, so say I now again, If any man preach any other gospel "
        "unto you than that ye have received, let him be accursed. "
        "For do I now persuade men, or God? or do I seek to please men? "
        "for if I yet pleased men, I should not be the servant of Christ. "
        "But I certify you, brethren, that the gospel which was preached of me "
        "is not after man. For I neither received it of man, neither was I taught it, "
        "but by the revelation of Jesus Christ."
    )

    transcript = (
        "I marvel that you are so soon removed from him that called you into "
        "the grace of Christ unto another gospel, which is not another, but "
        "there be some that trouble you and would pervert the gospel of Christ. "
        "Is there actually another gospel that you would pervert? No, there's "
        "really only one gospel, but there are those that teach something that is "
        "different. Similar but different. Paul writes, but though we or an angel "
        "from heaven preach any other gospel unto you than that which we have "
        "preached unto you, let him be accursed. So Paul says, even if I come "
        "back to you and I preach something contrary to what I told you before, "
        "and I say this is God's revelation from heaven, and it's contrary to "
        "God's revelation from heaven that I told you five years ago, don't "
        "listen to me, because there's only one truth. So he said, if an angel "
        "from heaven comes in your midst and says, thou shalt, and it's contrary "
        "to God's word, don't listen to him, or even me. As we said before, "
        "so I say now again, if any man preach any other gospel unto you than "
        "that you have received, let him be accursed. For do I now persuade men, "
        "or God? Do I seek to please men? For if yet I pleased men, I should not "
        "be the servant of Christ. Paul says, I'm not here pushing my own opinion "
        "or my own agenda. I am here simply teaching you Jesus Christ. And his "
        "words, and his truth, and his doctrine. But I certify, you brethren, "
        "that the gospel which was preached of me is not after man, for I neither "
        "received it of man, nor was I taught it, but by the revelation of "
        "Jesus Christ."
    )

    start_pos = 0
    end_pos = len(transcript)

    blocks = detect_commentary_blocks(transcript, start_pos, end_pos, verse_text)

    # Should detect 3 commentary blocks
    assert len(blocks) == 3, f"Expected 3 commentary blocks, got {len(blocks)}"

    # Block 1: "Is there actually another gospel..."
    block1_text = transcript[blocks[0][0]:blocks[0][1]]
    assert "Is there actually" in block1_text
    assert "Paul writes," in block1_text
    assert "but though we" not in block1_text  # Should NOT include next verse

    # Block 2: "So Paul says, even if I come back..."
    block2_text = transcript[blocks[1][0]:blocks[1][1]]
    assert "So Paul says, even if" in block2_text
    assert "or even me." in block2_text
    assert "As we said before" not in block2_text  # Should NOT include next verse

    # Block 3: "Paul says, I'm not here pushing..."
    block3_text = transcript[blocks[2][0]:blocks[2][1]]
    assert "I'm not here pushing" in block3_text
    assert "But I certify" not in block3_text  # Bug 1: should NOT include verse 11 start
```

---

## 5. Testing Strategy

### Unit Tests

| Test                                     | Description                                                                         | Validates            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| `test_sequential_alignment_exact_verse`  | Chunk contains exact verse words in order → high alignment ratio                    | TASK-001 correctness |
| `test_sequential_alignment_paraphrase`   | Chunk contains same words in different order → low alignment ratio                  | Bug 2/3 detection    |
| `test_sequential_alignment_mixed`        | Chunk is half verse, half commentary → medium alignment with gap regions            | Gap region detection |
| `test_verse_resumption_with_punctuation` | Raw text has commas/periods that differ from verse → correct resumption point found | Bug 1 fix            |
| `test_verse_resumption_no_match`         | No verse text after commentary → returns None                                       | Edge case            |
| `test_trailing_punctuation_period`       | Verse ends with "Christ." → end_pos includes the period                             | Bug 4 fix            |
| `test_trailing_punctuation_colon`        | Verse ends with "gospel:" → end_pos includes the colon                              | Bug 4 edge case      |
| `test_trailing_punctuation_none`         | Verse ends mid-sentence (no trailing punct) → end_pos unchanged                     | No regression        |

### Integration Tests

| Test                                     | Description                                                                           | Validates                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------- |
| `test_galatians_commentary_detection`    | Full Galatians 1:6-12 with 3 commentary blocks → all detected with correct boundaries | All 4 bugs                  |
| `test_no_false_positives_on_clean_verse` | Verse quoted with no commentary → zero commentary blocks detected                     | No regression               |
| `test_single_short_commentary`           | One brief "that is..." commentary → correctly detected and bounded                    | Existing behavior preserved |
| `test_commentary_at_end_of_passage`      | Commentary after last verse with no resumption → commentary_end = end_pos             | Edge case                   |

### Regression Testing

Run all existing tests:

```bash
cd src/python
python -m pytest test_ast_passage_boundaries.py test_passage_isolation.py test_boundary_detection.py test_e2e_pipeline.py test_tag_extraction.py -v
```

---

## 6. Risk Assessment

### Risk 1: False Positives on Verse Text With Minor Variations

**Risk**: The sequential alignment check might flag actual verse text as commentary when the speaker slightly reorders verse words or the transcription introduces word-order errors.

**Mitigation**:

- Use a generous `max_verse_skip` (3) in `compute_sequential_alignment()` to tolerate skipped/transposed words
- Use `_words_match_fuzzy()` for comparison to handle transcription variations ("ye" → "you", "unto" → "to")
- The alignment threshold (0.35) is deliberately lower than the old set-overlap threshold (0.40) — meaning MORE content passes as verse text, not less
- Add the borderline zone (0.35-0.55) where BOTH sequential and set-overlap must agree, adding safety margin

**Severity**: Medium — could cause verse text to be incorrectly marked as interjection, breaking passage structure.

**Likelihood**: Low — the sequential alignment is intuitively the right check (verse text follows the same word order as the verse).

### Risk 2: Performance Degradation

**Risk**: The sequential alignment algorithm is O(n × m) where n = chunk words, m = verse words. For long passages with many sentence boundaries, this could slow down processing.

**Mitigation**:

- Chunk size is capped at 150 characters (~25 words)
- Verse text for multi-verse passages is typically 200-500 words
- Total per-passage cost: O(25 × 500) × number_of_boundaries ≈ 12,500 × ~10 = 125,000 operations — negligible
- `find_verse_resumption_point()` scans remaining text (~1000 words max) × verse words (~500) = 500,000 operations — still fast
- If needed, can optimize with early termination once alignment is clearly high/low

**Severity**: Low — not a real concern for typical passage sizes.

**Likelihood**: Very low.

### Risk 3: Regression in Existing Commentary Detection

**Risk**: Changing the detection algorithm breaks existing correctly-detected commentary blocks.

**Mitigation**:

- The COMMENTARY_PATTERNS regex check runs FIRST and is unchanged — all explicitly-patterned commentary is still caught
- Sequential alignment is strictly BETTER than set overlap for distinguishing paraphrase from verse (same words in different order)
- Run existing test suites before and after
- Keep both checks (sequential as primary, set-overlap as secondary in the borderline zone) rather than removing set-overlap entirely

**Severity**: Medium — regression could mean previously-working passages break.

**Likelihood**: Low — the sequential approach is a strict improvement over set overlap for the verse/commentary distinction.

### Risk 4: `find_verse_resumption_point()` Fails to Find Match

**Risk**: The word-level resumption detection might not find a match when the old phrase-based approach did (in some cases the old approach worked despite its bugs).

**Mitigation**:

- The new approach is strictly more tolerant (handles punctuation differences, transcription variations)
- Fallback: if `find_verse_resumption_point()` returns None, keep `commentary_end = end_pos` (same as current default)
- `min_run_length=3` is conservative (only need 3 consecutive word matches to confirm verse resumption)

**Severity**: Medium — could cause commentary blocks to extend too far.

**Likelihood**: Very low — the word-level approach handles more cases than string matching.

---

## 7. Verification Steps

### Step 1: Unit Verification

```bash
cd src/python
python -m pytest test_boundary_detection.py -v -k "sequential_alignment or verse_resumption or trailing_punctuation"
```

### Step 2: Integration Verification

```bash
cd src/python
python -m pytest test_boundary_detection.py -v -k "galatians_commentary"
```

### Step 3: Regression Verification

```bash
cd src/python
python -m pytest test_ast_passage_boundaries.py test_passage_isolation.py test_boundary_detection.py test_e2e_pipeline.py -v
```

### Step 4: Manual Verification

1. Process the Galatians 1:6-12 test transcript through the full pipeline
2. Inspect the AST output for the passage node
3. Verify there are 4 TextNode children and 3 InterjectionNode children interleaved correctly:
   - TextNode: "I marvel that you are so soon removed...gospel of Christ."
   - InterjectionNode: "Is there actually another gospel...Paul writes, "
   - TextNode: "but though we or an angel...let him be accursed."
   - InterjectionNode: "So Paul says, even if I come back...or even me."
   - TextNode: "As we said before...the servant of Christ."
   - InterjectionNode: "Paul says, I'm not here pushing...and his doctrine."
   - TextNode: "But I certify, you brethren...Jesus Christ."
4. Verify the last TextNode ends with a period (Bug 4 fix)

### Step 5: Edge Case Verification

Test these additional scenarios:

- **Clean quoting**: Passage quoted with zero commentary → zero interjections detected
- **All commentary**: Entire passage boundary is commentary/paraphrase → single large interjection block
- **Very short passage**: 1-2 verse passage with brief "amen?" interjection → existing `detect_interjections()` still works
- **Multiple translations**: Verify with NIV, ESV (not just KJV) — the word matching should be translation-agnostic

---

## 8. Implementation Order and Dependencies

```
Phase 1 (TASK-001, TASK-002)
    └── Phase 2 (TASK-003, TASK-004, TASK-005) ← depends on Phase 1

Phase 1 (independent)
    └── Phase 3 (TASK-006, TASK-007, TASK-008) ← depends on Phase 1 concept but can be coded in parallel

Phase 4 (TASK-009, TASK-010) ← fully independent, can be done first

Phase 5 (TASK-011, TASK-012, TASK-013) ← depends on Phase 2 and 3

Phase 6 (TASK-014, TASK-015, TASK-016, TASK-017) ← depends on all prior phases
```

**Recommended implementation order**:

1. Phase 4 (Bug 4 — trivial fix, high confidence)
2. Phase 1 (core algorithm)
3. Phase 3 (Bug 1 fix — uses similar algorithm to Phase 1)
4. Phase 2 (Bug 2/3 fix — plugs Phase 1 algorithm into commentary detection)
5. Phase 5 (improvements — depends on Phase 2 and 3)
6. Phase 6 (integration testing — validates everything)

---

## 9. Summary of Changes by File

| File                         | Functions Modified                                             | Functions Added                                                   |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `bible_quote_processor.py`   | `detect_commentary_blocks()`, `find_verse_end_in_transcript()` | `compute_sequential_alignment()`, `find_verse_resumption_point()` |
| `test_boundary_detection.py` | —                                                              | ~10 new test functions                                            |

**Lines of code estimate**: ~120 lines new code, ~40 lines modified, ~150 lines new tests.

**No changes to**: `document_model.py`, `ast_builder.py`, `main.py`, any TypeScript files, any shared types.
