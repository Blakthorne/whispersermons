# Prompt: Plan for Fixing Interjection/Commentary Detection Gaps in Passage Processing

## Your Role

You are a senior software engineer tasked with creating a detailed, actionable implementation plan to fix bugs in the Bible passage interjection/commentary detection system in WhisperDesk. WhisperDesk is an Electron desktop app that transcribes sermon audio using whisper.cpp, then processes the transcription to detect Bible passages, identify where the speaker interjects commentary between verses, and builds a structured AST document.

## Context: The System Architecture

### Pipeline Overview

The full processing pipeline flows like this:

1. **Audio → Raw text**: whisper.cpp transcribes audio to raw text
2. **Reference detection**: `detect_bible_references()` finds Bible references in the text (e.g., "Galatians 1-6")
3. **Verse fetching**: `BibleAPIClient` fetches actual verse text from the Bolls.life Bible API
4. **Translation detection**: Per-quote translation detection compares transcript against multiple translations
5. **Quote boundary detection**: `find_quote_boundaries_improved()` uses distinctive phrase matching to find where the speaker is reading the Bible passage in the transcript
6. **Interjection/commentary detection**: `detect_interjections()` and `detect_commentary_blocks()` identify where the speaker inserts their own words within the passage
7. **Boundary verification**: `verify_quote_boundaries()` validates and adjusts boundaries
8. **AST building**: `ASTBuilder.build()` constructs the document tree with paragraph, passage, text, and interjection nodes

### File Locations

- **Bible quote processor**: `src/python/bible_quote_processor.py` (3742 lines) — All passage detection, interjection detection, commentary detection, boundary finding
- **AST builder**: `src/python/ast_builder.py` (602 lines) — Builds the document AST from pipeline data
- **Document model**: `src/python/document_model.py` (773 lines) — Dataclass definitions for all node types
- **Main pipeline**: `src/python/main.py` — Orchestrates the full pipeline including sentence tokenization and paragraph segmentation

### Key Functions Involved in This Bug

1. **`detect_commentary_blocks(text, start_pos, end_pos, verse_text)`** at `bible_quote_processor.py:2791` — Detects longer commentary sections within a passage boundary. This is the PRIMARY function responsible for finding the missed interjections described below.

2. **`detect_interjections(text, start_pos, end_pos)`** at `bible_quote_processor.py:2912` — Detects short regex-based interjections like "a what?", "right?", "amen?" within a passage boundary. This only handles VERY short patterns and is NOT responsible for the bugs described below.

3. **`_build_passage_node(quote, content)`** at `ast_builder.py:460` — Builds the PassageNode with children (TextNode and InterjectionNode) by splitting content at interjection offset positions

4. **`create_passage_node(content, reference, detection, interjections)`** at `document_model.py:692` — Factory function that interleaves text and interjection children based on offset positions

5. **`find_verse_end_in_transcript(transcript, start_pos, verse_text)`** at `bible_quote_processor.py:1525` — Word-by-word matching to find where verse text ends in transcript. Has a skip tolerance that may be too generous.

6. **`validate_gap_is_verse_content(gap_text, verse_text)`** at `bible_quote_processor.py:1437` — Checks if text between phrase matches is actual verse content vs. commentary. Uses a 50% word overlap threshold and a fixed set of commentary patterns.

## The Bug Report: Specific Example

### Input Data

The passage is Galatians 1:6-12 (KJV). The actual verse text from the Bible API is:

> "I marvel that ye are so soon removed from him that called you into the grace of Christ unto another gospel: Which is not another; but there be some that trouble you, and would pervert the gospel of Christ. But though we, or an angel from heaven, preach any other gospel unto you than that which we have preached unto you, let him be accursed. As we said before, so say I now again, If any man preach any other gospel unto you than that ye have received, let him be accursed. For do I now persuade men, or God? or do I seek to please men? for if I yet pleased men, I should not be the servant of Christ. But I certify you, brethren, that the gospel which was preached of me is not after man. For I neither received it of man, neither was I taught it, but by the revelation of Jesus Christ."

The speaker's transcribed text within the passage boundary is:

> "I marvel that you are so soon removed from him that called you into the grace of Christ unto another gospel, which is not another, but there be some that trouble you and would pervert the gospel of Christ. **Is there actually another gospel that you would pervert? No, there's really only one gospel, but there are those that teach something that is different. Similar but different. Paul writes,** but though we or an angel from heaven preach any other gospel unto you than that which we have preached unto you, let him be accursed. **So Paul says, even if I come back to you and I preach something contrary to what I told you before, and I say this is God's revelation from heaven, and it's contrary to God's revelation from heaven that I told you five years ago, don't listen to me, because there's only one truth. So he said, if an angel from heaven comes in your midst and says, thou shalt, and it's contrary to God's word, don't listen to him, or even me.** As we said before, so I say now again, if any man preach any other gospel unto you than that you have received, let him be accursed. For do I now persuade men, or God? Do I seek to please men? For if yet I pleased men, I should not be the servant of Christ. **Paul says, I'm not here pushing my own opinion or my own agenda. I am here simply teaching you Jesus Christ. And his words, and his truth, and his doctrine. But I certify, you brethren,** that the gospel which was preached of me is not after man, for I neither received it of man, nor was I taught it, but by the revelation of Jesus Christ"

(Bold sections above are speaker interjections/commentary that should be detected.)

### What Currently Works

1. ✅ The passage was correctly detected as Galatians 1:6-12
2. ✅ The overall passage boundary (start/end) appears reasonable
3. ✅ ONE interjection was partially detected: "Paul says, I'm not here pushing my own opinion or my own agenda. I am here simply teaching you Jesus Christ. And his words, and his truth, and his doctrine. But I certify, you brethren, "

### Bug 1: Interjection boundary is slightly wrong (tail inclusion error)

The detected interjection is: `" Paul says, I'm not here pushing my own opinion or my own agenda. I am here simply teaching you Jesus Christ. And his words, and his truth, and his doctrine. But I certify, you brethren, "`

**Problem**: The text `"But I certify, you brethren, "` should NOT be in the interjection — it's the beginning of verse 11 in the KJV: "But I certify you, brethren, that the gospel which was preached of me is not after man."

**Root cause hypothesis**: The commentary block end-detection logic in `detect_commentary_blocks()` (lines 2869-2883) searches for the next verse phrase match to determine where commentary ends. It uses `find_distinctive_phrases(verse_text)` to find phrases, then does `re.escape(phrase_text[:20])` to search in remaining text. The issue is likely that:

- The phrase matching truncates to 20 chars which may not be enough to correctly identify where the verse resumes
- Or the phrase matching finds a match AFTER "But I certify, you brethren," because the distinctive phrase window doesn't start at that exact point
- Or the text "But I certify" appears in the verse text (it does — it starts verse 11), but the matching logic doesn't anchor to it precisely

### Bug 2: Completely missed interjection #1

**Missed text**: `"Is there actually another gospel that you would pervert? No, there's really only one gospel, but there are those that teach something that is different. Similar but different. Paul writes, "`

This appears between verse 7 and the continuation of the quoting at verse 8. This text has ZERO overlap with the actual verse text. Words like "actually", "really", "teach something", "different", "Similar" do not appear in Galatians 1:6-12.

**Root cause hypothesis**: `detect_commentary_blocks()` checks each sentence boundary and evaluates the chunk after it. The function:

1. Finds sentence boundaries via the pattern `([.!?])\s+([A-Z])`
2. For each boundary, takes 150 chars after it
3. Checks against COMMENTARY_PATTERNS (regex list)
4. If no pattern matches, checks word overlap — if <40% of words are verse words, marks as commentary

**Why this was likely missed**:

- The sentence boundary detector requires `([.!?])\s+([A-Z])` — the text "gospel of Christ. Is there" contains this pattern (period + space + capital I), so a boundary SHOULD be detected there
- But `detect_commentary_blocks` may be iterating boundaries incorrectly — once it finds ONE commentary block, it may set `commentary_end = end_pos` (the end of the entire quote) and then not look for additional commentary blocks in between. Looking at line 2882: `commentary_end = end_pos  # Default to end of quote` — this means if phrase matching fails to find where verse text resumes, the entire rest of the passage gets flagged as one commentary block, which would then likely be merged with other blocks incorrectly, or the function returns before checking the remaining boundaries.
- **Critical issue**: The for loop at line 2823 iterates over `boundaries`, but when a commentary block is detected, its `commentary_end` defaults to `end_pos` (the full quote end). This means the first detected commentary block could swallow the entire remaining passage, preventing detection of subsequent commentary blocks. However, looking more carefully, the boundaries iteration continues — but the phrase matching to find where verse resumes (`re.escape(phrase_text[:20])`) may fail due to case differences, transcription variations, or the 20-char truncation.
- **Most likely root cause**: The commentary is NOT at a sentence boundary that matches the pattern. Let's check: the text before this commentary ends with "gospel of Christ." and the commentary starts with "Is there actually..." — this IS a sentence boundary matching `([.!?])\s+([A-Z])`. BUT the word overlap check uses only `chunk_words = get_words(chunk[:100])` — 100 chars from this point would be "Is there actually another gospel that you would pervert? No, there's really only one gospel, but th" — words like "gospel", "pervert" DO appear in the verse text! The word "gospel" appears 4 times in the verse, "pervert" appears once. So the match_ratio may exceed 40%, causing the commentary to be missed. **This is likely the key issue** — common Bible words in the speaker's commentary create false positive word overlap with the verse text.

### Bug 3: Completely missed interjection #2

**Missed text**: `"So Paul says, even if I come back to you and I preach something contrary to what I told you before, and I say this is God's revelation from heaven, and it's contrary to God's revelation from heaven that I told you five years ago, don't listen to me, because there's only one truth. So he said, if an angel from heaven comes in your midst and says, thou shalt, and it's contrary to God's word, don't listen to him, or even me."`

This is a long paraphrase (the speaker is explaining verses 8-9 in their own words). Words like "angel", "heaven", "preach", "gospel" appear in both the verse and the commentary, creating word overlap.

**Root cause hypothesis**: Same as Bug 2 — the word overlap between the speaker's paraphrase and the verse text exceeds the 40% threshold because the speaker is naturally using many of the same theological words. The commentary detection word-overlap approach is fundamentally flawed for cases where the speaker paraphrases the verse content using similar vocabulary.

### Bug 4: Missing trailing period on passage text

The final text node in the passage ends with `"...by the revelation of Jesus Christ"` — missing the period. The passage text should end with `"Christ."`.

**Root cause hypothesis**: The passage `end_pos` is likely set to the position right before the period, OR the period gets included in a following paragraph node. In `_split_group_around_passages()` at `ast_builder.py:397-434`, when splitting text around passages, `passage_end = min(passage.end_pos, group_end)` and the passage content is extracted as `raw_text[passage.start_pos:passage_end]`. The period may be excluded because:

- `find_verse_end_in_transcript()` uses word-by-word matching via `\b\w+\b` regex, which doesn't capture trailing punctuation
- The `end_pos` in the resulting QuoteBoundary points to the end of the last matched word ("Christ") rather than including the period after it
- In `find_verse_end_in_transcript()` line 1582: `last_matched_pos = word_matches[i].end()` — this captures the end of the word match, but `\b\w+\b` doesn't include punctuation

## Your Task

Create a comprehensive, step-by-step implementation plan to fix ALL FOUR bugs described above. The plan should follow the format of existing plans in the `plan/` directory. For each fix, your plan must include:

### Required Sections

1. **Root Cause Analysis** — For each bug, trace through the exact code path that produces the wrong result. Identify the specific lines, functions, and logic errors. Don't just hypothesize — use the code analysis provided above to pinpoint exact failures.

2. **Solution Design** — For each bug, describe the solution approach. Explain WHY this approach is better than alternatives. Consider:
   - For the word-overlap false positive issue (bugs 2 & 3): The current approach of checking if <40% of words are verse words is fundamentally insufficient when the speaker paraphrases using similar vocabulary. Consider approaches like:
     - **Sequential word matching**: Instead of just word-set overlap, check if the words appear in the SAME ORDER as the verse text. Commentary uses the same words but in different order/context.
     - **N-gram sequence matching**: Use bigrams or trigrams to compare so that "the gospel of Christ" in verse text matches "the gospel of Christ" in the passage but NOT "there's really only one gospel" in commentary.
     - **Verse-aligned segmentation**: Walk through the passage text and the verse text simultaneously, using a sliding window to identify segments that match the verse vs. segments that diverge. This is conceptually similar to diff/LCS (Longest Common Subsequence).
     - **Embedding-based similarity**: The codebase already has an embedding model (`src/python/embedding_model.py`). Consider using sentence-level embeddings to compare chunks against verse text.
   - For the interjection boundary precision issue (bug 1): The phrase matching to find where verse text resumes needs to be more precise — consider word-level matching anchored to specific verse words.
   - For the trailing period issue (bug 4): The `find_verse_end_in_transcript()` word matching needs to capture trailing punctuation.

3. **Implementation Steps** — Specific code changes needed, organized into phases/tasks with clear task IDs. Each task should be atomic (can be completed and tested independently). Include:
   - File path and function name to modify
   - What to add/change/remove
   - Expected behavior after the change

4. **Testing Strategy** — How to verify each fix:
   - Unit tests for individual functions (commentary detection, interjection boundary detection)
   - The specific Galatians 1:6-12 example as an integration test
   - Edge cases to consider (very short passages, passages with many interjections, passages where entire content is paraphrased)

5. **Risk Assessment** — What could go wrong with each fix? Consider:
   - False positives: verses incorrectly marked as commentary
   - Performance impact: more expensive matching algorithms
   - Regression risk: existing passages that currently work correctly

## Constraints and Guidelines

- **DO NOT** change the QuoteBoundary data structure signature (used across the codebase)
- **DO NOT** change the coordinate contract: all positions reference the original raw text
- **DO NOT** change the document model types — the fix is in the detection/classification logic
- **PREFER** algorithmic improvements in `detect_commentary_blocks()` and `find_verse_end_in_transcript()` over adding new pipeline stages
- **The interjection_positions on QuoteBoundary** is a list of `(start_pos, end_pos)` tuples in raw_text coordinates — these are what become InterjectionNode children in the AST
- **The `detect_commentary_blocks` return value** gets merged with `detect_interjections` return value into `all_exclusions`, which becomes `interjection_positions` on the QuoteBoundary — so both short interjections AND longer commentary blocks end up as InterjectionNodes in the AST
- All fixes must be in Python (the processing pipeline is Python)
- Existing tests in `src/python/test_*.py` must continue to pass
- Use the existing plan format from `plan/` directory

## Additional Code Context

### How commentary detection currently works (the core of the problem):

```python
# bible_quote_processor.py:2791-2906
def detect_commentary_blocks(text, start_pos, end_pos, verse_text):
    quote_text = text[start_pos:end_pos]
    commentary_blocks = []

    # Step 1: Find sentence boundaries via regex ([.!?]\s+[A-Z])
    sentence_pattern = re.compile(r'([.!?])\s+([A-Z])')
    verse_words_set = set(get_words(verse_text))

    boundaries = []
    for match in sentence_pattern.finditer(quote_text):
        boundaries.append(match.start() + 1)

    # Step 2: For each boundary, check if following text looks like commentary
    for boundary_pos in boundaries:
        chunk = quote_text[boundary_pos:boundary_pos + 150]

        # Check explicit commentary patterns (regex)
        is_commentary = False
        for pattern in COMMENTARY_PATTERNS:
            if re.search(pattern, chunk):
                is_commentary = True
                break

        if not is_commentary:
            # WORD OVERLAP CHECK — This is where the bug manifests
            chunk_words = get_words(chunk[:100])
            if len(chunk_words) >= 5:
                matching = sum(1 for w in chunk_words if w in verse_words_set)
                match_ratio = matching / len(chunk_words)
                if match_ratio < 0.4:  # <-- THIS THRESHOLD IS THE PROBLEM
                    is_commentary = True

        # Step 3: If commentary, find where verse text resumes
        if is_commentary:
            commentary_start = start_pos + boundary_pos
            remaining_text = quote_text[boundary_pos:]
            verse_phrases = find_distinctive_phrases(verse_text)
            commentary_end = end_pos  # Default: rest of passage

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

### How the AST builder splits passage content into text/interjection children:

```python
# document_model.py:692-731
def create_passage_node(content, reference, detection, interjections):
    children = []
    if interjections:
        sorted_interjections = sorted(interjections, key=lambda i: i.offset_start)
        current_pos = 0
        for interj in sorted_interjections:
            if interj.offset_start > current_pos:
                text_content = content[current_pos:interj.offset_start]
                if text_content:
                    children.append(TextNode(content=text_content))
            children.append(InterjectionNode(content=interj.text, metadata_id=interj.id))
            current_pos = interj.offset_end
        if current_pos < len(content):
            remaining = content[current_pos:]
            if remaining:
                children.append(TextNode(content=remaining))
    else:
        if content:
            children.append(TextNode(content=content))
    # ... creates PassageNode with children
```

### Actual KJV verse text for Galatians 1:6-12 (individual verses):

- **Verse 6**: "I marvel that ye are so soon removed from him that called you into the grace of Christ unto another gospel:"
- **Verse 7**: "Which is not another; but there be some that trouble you, and would pervert the gospel of Christ."
- **Verse 8**: "But though we, or an angel from heaven, preach any other gospel unto you than that which we have preached unto you, let him be accursed."
- **Verse 9**: "As we said before, so say I now again, If any man preach any other gospel unto you than that ye have received, let him be accursed."
- **Verse 10**: "For do I now persuade men, or God? or do I seek to please men? for if I yet pleased men, I should not be the servant of Christ."
- **Verse 11**: "But I certify you, brethren, that the gospel which was preached of me is not after man."
- **Verse 12**: "For I neither received it of man, neither was I taught it, but by the revelation of Jesus Christ."

## Expected Deliverable

A markdown document structured as an implementation plan (following the format of existing plans in the `plan/` directory) with:

- Front matter (goal, version, date, status, tags)
- Introduction section with problem summary
- Requirements and constraints
- Root cause analysis for all 4 bugs
- Detailed implementation steps organized in phases with task tables
- Testing strategy
- Risk assessment
- Verification steps

Title the plan: `plan/fix-interjection-commentary-detection-gaps.md`
