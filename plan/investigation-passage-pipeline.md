# Comprehensive Investigation: Passage Detection, Interjection Identification & AST Building Pipeline

**Date:** Investigation compiled from full source review  
**Files Reviewed:** 17 files (7 source, 5 test, 5 plan)  
**Purpose:** Create a debugging and fix plan for the passage processing pipeline

---

## 1. Pipeline Overview

### End-to-End Data Flow

```
Audio File
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│ whisper_bridge.py :: process_sermon()                            │
│   Orchestrates all stages, emits JSON progress to Electron       │
│                                                                  │
│  Stage 1: transcribe_audio()                                    │
│    └── mlx-whisper (Apple Silicon GPU) → raw_text               │
│                                                                  │
│  Stage 2: extract_metadata() — file metadata (title, etc.)      │
│                                                                  │
│  Stage 3: process_bible_quotes()                                │
│    └── bible_quote_processor.process_text()                     │
│         Phase 1: detect_bible_references() → BibleReference[]   │
│         Phase 2: SKIPPED (no text mutation)                     │
│         Phase 3: Fetch verses + detect translation per-quote    │
│         Phase 4: find_quote_boundaries_improved() per reference │
│                  └── detect_interjections() within each boundary│
│                  └── detect_commentary_blocks() within each     │
│         Phase 4b: verify_quote_boundaries() post-processing     │
│    └── Returns (original_text, QuoteBoundary[])                 │
│                                                                  │
│  Stage 4: segment_paragraphs()                                  │
│    └── main.tokenize_sentences() → SentenceInfo[]               │
│    └── main.segment_into_paragraph_groups()                     │
│         └── EmbeddingGemma-300m → cosine similarity → breaks    │
│         └── Prayer detection (force paragraph breaks)           │
│         └── Quote-aware: don't split inside passages            │
│    └── Returns (sentences, paragraph_groups)                    │
│                                                                  │
│  Stage 5: extract_tags()                                        │
│    └── main.extract_tags() + get_semantic_themes()              │
│         └── EmbeddingGemma-300m → 200+ theological concepts KB  │
│                                                                  │
│  Stage 6: build_ast()                                           │
│    └── ast_builder.build_ast()                                  │
│         └── _filter_passages() — min confidence filter          │
│         └── _map_passages_to_groups() — assign to paragraphs    │
│         └── _enforce_single_paragraph_passages() — merge groups │
│         └── _build_paragraph_nodes()                            │
│              └── _split_group_around_passages()                 │
│                   └── text-before → ParagraphNode               │
│                   └── passage → ParagraphNode(PassageNode)      │
│                   └── text-after → ParagraphNode                │
│              └── _build_passage_node()                          │
│                   └── Interjection offset calculation            │
│    └── Returns ASTBuilderResult (DocumentState + metadata)      │
│                                                                  │
│  → JSON output to Electron main process                         │
└──────────────────────────────────────────────────────────────────┘
```

### Key Architectural Contract

**Immutable Text Principle:** The raw transcript text is NEVER modified by `process_text()`. All `QuoteBoundary.start_pos/end_pos` values reference positions in the original unmodified text. An assertion at the end of `process_text()` enforces this:

```python
# bible_quote_processor.py line ~3596
assert text is _original_input_text, (
    "INVARIANT VIOLATION: process_text() mutated the input text! "
    f"Original length={len(_original_input_text)}, current length={len(text)}. "
    "All QuoteBoundary positions reference the original text — mutation is forbidden."
)
```

This eliminates the entire class of coordinate-space mismatch bugs where mutated-text positions are used to slice original text.

---

## 2. Interjection Detection Logic

### What Are Interjections?

Interjections are brief interruptions speakers make while reading Bible text, such as "a what?", "right?", "amen?". They're part of the sermon's spoken text but NOT part of the Bible verse.

### Detection Location

Interjections are detected in [bible_quote_processor.py](../src/python/bible_quote_processor.py#L2908) by `detect_interjections()`, called within the Phase 4 pipeline after quote boundaries are established.

### Pattern Definitions

```python
# bible_quote_processor.py lines 49-59
INTERJECTION_PATTERNS = [
    r'\ba what\?',
    r'\bright\?',
    r'\bamen\?',
    r'\byes\?',
    r'\bokay\?',
    r'\bhuh\?',
    r'\bwho\?',  # "we will serve who?" style interjections
    # Catch "[word] what?" interjections like "his what?" where speaker pauses
    r'\b(?:his|her|your|my|its|their|a|an|the|to|of|with)\s+what\?',
    # "what?" alone but not "what shall..." (question start)
    r'\bwhat\?(?!\s+(?:shall|is|are|was|were|did|do|does|hath|have|had|should|would|could|can|will|may|might))',
]
```

### Detection Algorithm

```python
# bible_quote_processor.py lines 2908-2948
def detect_interjections(text: str, start_pos: int, end_pos: int) -> List[Tuple[int, int]]:
    quote_text = text[start_pos:end_pos]
    interjections = []

    for pattern in INTERJECTION_PATTERNS:
        for match in re.finditer(pattern, quote_text, re.IGNORECASE):
            # Get absolute positions
            inter_start = start_pos + match.start()
            inter_end = start_pos + match.end()

            # Expand to include surrounding spaces/punctuation
            while inter_start > start_pos and text[inter_start - 1] in ' \t':
                inter_start -= 1
            while inter_end < end_pos and text[inter_end] in ' \t':
                inter_end += 1

            interjections.append((inter_start, inter_end))

    # Sort by position and merge overlapping
    interjections.sort()
    merged = []
    for start, end in interjections:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    return merged
```

### How Interjections Flow to the AST

1. `detect_interjections()` returns `List[Tuple[int, int]]` — absolute positions in raw_text
2. These are stored on `QuoteBoundary.interjection_positions`
3. In `ast_builder.py::_build_passage_node()`, positions are converted to **relative offsets** within the passage content:

```python
# ast_builder.py lines 505-524
if quote.has_interjection and quote.interjection_positions:
    for interj_start, interj_end in quote.interjection_positions:
        rel_start = interj_start - quote.start_pos
        rel_end = interj_end - quote.start_pos
        rel_start = max(0, rel_start)
        rel_end = min(len(content), rel_end)

        if rel_start < rel_end:
            interj_text = content[rel_start:rel_end]
            interjections.append(InterjectionMetadata(
                id=generate_node_id(),
                text=interj_text,
                offset_start=rel_start,
                offset_end=rel_end
            ))
```

4. `create_passage_node()` in `document_model.py` then interleaves text and interjection child nodes:

```python
# document_model.py
def create_passage_node(content, reference, detection, interjections, metadata):
    children = []
    if interjections:
        current = 0
        for interj in sorted(interjections, key=lambda i: i.offset_start):
            if interj.offset_start > current:
                children.append(create_text_node(content[current:interj.offset_start]))
            children.append(InterjectionNode(
                id=interj.id, type='interjection',
                content=interj.text, ...
            ))
            current = interj.offset_end
        if current < len(content):
            children.append(create_text_node(content[current:]))
    else:
        children.append(create_text_node(content))
    # ...
```

### Extending Past Interjections

`extend_quote_past_interjection()` ([bible_quote_processor.py](../src/python/bible_quote_processor.py#L1751)) handles cases where verse content continues after an interjection:

- Example: `"There will your heart be, what? Also."` — "Also." is part of the verse
- Algorithm: Finds remaining unmatched verse words, looks ahead past interjection words (`what`, `right`, `amen`, `yes`, etc.), extends boundary if remaining verse words are found

---

## 3. Passage Boundary Detection

### Primary Function: `find_quote_boundaries_improved()`

**Location:** [bible_quote_processor.py](../src/python/bible_quote_processor.py#L2032)  
**Signature:** `(verse_text, transcript, ref_position, ref_length, debug) → Optional[Tuple[start, end, confidence]]`

### Algorithm Flow

```
1. INTRO PHRASE DETECTION
   extract_reference_intro_length() → effective_ref_length
   Skips past "says", "Paul writes", compound patterns like "says Paul writes"

2. DISTINCTIVE PHRASE EXTRACTION
   find_distinctive_phrases(verse_text) → List of word-window phrases
   Skips common words (but, and, for, etc.)
   Window sizes: 5-word, 4-word, 3-word windows

3. BIDIRECTIONAL SEARCH
   Forward:  [ref_pos + effective_ref_length, ref_pos + 6000]
   Backward: [max(0, ref_pos - 500), ref_pos]

   For each phrase → find_best_phrase_match() in both regions
   Uses fuzzy word matching (_words_match_fuzzy) with equivalents table

4. DIRECTION SELECTION
   Forward preferred (most common sermon pattern)
   Backward fallback with -0.10 confidence penalty

5. CLUSTER ANALYSIS
   Group phrase matches into contiguous clusters
   Evaluate significance (has_start, has_end, phrase_coverage)
   Validate gaps between matches (verse content vs commentary)

6. BOUNDARY DETERMINATION
   Start: earliest match in best cluster
   End: latest match end in best cluster

7. POST-PROCESSING
   validate_start_is_verse_text() — verify start matches verse beginning
   validate_quote_end() — verify end includes complete verse
   extend_quote_past_interjection() — extend past "what?" etc.
   detect_interjections() — find interjections within boundaries
   detect_commentary_blocks() — find explanatory sections
```

### Intro Phrase Patterns

Defined at [bible_quote_processor.py](../src/python/bible_quote_processor.py#L1850):

```python
INTRO_PHRASE_PATTERNS = [
    # Compound: "says Paul writes", "tells us Jesus says"
    r'(?:says?|tells?\s+us)\s+(?:Paul|Jesus|David|...)\s+(?:writes?|says?|...)\s+',
    # Author attribution: "Paul writes", "Jesus says"
    r'(?:Paul|Jesus|David|...)\s+(?:says?|writes?|wrote|said|tells?\s+us)\s+',
    # Simple: "says", "writes", "tells us"
    r'(?:says?|writes?|tells?\s+us|teaches?|declares?|...)\s+',
    # Bible/Scripture: "the Bible says"
    r'(?:the\s+)?(?:Bible|Scripture|Word|Lord)\s+(?:says?|...)\s+',
    # Quote markers: "and I quote"
    r'(?:quote|and\s+I\s+quote)\s*[,:]?\s*',
    # Verse location: "verse X says"
    r'(?:verse\s+\d+\s+)?(?:says?|we\s+read)\s+',
]
```

**Compound pattern handling:** `extract_reference_intro_length()` applies patterns REPEATEDLY until no more matches, catching chains like "says" + "Paul writes".

### Phase 4 Boundary Verification

`verify_quote_boundaries()` ([bible_quote_processor.py](../src/python/bible_quote_processor.py#L2957)) performs post-processing:

1. Re-validates start with `validate_start_is_verse_text()` (searches forward up to 100 chars for verse-first-words match)
2. Re-validates end with `find_verse_end_in_transcript()` (word-by-word matching up to 1500 chars)
3. Applies confidence adjustments based on adjustment magnitude:
   - Adjustment > 50 chars → -0.10 confidence
   - Adjustment > 20 chars → -0.05 confidence
   - End extension → +0.02 confidence

---

## 4. Key Functions Reference

### Bible Quote Processing (`bible_quote_processor.py` — 3742 lines)

| Function                           | Line  | Signature                                                                                    | Purpose                                                                                                        |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `process_text()`                   | ~3100 | `(text, translation, verbose, auto_detect, progress_callback) → (str, List[QuoteBoundary])`  | Main pipeline entry. NEVER mutates text. Returns original text + boundaries.                                   |
| `detect_bible_references()`        | ~600  | `(text, api_client, full_transcript) → List[BibleReference]`                                 | Regex-based detection with ~12 patterns (colon, hyphen, comma, spoken numbers, run-together, verbose chapter). |
| `find_quote_boundaries_improved()` | ~2032 | `(verse_text, transcript, ref_position, ref_length, debug) → Optional[Tuple[int,int,float]]` | Bidirectional distinctive phrase matching. Core boundary detection.                                            |
| `detect_interjections()`           | ~2908 | `(text, start_pos, end_pos) → List[Tuple[int,int]]`                                          | Regex pattern matching within quote boundaries. Returns absolute positions.                                    |
| `detect_commentary_blocks()`       | ~2835 | `(text, start_pos, end_pos, verse_text) → List[Tuple[int,int]]`                              | Detects longer explanatory sections within quotes using commentary patterns + word overlap.                    |
| `detect_translation_for_quote()`   | ~1200 | `(ref, transcript, api_client, verbose) → Tuple[str, str, float]`                            | Per-quote translation detection. Compares multiple translations against transcript text.                       |
| `extract_reference_intro_length()` | ~1893 | `(transcript, ref_position, ref_length, max_intro_length) → int`                             | Calculates skip distance past reference + intro phrases. Applies patterns repeatedly.                          |
| `validate_start_is_verse_text()`   | ~1940 | `(transcript, detected_start, verse_text, max_search_forward, debug) → int`                  | Verifies/adjusts start position to match actual verse beginning.                                               |
| `validate_quote_end()`             | ~1600 | `(transcript, start_pos, end_pos, verse_text, debug) → int`                                  | Validates end position includes complete verse. Can extend or trim.                                            |
| `find_verse_end_in_transcript()`   | ~1500 | `(transcript, start_pos, verse_text, max_search, debug) → Optional[int]`                     | Word-by-word matching to find where verse text ends in transcript.                                             |
| `extend_quote_past_interjection()` | ~1751 | `(transcript, current_end, verse_text, max_look_ahead) → int`                                | Extends boundary past interjection to include trailing verse words.                                            |
| `verify_quote_boundaries()`        | ~2957 | `(quote, transcript, verbose) → QuoteBoundary`                                               | Phase 4 post-processing. Adjusts start/end and updates confidence.                                             |
| `detect_matching_verse_subset()`   | ~2475 | `(individual_verses, transcript, search_start, ...) → Tuple[first, last, matches]`           | For verse ranges, detects which verses actually appear. Handles skip-words.                                    |
| `find_distinctive_phrases()`       | ~1100 | `(verse_text) → List[List[str]]`                                                             | Extracts word-window phrases, skipping common words (but, and, for...).                                        |
| `find_best_phrase_match()`         | ~1150 | `(phrases, transcript, start, end) → Optional[Tuple[int,int,float,int]]`                     | Searches for phrase in transcript region with fuzzy word matching.                                             |
| `_words_match_fuzzy()`             | ~1050 | `(word1, word2) → bool`                                                                      | Fuzzy matching with equivalents table (thee/you, hath/has, unto/to...).                                        |
| `normalize_for_comparison()`       | ~1000 | `(text) → str`                                                                               | Lowercase, strip punctuation, normalize whitespace.                                                            |
| `split_runtogether_number()`       | ~900  | `(text, ...) → str`                                                                          | Splits "633" into "6:33" via API verification + transcript matching.                                           |
| `BibleAPIClient`                   | ~80   | class                                                                                        | Bolls.life API wrapper with caching, rate limiting, HTML cleaning.                                             |

### AST Builder (`ast_builder.py` — 602 lines)

| Function                               | Line | Signature                                                                                  | Purpose                                                                          |
| -------------------------------------- | ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `build_ast()`                          | ~551 | `(raw_text, sentences, paragraph_groups, quote_boundaries, title, ...) → ASTBuilderResult` | Top-level entry point. Creates ASTBuilder and calls build().                     |
| `ASTBuilder.build()`                   | ~120 | `() → ASTBuilderResult`                                                                    | Orchestrates: filter → map → enforce → build paragraphs → create document.       |
| `_filter_passages()`                   | ~180 | `(quotes) → List[QuoteBoundary]`                                                           | Filters by min_quote_confidence (default 0.4).                                   |
| `_map_passages_to_groups()`            | ~220 | `(passages, groups, sentences) → Dict[int, List[QuoteBoundary]]`                           | Maps passages to paragraph groups by START position (not overlap).               |
| `_enforce_single_paragraph_passages()` | ~310 | `(groups, passages, sentences) → List[List[int]]`                                          | Merges paragraph groups when a passage spans multiple.                           |
| `_build_paragraph_nodes()`             | ~365 | `(raw_text, sentences, groups, group_passage_map) → List[ParagraphNode]`                   | Builds paragraph nodes, delegates to \_split_group_around_passages for passages. |
| `_split_group_around_passages()`       | ~400 | `(raw_text, group_start, group_end, group_text, passages) → List[ParagraphNode]`           | Splits paragraph into text-before, passage (isolated), text-after nodes.         |
| `_build_passage_node()`                | ~480 | `(quote, content) → PassageNode`                                                           | Builds PassageNode with reference metadata, detection metadata, interjections.   |
| `_verify_content_match()`              | ~460 | `(passage, extracted_content)`                                                             | Debug: checks word overlap between extracted content and expected verse text.    |

### Main Pipeline (`main.py` — 995 lines)

| Function                          | Line | Signature                                              | Purpose                                                              |
| --------------------------------- | ---- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `transcribe_audio()`              | ~393 | `(file_path) → str`                                    | mlx-whisper transcription with balanced params.                      |
| `tokenize_sentences()`            | ~70  | `(text) → List[SentenceInfo]`                          | Regex split on `(?<=[.!?])\s+`. Returns sentences with positions.    |
| `segment_into_paragraph_groups()` | ~440 | `(sentences, quote_boundaries, ...) → List[List[int]]` | Semantic similarity segmentation with prayer detection. Quote-aware. |
| `extract_tags()`                  | ~757 | `(text, quote_boundaries) → List[str]`                 | Semantic tag extraction using theological concepts KB.               |
| `get_semantic_themes()`           | ~800 | `(text, quote_boundaries) → List[str]`                 | EmbeddingGemma-based concept matching (cosine similarity).           |
| `compute_concept_embeddings()`    | ~850 | `() → Tuple[embeddings, names]`                        | Lazily computed + cached embeddings for 200+ theological concepts.   |

### Whisper Bridge (`whisper_bridge.py` — 962 lines)

| Function                 | Line | Signature                                                  | Purpose                                                               |
| ------------------------ | ---- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `process_sermon()`       | ~700 | `(file_path, settings) → dict`                             | Main orchestrator. Clears cache, runs all stages, returns AST JSON.   |
| `process_bible_quotes()` | ~430 | `(text, auto_detect, verbose) → Tuple[str, quotes, refs]`  | Wrapper around process_text(). Returns ORIGINAL text (not processed). |
| `segment_paragraphs()`   | ~560 | `(text, quote_boundaries, ...) → Tuple[sentences, groups]` | Wrapper around tokenize + segment.                                    |
| `build_ast()`            | ~620 | `(raw_text, sentences, groups, quotes, ...) → dict`        | Wrapper around ast_builder.build_ast(). Returns JSON dict.            |

### Embedding Model (`embedding_model.py`)

| Function                    | Signature                              | Purpose                                                     |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `EmbeddingModel.__init__()` | `(model_name, batch_size)`             | Loads EmbeddingGemma-300m-4bit via mlx-embeddings.          |
| `encode()`                  | `(texts, task) → np.ndarray`           | Batch encoding with task prefixes. Returns 768-dim vectors. |
| `similarity()`              | `(text1, text2, task) → float`         | Cosine similarity between two texts.                        |
| `batch_similarities()`      | `(source, targets, task) → np.ndarray` | One-to-many cosine similarity.                              |

---

## 5. Embedding Model Usage

### Model: EmbeddingGemma-300m-4bit

- **Repository:** `mlx-community/embeddinggemma-300m-4bit`
- **Dimensions:** 768
- **Framework:** mlx-embeddings (Apple Silicon optimized)
- **Quantization:** 4-bit (memory efficient)

### Usage Points

**1. Paragraph Segmentation** (`main.py::segment_into_paragraph_groups()`):

- Task prefix: `semantic_similarity`
- Computes pairwise cosine similarity between consecutive sentences
- Break threshold: `similarity_threshold=0.45` (from whisper_bridge call) or `0.55` (default)
- Rolling window smoothing (`window_size=3`)
- Minimum sentences per paragraph: 5 (overridable)

**2. Tag Extraction** (`main.py::get_semantic_themes()`):

- Task prefix: `classification`
- Compares sermon text embedding against 200+ theological concept embeddings
- Knowledge base: `THEOLOGICAL_CONCEPTS_KB` (core doctrines, practices, themes, narratives, characters)
- Similarity threshold for inclusion: concepts above a threshold are returned as tags
- Concept embeddings are computed once and cached in module-level variables

### NOT Used For:

- Quote boundary detection (uses regex + fuzzy string matching instead)
- Translation detection (uses word overlap counting)
- Interjection detection (uses regex patterns)

---

## 6. Known Issues from Plans

### 6.1 Coordinate Space Mismatch (FIXED — `fix-ast-bible-passage-boundary-alignment.md`)

**Status:** Fixed via immutability contract  
**Root Cause:** `process_text()` formerly mutated text by normalizing references ("Romans 12 one" → "Romans 12:1") before detecting boundaries. QuoteBoundary positions lived in mutated-text space, but AST builder sliced from original text. Every normalization that changed length shifted all subsequent positions.

**Fix:** Eliminated text mutation entirely. Phase 2 (normalization) is SKIPPED. Normalized forms stored as metadata via `reference.to_standard_format()`. Immutability assertion added at end of `process_text()`.

### 6.2 Passage-to-Paragraph Mapping Bug (COMPLETED — `refactor-ast-passage-boundary-fix-1.md`)

**Status:** Completed  
**Root Cause:** `_map_quotes_to_paragraphs()` used overlap-based mapping which could assign a passage to the WRONG paragraph. When combined with relative position clamping, this produced passage nodes containing wrong text (e.g., "his face." instead of "I beseech you therefore...").

**Fixes Applied:**

1. Changed to START-position-based mapping
2. Added `_enforce_single_paragraph_passages()` — merges groups when passage spans multiple
3. Content normalization to remove internal `\n\n` in passages
4. Debug logging infrastructure

### 6.3 Bidirectional Search (COMPLETED — `refactor-passage-boundary-detection-1.md`)

**Status:** Completed  
**Root Cause:** `find_quote_boundaries_improved()` only searched forward. When intro phrase detection was incomplete (e.g., "says Paul writes"), the forward search started too late and missed the actual verse text.

**Fixes Applied:**

1. Bidirectional search (forward + backward with 500-char backward window)
2. Intro phrase regex patterns expanded (compound patterns like "says Paul writes")
3. `extract_reference_intro_length()` applies patterns repeatedly for chains
4. Confidence adjustments: proximity bonus (+0.05), backward penalty (-0.10)

### 6.4 Passage Structural Isolation (PLANNED — `refactor-passage-structure-isolation-1.md`)

**Status:** Planned (but core isolation already implemented in current code)  
**Issues Addressed:**

1. **Structural:** Passages must be sole child of paragraph — **already implemented** in `_split_group_around_passages()`
2. **Start boundary:** Passage text may include intro text — compound intro patterns added but may still miss edge cases
3. **End boundary:** Passage text may exclude final verse words — `validate_quote_end()` and `find_verse_end_in_transcript()` attempt correction

**Remaining Planned Work:**

- TASK-008/009: Expand intro patterns further
- TASK-010-013: Additional start validation
- TASK-014-019: End boundary extension refinement
- TASK-020-024: Integration with verified boundary positions
- TASK-025-032: Comprehensive test suite

### 6.5 Sermon-Only Processing (PLANNED — `feature-sermon-only-processing-1.md`)

**Status:** Planned  
**Summary:** Remove "Process as sermon" checkbox, always process as sermon. Clean up types, IPC, UI routes. Not directly related to passage detection but affects pipeline entry points.

---

## 7. Configuration & Thresholds

### Bible Quote Processing Thresholds

| Constant                          | Value      | Location  | Purpose                                                   |
| --------------------------------- | ---------- | --------- | --------------------------------------------------------- |
| `QUOTE_MATCH_THRESHOLD`           | 0.60       | bqp:46    | Minimum similarity ratio for phrase match                 |
| `QUOTE_START_THRESHOLD`           | 0.70       | bqp:47    | Higher threshold for quote start detection                |
| `API_RATE_LIMIT_DELAY`            | 0.5s       | bqp:38    | Delay between Bolls.life API calls                        |
| `MAX_GAP_BETWEEN_PHRASES`         | 300        | bqp:~2200 | Max chars between phrase matches in cluster               |
| `MIN_GAP_TO_VALIDATE`             | 30         | bqp:~2250 | Only validate gaps larger than this                       |
| `MAX_GAP_BETWEEN_VERSES`          | 500        | bqp:~2680 | Max chars between verses in subset detection              |
| Forward search window             | 6000 chars | bqp:~2070 | How far forward to search for verse text                  |
| Backward search window            | 500 chars  | bqp:~2075 | How far backward to search                                |
| Proximity bonus                   | +0.05      | bqp:~2350 | Confidence boost for quotes within 100 chars of reference |
| Backward penalty                  | -0.10      | bqp:~2350 | Confidence penalty for backward-direction matches         |
| Boundary verification > 50 chars  | -0.10      | bqp:~3035 | Confidence penalty for large adjustments                  |
| Boundary verification > 20 chars  | -0.05      | bqp:~3037 | Confidence penalty for moderate adjustments               |
| End extension boost               | +0.02      | bqp:~3039 | Confidence bonus when end is extended                     |
| Single-verse extension confidence | 0.80       | bqp:~2570 | Higher threshold for verses beyond announced range        |
| Start validation search forward   | 100 chars  | bqp:~1960 | `validate_start_is_verse_text` search range               |
| End validation search             | 1500 chars | bqp:~3005 | `find_verse_end_in_transcript` search range               |
| Intro phrase max search           | 150 chars  | bqp:~1900 | How far past reference to look for intro phrases          |

### AST Builder Configuration

| Parameter                | Value | Location | Purpose                                      |
| ------------------------ | ----- | -------- | -------------------------------------------- |
| `min_quote_confidence`   | 0.4   | ast:76   | Minimum confidence to include passage in AST |
| `include_low_confidence` | True  | ast:77   | Whether to include low-confidence passages   |
| `max_text_node_length`   | 10000 | ast:79   | Maximum characters in a single text node     |

### Paragraph Segmentation

| Parameter                     | Value | Location  | Purpose                                                      |
| ----------------------------- | ----- | --------- | ------------------------------------------------------------ |
| `similarity_threshold`        | 0.45  | wb:~570   | Cosine similarity threshold for topic change (pipeline call) |
| `similarity_threshold`        | 0.55  | main:~440 | Default threshold (direct call)                              |
| `min_sentences_per_paragraph` | 5     | main:~440 | Minimum before allowing a break                              |
| `window_size`                 | 3     | main:~440 | Rolling average smoothing window                             |

### Confidence Levels

```python
# document_model.py
def get_confidence_level(confidence: float) -> str:
    if confidence >= 0.8: return 'high'
    if confidence >= 0.6: return 'medium'
    if confidence >= 0.4: return 'low'
    return 'very_low'
```

### Fuzzy Word Matching Equivalents

```python
# bible_quote_processor.py (within _words_match_fuzzy)
WORD_EQUIVALENTS = {
    'thee': 'you', 'thou': 'you', 'thy': 'your', 'thine': 'your',
    'hath': 'has', 'doth': 'does', 'shalt': 'shall',
    'unto': 'to', 'amongst': 'among', 'whilst': 'while',
    'saith': 'says', 'cometh': 'comes', 'goeth': 'goes',
    # ... and more KJV ↔ modern equivalents
}
```

---

## 8. Exact Flow for a Single Passage (Galatians 1:6-12)

Tracing what happens when a sermon contains: _"...and the Apostle Paul writes in Galatians chapter one verses six through twelve I marvel that ye are so soon removed..."_

### Step 1: Reference Detection

`detect_bible_references()` processes the transcript with regex patterns:

```
Pattern match: "Galatians chapter one verses six through twelve"
                ↓
BibleReference(
    book="Galatians",
    chapter=1,
    verse_start=6,
    verse_end=12,
    position=<char offset of "Galatians" in raw_text>,
    original_text="Galatians chapter one verses six through twelve"
)
```

The spoken number patterns handle "chapter one" → `chapter=1`, "six through twelve" → `verse_start=6, verse_end=12`.

### Step 2: Phase 2 SKIPPED

No text mutation. "Galatians chapter one verses six through twelve" stays in the raw text as-is. `reference.to_standard_format()` → `"Galatians 1:6-12"` available for display only.

### Step 3: Verse Fetching + Translation Detection

Per-quote translation detection:

1. Fetch Galatians 1:6-12 from Bolls.life in KJV, NKJV, NIV, ESV (etc.)
2. Compare each translation's text against the transcript region near the reference
3. KJV likely wins for "I marvel that ye are so soon removed" (KJV uses "ye")
4. Store: `verse_texts[cache_key] = "I marvel that ye are so soon removed from him that called you..."`
5. Also fetch individual verses 6-12 into `individual_verses_cache` for subset detection

### Step 4: Quote Boundary Detection

`find_quote_boundaries_improved(verse_text, transcript, ref_position, ref_length)`:

**4a. Intro Phrase Detection:**

```
After "Galatians chapter one verses six through twelve":
  → "I marvel" ← NO intro pattern matches, so effective_ref_length = len(original_text)

BUT if the text is "...writes in Galatians chapter one verses six through twelve I marvel..."
  → The word "writes" appears BEFORE the reference, not after it
  → extract_reference_intro_length only looks AFTER the reference
  → No intro pattern matched, forward search starts right after reference text
```

**4b. Phrase Extraction:**

```
find_distinctive_phrases("I marvel that ye are so soon removed from him..."):
  → ["marvel that ye", "so soon removed", "from him that", "called you into", ...]
  (skips: "and", "the", "of", etc.)
```

**4c. Forward Search:**

```
Search region: [ref_pos + ref_length, ref_pos + 6000]
For each phrase, find_best_phrase_match():
  "marvel that ye" → found at position X, score 0.85
  "so soon removed" → found at position X+20, score 0.90
  ... etc.
```

**4d. Cluster Analysis:**

```
Group matches by proximity (MAX_GAP_BETWEEN_PHRASES = 300)
Best cluster: [X, X+20, X+45, ..., X+200]
  has_start=True (first phrase match near beginning)
  has_end=True (last phrase match near end)
  phrase_coverage=0.75
```

**4e. Boundary Determination:**

```
start_pos = earliest match in cluster = X
end_pos = latest match end in cluster = X+200
confidence = base(0.75) + proximity_bonus(0.05) = 0.80
```

### Step 5: Verse Subset Detection

Since this is a verse RANGE (6-12), `detect_matching_verse_subset()` runs:

1. For each verse 6-12, extract 6-word anchor from verse text
2. Search for each anchor in transcript near the quote
3. Determine which verses actually appear (e.g., speaker only read 6-10)
4. Return `(first_verse=6, last_verse=10, matches=[...])`
5. If subset differs from announced range, `find_quote_boundaries_with_subset()` recomputes boundaries

### Step 6: Post-Processing

**6a. Start Validation:** `validate_start_is_verse_text()` checks if first 5 words at `start_pos` match first 5 words of verse text. If not, searches forward up to 100 chars.

**6b. End Validation:** `validate_quote_end()` checks if last words are in verse text. `find_verse_end_in_transcript()` does word-by-word matching to find true end.

**6c. Interjection Detection:** `detect_interjections()` scans within [start_pos, end_pos] for patterns.

**6d. Boundary Verification:** `verify_quote_boundaries()` re-validates start/end, applies confidence adjustments.

### Step 7: QuoteBoundary Created

```python
QuoteBoundary(
    start_pos=X,           # Position of "I" in "I marvel..."
    end_pos=Y,             # Position after last verse word
    reference=BibleReference(book="Galatians", chapter=1, verse_start=6, verse_end=12),
    verse_text="I marvel that ye are so soon removed...",
    confidence=0.82,
    translation="KJV",
    has_interjection=True/False,
    interjection_positions=[(a,b), ...],
    boundary_verified=True,
    start_adjustment=0,
    end_adjustment=+15
)
```

### Step 8: Paragraph Segmentation

`segment_into_paragraph_groups()` processes all sentences:

- Computes embeddings for all sentences
- Calculates cosine similarity between consecutive sentences
- When similarity drops below 0.45 and min_sentences met → paragraph break
- **Quote-aware:** checks if proposed break would split inside [start_pos, end_pos] of any quote — if so, prevents the break

### Step 9: AST Building

1. `_filter_passages()`: confidence 0.82 ≥ 0.4 threshold → included
2. `_map_passages_to_groups()`: finds which paragraph group contains `start_pos`
3. `_enforce_single_paragraph_passages()`: if passage spans groups, merge them
4. `_build_paragraph_nodes()` → `_split_group_around_passages()`:

```
Original group text: "...the Apostle Paul writes in Galatians chapter one
  verses six through twelve I marvel that ye are so soon removed...
  unto the grace of Christ. What is Paul saying here?"

Split into:
  ParagraphNode(TextNode("...the Apostle Paul writes in Galatians chapter
    one verses six through twelve"))
  ParagraphNode(PassageNode(
    content="I marvel that ye are so soon removed...unto the grace of Christ.",
    reference=BibleReferenceMetadata(book="Galatians", chapter=1, ...),
    detection=QuoteDetectionMetadata(confidence=0.82, translation="KJV", ...),
    children=[TextNode("I marvel..."), InterjectionNode("a what?"), TextNode("...Christ.")]
  ))
  ParagraphNode(TextNode("What is Paul saying here?"))
```

### Step 10: Final AST Structure

```json
{
  "type": "document",
  "children": [
    {
      "type": "paragraph",
      "children": [
        {
          "type": "text",
          "content": "...the Apostle Paul writes in Galatians chapter one verses six through twelve"
        }
      ]
    },
    {
      "type": "paragraph",
      "children": [
        {
          "type": "passage",
          "metadata": {
            "reference": { "book": "Galatians", "chapter": 1, "verseStart": 6, "verseEnd": 12 },
            "quoteDetection": { "confidence": 0.82, "translation": "KJV" }
          },
          "children": [
            { "type": "text", "content": "I marvel that ye are so soon removed..." },
            { "type": "interjection", "content": "a what?" },
            { "type": "text", "content": "...unto the grace of Christ." }
          ]
        }
      ]
    },
    {
      "type": "paragraph",
      "children": [{ "type": "text", "content": "What is Paul saying here?" }]
    }
  ]
}
```

---

## Appendix: Test Coverage Summary

| Test File                        | Tests                    | Focus                                                                                                          |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `test_ast_passage_boundaries.py` | 6                        | Passage mapping by start position, single-paragraph constraint, coordinate consistency, text immutability      |
| `test_boundary_detection.py`     | ~5                       | Intro phrase detection, bidirectional search, full pipeline with test transcript                               |
| `test_passage_isolation.py`      | 8 (TASK-025 to TASK-032) | Romans 12:1 structural isolation, start/end boundaries, multiple passages, interjections, TipTap compatibility |
| `test_tag_extraction.py`         | ~4                       | Semantic themes, concept embeddings, no-KeyBERT dependency                                                     |
| `test_e2e_pipeline.py`           | 1                        | Full pipeline verifying passage content correctness ("I beseech" starts correctly)                             |

**Missing Test Coverage:**

- Galatians-style verse ranges with spoken numbers
- Backward-direction quotes (rare but possible)
- Commentary block detection accuracy
- Fuzzy matching edge cases (KJV ↔ modern equivalents)
- Multiple references to same verse at different positions
- Very long quotes (>1000 chars)
- Quotes near start/end of transcript
