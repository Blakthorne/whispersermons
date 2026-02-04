#!/usr/bin/env python3
"""
WhisperSermons Python Bridge

This module provides a JSON-based subprocess interface for the Electron app to:
1. Transcribe audio using OpenAI Whisper
2. Process sermon transcripts (Bible quotes, paragraphs, tags)
3. Extract audio metadata (Title, Comment for sermon mode)

Protocol: Reads JSON commands from stdin, writes JSON responses to stdout.
Progress updates are sent as JSON lines with {"type": "progress", ...}
"""

import sys
import json
import os
import traceback
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple, Callable

# Ensure proper stdout encoding for JSON output
sys.stdout.reconfigure(encoding='utf-8')  # type: ignore[union-attr]
sys.stderr.reconfigure(encoding='utf-8')  # type: ignore[union-attr]

# ============================================================================
# CUSTOM TQDM FOR PROGRESS TRACKING
# ============================================================================
# This MUST be defined before importing whisper, as whisper uses tqdm internally

_transcription_progress_callback: Optional[Callable[[int, str], None]] = None

def _emit_transcription_progress(percent: int, message: str):
    """Internal function to emit transcription progress."""
    progress = {
        "type": "progress",
        "stage": 1,
        "stageName": "Transcribing audio",
        "percent": percent,
        "message": message
    }
    print(json.dumps(progress), flush=True)


class WhisperProgressTqdm:
    """
    Custom tqdm replacement that emits JSON progress updates.
    This captures Whisper's internal transcription progress.
    """
    def __init__(self, iterable=None, total=None, unit="it", disable=False, **kwargs):
        self.iterable = iterable
        self.total = total if total is not None else (len(iterable) if iterable and hasattr(iterable, '__len__') else 0)
        self.n = 0
        self.unit = unit
        self.disabled = disable
        self._last_percent = 0
        
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        pass
    
    def __iter__(self):
        if self.iterable:
            for item in self.iterable:
                yield item
                self.update(1)
    
    def update(self, n=1):
        """Update progress and emit JSON progress event."""
        self.n += n
        if not self.disabled and self.total > 0:
            # Calculate actual progress (0-100)
            progress = min(self.n / self.total, 1.0)
            # Map to 30-90% range for transcription phase
            # (25% is start, 30% is "processing", 90% is before finalization)
            mapped_percent = int(30 + progress * 60)
            
            # Only emit if percent changed by at least 1%
            if mapped_percent > self._last_percent:
                self._last_percent = mapped_percent
                percent_display = int(progress * 100)
                _emit_transcription_progress(
                    mapped_percent,
                    f"Transcribing: {percent_display}%"
                )
    
    def set_description(self, desc=None):
        """Compatibility method - ignored."""
        pass
    
    def set_postfix(self, **kwargs):
        """Compatibility method - ignored."""
        pass
    
    def close(self):
        """Compatibility method - ignored."""
        pass
    
    def refresh(self):
        """Compatibility method - ignored."""
        pass


# Monkey-patch tqdm BEFORE importing whisper
# This allows us to capture whisper's internal progress
import tqdm as _tqdm_module
_original_tqdm = _tqdm_module.tqdm
_tqdm_module.tqdm = WhisperProgressTqdm

# Configure model cache directory (will be set by Electron)
WHISPER_CACHE_DIR = os.environ.get('WHISPER_CACHE_DIR', None)
if WHISPER_CACHE_DIR:
    os.environ['XDG_CACHE_HOME'] = WHISPER_CACHE_DIR

# ============================================================================
# PROGRESS REPORTING
# ============================================================================

def emit_progress(stage: int, stage_name: str, percent: int, message: str = ""):
    """Emit a progress update to stdout as JSON."""
    progress = {
        "type": "progress",
        "stage": stage,
        "stageName": stage_name,
        "percent": percent,
        "message": message
    }
    print(json.dumps(progress), flush=True)


def emit_stage_complete(stage: int, stage_name: str):
    """Emit a stage completion marker."""
    emit_progress(stage, stage_name, 100, "Complete")


def emit_error(error: str, stage: Optional[int] = None):
    """Emit an error to stdout as JSON."""
    result = {
        "type": "error",
        "error": error,
        "stage": stage
    }
    print(json.dumps(result), flush=True)


def emit_result(data: Dict[str, Any]):
    """Emit the final result to stdout as JSON."""
    result = {
        "type": "result",
        **data
    }
    print(json.dumps(result), flush=True)


# ============================================================================
# LAZY IMPORTS (loaded on demand to improve startup time)
# ============================================================================

_whisper_model = None
_semantic_model = None
_tag_model = None
_device = None


def get_device():
    """Detect and return the best available device (MPS/CUDA/CPU)."""
    global _device
    if _device is not None:
        return _device
    
    import torch
    if torch.backends.mps.is_available():
        _device = "mps"
    elif torch.cuda.is_available():
        _device = "cuda"
    else:
        _device = "cpu"
    return _device


def get_whisper_model(model_name: str = "medium"):
    """Load Whisper model (cached after first load)."""
    global _whisper_model
    
    # If model is already loaded with same name, return it
    if _whisper_model is not None and hasattr(_whisper_model, '_model_name') and _whisper_model._model_name == model_name:
        return _whisper_model
    
    import whisper
    device = get_device()
    emit_progress(1, "Loading Whisper model", 10, f"Loading {model_name} model...")
    _whisper_model = whisper.load_model(model_name, device=device)
    setattr(_whisper_model, '_model_name', model_name)  # Tag for caching
    emit_progress(1, "Loading Whisper model", 20, f"Model loaded on {device}")
    return _whisper_model


def get_semantic_model():
    """Load sentence transformer for paragraph segmentation."""
    global _semantic_model
    if _semantic_model is not None:
        return _semantic_model
    
    from sentence_transformers import SentenceTransformer
    device = get_device()
    _semantic_model = SentenceTransformer('all-MiniLM-L6-v2')
    if device == "mps":
        _semantic_model = _semantic_model.to(device)
    return _semantic_model


def get_tag_model():
    """Load high-quality model for tag extraction."""
    global _tag_model
    if _tag_model is not None:
        return _tag_model
    
    from sentence_transformers import SentenceTransformer
    device = get_device()
    _tag_model = SentenceTransformer('all-mpnet-base-v2')
    if device == "mps":
        _tag_model = _tag_model.to(device)
    return _tag_model


# ============================================================================
# METADATA EXTRACTION
# ============================================================================

def extract_audio_metadata(file_path: str) -> Dict[str, Optional[str]]:
    """
    Extract Title, Comment, and Authors metadata from audio file.
    
    Supports multiple audio formats including MP3, M4A/AAC, FLAC, OGG, etc.
    
    Returns:
        Dict with 'title', 'comment', and 'authors' keys (values may be None if not found)
    """
    try:
        from mutagen._file import File as MutagenFile
        from mutagen.easyid3 import EasyID3
        from mutagen.id3 import ID3
        
        audio = MutagenFile(file_path, easy=True)
        
        title = None
        comment = None
        authors = None
        
        if audio is not None:
            # Try to get title
            if 'title' in audio:
                title = str(audio['title'][0]) if audio['title'] else None
            
            # Try to get comment - this is trickier as it varies by format
            if 'comment' in audio:
                comment = str(audio['comment'][0]) if audio['comment'] else None
            
            # Try to get authors/artist - check various common field names
            # The "Authors" field in audio metadata is typically stored as "artist"
            # but can also be "author", "albumartist", "composer", or "performer"
            for field in ['artist', 'author', 'albumartist', 'composer', 'performer']:
                if field in audio and audio[field]:
                    authors = str(audio[field][0])
                    break
        
        # For MP3 files, also try the full ID3 tags for comments and authors
        if file_path.lower().endswith('.mp3'):
            try:
                id3 = ID3(file_path)
                
                # Comments can be in various frames
                if comment is None:
                    for key in id3.keys():
                        if key.startswith('COMM'):
                            comment = str(id3[key].text[0]) if id3[key].text else None
                            if comment:
                                break
                
                # Check for author in TPE1 (Lead performer/soloist), TPE2 (Band), TEXT (Lyricist/Text writer)
                if authors is None:
                    for frame_id in ['TPE1', 'TPE2', 'TPE3', 'TPE4', 'TCOM', 'TEXT']:
                        if frame_id in id3:
                            frame_val = id3[frame_id].text[0] if id3[frame_id].text else None
                            if frame_val:
                                authors = str(frame_val)
                                break
            except Exception:
                pass
        
        # For M4A/AAC files, try specific atoms
        if file_path.lower().endswith(('.m4a', '.m4b', '.mp4', '.aac')):
            try:
                from mutagen.mp4 import MP4
                mp4 = MP4(file_path)
                
                if mp4.tags:
                    # M4A uses different key format: ©ART for artist, ©wrt for composer, etc.
                    if authors is None:
                        for key in ['©ART', '©wrt', 'aART', '----:com.apple.iTunes:AUTHOR']:
                            if key in mp4.tags:
                                val = mp4.tags[key]
                                if val:
                                    authors = str(val[0]) if isinstance(val, list) else str(val)
                                    break
                    
                    if title is None and '©nam' in mp4.tags:
                        val = mp4.tags['©nam']
                        title = str(val[0]) if isinstance(val, list) else str(val)
                    
                    if comment is None and '©cmt' in mp4.tags:
                        val = mp4.tags['©cmt']
                        comment = str(val[0]) if isinstance(val, list) else str(val)
            except Exception:
                pass
        
        return {
            'title': title,
            'comment': comment,
            'authors': authors
        }
    except ImportError:
        return {'title': None, 'comment': None, 'authors': None, 'error': 'mutagen not installed'}
    except Exception as e:
        return {'title': None, 'comment': None, 'authors': None, 'error': str(e)}


# ============================================================================
# TRANSCRIPTION
# ============================================================================

def transcribe_audio(
    file_path: str,
    model_name: str = "medium",
    language: str = "en",
    on_progress: Optional[Any] = None
) -> str:
    """
    Transcribe audio using OpenAI Whisper with optimized parameters.
    
    Args:
        file_path: Path to audio/video file
        model_name: Whisper model name (tiny, base, small, medium, large-v3, etc.)
        language: Language code or 'auto' for auto-detection
        on_progress: Optional callback for progress updates
    
    Returns:
        Transcribed text
    """
    model = get_whisper_model(model_name)
    device = get_device()
    
    emit_progress(1, "Transcribing audio", 25, "Starting transcription...")
    
    # Prepare transcription parameters
    transcribe_kwargs = {
        'temperature': (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),  # Temperature fallback cascade
        'compression_ratio_threshold': 2.4,  # Detect repetitions
        'logprob_threshold': -1.0,  # Filter low-confidence segments
        'no_speech_threshold': None,  # DISABLED - prevents skipping audio segments
        'condition_on_previous_text': True,  # Use context from previous segments
        'verbose': False,  # Enable tqdm progress bar (our custom one captures it)
        'fp16': device in ('mps', 'cuda'),  # Half-precision on GPU
        'initial_prompt': "This is a clear audio recording of speech."
    }
    
    # Only set language if not 'auto'
    if language and language != 'auto':
        transcribe_kwargs['language'] = language
    
    # The progress is now tracked via our custom tqdm wrapper
    # which automatically emits progress as Whisper processes audio frames
    emit_progress(1, "Transcribing audio", 28, "Processing audio segments...")
    
    result = model.transcribe(file_path, **transcribe_kwargs)
    
    emit_progress(1, "Transcribing audio", 95, "Finalizing transcription...")
    emit_stage_complete(1, "Transcribing audio")
    
    return str(result["text"])


# ============================================================================
# BIBLE PROCESSING (imports from bible_quote_processor)
# ============================================================================

def process_bible_quotes(
    text: str,
    auto_detect_translation: bool = True,
    verbose: bool = False
) -> Tuple[str, List[Any], List[str]]:
    """
    Process Bible quotes in the transcript.
    
    Args:
        text: Raw transcript text
        auto_detect_translation: Whether to auto-detect translation per quote
        verbose: Whether to print debug info
    
    Returns:
        Tuple of (processed_text, quote_boundaries, scripture_references)
    """
    emit_progress(3, "Processing Bible quotes", 0, "Loading Bible processor...")
    
    # Import the bible processor (from same directory)
    from bible_quote_processor import process_text
    
    # Create progress callback to report granular progress
    def bible_progress_callback(percent: int, message: str):
        """Forward progress from Bible processor to main progress system."""
        # Scale Bible processor progress (0-100) to our stage range (5-90)
        # Reserve 0-5 for loading and 90-100 for finalizing
        scaled_percent = 5 + int(percent * 0.85)
        emit_progress(3, "Processing Bible quotes", scaled_percent, message)
    
    emit_progress(3, "Processing Bible quotes", 5, "Detecting quotes and references...")
    
    processed_text, quote_boundaries = process_text(
        text,
        translation="",  # Empty string = auto-detect per quote
        auto_detect=auto_detect_translation,
        verbose=verbose,
        progress_callback=bible_progress_callback
    )
    
    emit_progress(3, "Processing Bible quotes", 92, "Extracting scripture references...")
    
    # Extract unique references and merge overlapping ones
    scripture_refs = merge_overlapping_references(quote_boundaries)
    
    # We return the original text here because we want subsequent stages (paragraphing, AST)
    # to work with the original offsets from quote_boundaries. 
    # The decorative quotation marks will be added by the renderer.
    return text, quote_boundaries, scripture_refs


def merge_overlapping_references(quote_boundaries: Optional[List[Any]]) -> List[str]:
    """
    Merge overlapping Bible references into consolidated ranges.
    
    For example:
    - "Matthew 2:1-12" and "Matthew 2:4-16" become "Matthew 2:1-16"
    - "John 3:16" and "John 3:17" become "John 3:16-17"
    
    Args:
        quote_boundaries: List of QuoteBoundary objects with reference info
        
    Returns:
        List of merged reference strings
    """
    if not quote_boundaries:
        return []
    
    # Group references by book and chapter
    grouped: Dict[Tuple[str, int], List[Tuple[int, int]]] = {}
    
    for qb in quote_boundaries:
        ref = qb.reference
        key = (ref.book, ref.chapter)
        
        # Get verse range (treat None as chapter-only reference)
        verse_start = ref.verse_start if ref.verse_start is not None else 1
        verse_end = ref.verse_end if ref.verse_end is not None else (
            ref.verse_start if ref.verse_start is not None else 999
        )
        
        if key not in grouped:
            grouped[key] = []
        grouped[key].append((verse_start, verse_end))
    
    # Merge overlapping ranges within each book/chapter
    merged_refs = []
    
    for (book, chapter), ranges in grouped.items():
        # Sort ranges by start verse
        ranges.sort(key=lambda x: x[0])
        
        # Merge overlapping or adjacent ranges
        merged_ranges = []
        for start, end in ranges:
            if merged_ranges and start <= merged_ranges[-1][1] + 1:
                # Overlapping or adjacent - extend the previous range
                merged_ranges[-1] = (merged_ranges[-1][0], max(merged_ranges[-1][1], end))
            else:
                # New range
                merged_ranges.append((start, end))
        
        # Convert merged ranges to reference strings
        for start, end in merged_ranges:
            if start == end or start == 1 and end == 999:
                # Single verse or chapter-only
                if start == 1 and end == 999:
                    merged_refs.append(f"{book} {chapter}")
                else:
                    merged_refs.append(f"{book} {chapter}:{start}")
            else:
                merged_refs.append(f"{book} {chapter}:{start}-{end}")
    
    return merged_refs


# ============================================================================
# POSITION REMAPPING FOR PARAGRAPH INSERTION
# ============================================================================

def remap_quote_boundaries_for_paragraphed_text(
    original_text: str,
    paragraphed_text: str,
    quote_boundaries: List[Any]
) -> List[Any]:
    """
    Remap QuoteBoundary positions after paragraph breaks have been inserted.
    
    When segment_paragraphs adds '\n\n' breaks to the text, the character positions
    in quote_boundaries become invalid. This function builds a mapping from original
    positions to new positions and updates the quote boundaries accordingly.
    
    CRITICAL FIX: This solves the bug where passage content was incorrectly extracted
    because positions were calculated from original text but applied to paragraphed text.
    
    Args:
        original_text: The original text before paragraph segmentation
        paragraphed_text: The text after paragraph breaks were added
        quote_boundaries: List of QuoteBoundary objects with positions from original_text
    
    Returns:
        Updated list of QuoteBoundary objects with positions remapped for paragraphed_text
    """
    if not quote_boundaries:
        return quote_boundaries
    
    # Build a character-by-character mapping from original to paragraphed positions
    # We'll track the offset caused by inserted paragraph breaks
    # 
    # The paragraphed text is created by:
    # 1. Splitting original text on sentence boundaries
    # 2. Joining paragraphs with '\n\n' instead of single spaces
    # 
    # So we need to find where '\n\n' was inserted and calculate offsets
    
    # Find all positions where paragraph breaks were inserted
    # by comparing the two texts
    offset_at_position = {}  # Maps original_position -> offset
    
    orig_idx = 0
    para_idx = 0
    current_offset = 0
    
    # Simple approach: walk through both texts simultaneously
    # tracking when they diverge due to inserted breaks
    while orig_idx < len(original_text) and para_idx < len(paragraphed_text):
        orig_char = original_text[orig_idx]
        para_char = paragraphed_text[para_idx]
        
        if orig_char == para_char:
            # Characters match, record offset for this position
            offset_at_position[orig_idx] = current_offset
            orig_idx += 1
            para_idx += 1
        elif para_char == '\n':
            # Paragraph break was inserted at this position
            # Count all newlines in paragraphed text first
            newline_count = 0
            while para_idx < len(paragraphed_text) and paragraphed_text[para_idx] == '\n':
                newline_count += 1
                para_idx += 1
            
            # Also skip the corresponding space in original text if present
            if orig_idx < len(original_text) and original_text[orig_idx] == ' ':
                # Space was replaced by newlines
                # Net offset increase = (newlines - 1) because 1 char became N chars
                current_offset += (newline_count - 1)
                offset_at_position[orig_idx] = current_offset
                orig_idx += 1
            else:
                # Pure insertion (no character replaced)
                current_offset += newline_count
        else:
            # Mismatch - this shouldn't happen in normal operation
            # but handle gracefully by advancing both
            offset_at_position[orig_idx] = current_offset
            orig_idx += 1
            para_idx += 1
    
    # Fill in remaining positions
    while orig_idx < len(original_text):
        offset_at_position[orig_idx] = current_offset
        orig_idx += 1
    
    # Now remap each quote boundary
    from copy import copy
    remapped = []
    for qb in quote_boundaries:
        new_qb = copy(qb)
        
        # Find the offset for start_pos
        # start_pos is inclusive, so we want offset at or before this position
        start_offset = 0
        for pos in sorted(offset_at_position.keys()):
            if pos <= qb.start_pos:
                start_offset = offset_at_position[pos]
            else:
                break
        new_qb.start_pos = qb.start_pos + start_offset
        
        # Find the offset for end_pos  
        # end_pos is EXCLUSIVE (Python slice convention), so we want the offset
        # for the last character BEFORE end_pos (i.e., position end_pos - 1)
        # This means we use pos < qb.end_pos instead of pos <= qb.end_pos
        end_offset = 0
        for pos in sorted(offset_at_position.keys()):
            if pos < qb.end_pos:
                end_offset = offset_at_position[pos]
            else:
                break
        new_qb.end_pos = qb.end_pos + end_offset
        
        remapped.append(new_qb)
    
    return remapped


# ============================================================================
# PARAGRAPH SEGMENTATION
# ============================================================================

def segment_paragraphs(
    text: str,
    quote_boundaries: Optional[List[Any]] = None,
    min_sentences: int = 5,
    similarity_threshold: float = 0.30
) -> str:
    """
    Segment text into paragraphs using semantic analysis.
    
    Args:
        text: Text to segment
        quote_boundaries: Quote boundaries to respect (don't split quotes)
        min_sentences: Minimum sentences per paragraph
        similarity_threshold: Threshold for topic change detection
    
    Returns:
        Text with paragraph breaks
    """
    emit_progress(4, "Segmenting paragraphs", 0, "Loading semantic model...")
    
    # Import segmentation function from main.py (same directory)
    from main import segment_into_paragraphs  # type: ignore[attr-defined]
    
    emit_progress(4, "Segmenting paragraphs", 30, "Analyzing sentence boundaries...")
    
    result = segment_into_paragraphs(
        text,
        quote_boundaries=quote_boundaries,  # type: ignore[arg-type]
        min_sentences_per_paragraph=min_sentences,
        similarity_threshold=similarity_threshold,
        window_size=3
    )
    
    emit_stage_complete(4, "Segmenting paragraphs")
    
    return result


# ============================================================================
# TAG EXTRACTION
# ============================================================================

def extract_tags(
    text: str,
    quote_boundaries: Optional[List[Any]] = None,
    max_tags: int = 12
) -> List[str]:
    """
    Extract keyword tags from sermon transcript.
    
    Args:
        text: Paragraphed text
        quote_boundaries: Quote boundaries (to exclude quotes from keyword extraction)
        max_tags: Maximum number of tags to extract
    
    Returns:
        List of tag strings
    """
    emit_progress(5, "Extracting tags", 0, "Loading tag extraction model...")
    
    # Import from main.py (same directory)
    from main import extract_tags as main_extract_tags  # type: ignore[attr-defined]
    
    emit_progress(5, "Extracting tags", 50, "Analyzing semantic themes...")
    
    tags = main_extract_tags(
        text,
        quote_boundaries=quote_boundaries,  # type: ignore[arg-type]
        max_tags=max_tags,
        verbose=False
    )
    
    emit_stage_complete(5, "Extracting tags")
    
    return tags


# ============================================================================
# MAIN PROCESSING PIPELINE
# ============================================================================

def process_sermon(
    file_path: str,
    model_name: str = "medium",
    language: str = "en",
    use_ast: bool = True,  # New: enable structured document model
    skip_transcription: bool = False,
    debug_ast: bool = False  # New: enable debug logging for AST building
) -> Dict[str, Any]:
    """
    Full sermon processing pipeline:
    1. Transcribe audio (or load test transcript)
    2. Extract metadata (Title, Comment)
    3. Process Bible quotes (with per-quote translation detection)
    4. Segment into paragraphs
    5. Extract tags
    6. Build structured AST (if use_ast=True)
    
    Args:
        file_path: Path to audio file
        model_name: Whisper model to use
        language: Language code or 'auto'
        use_ast: If True, include documentState with structured AST
        skip_transcription: If True, load test transcript instead of processing audio
        debug_ast: If True, emit detailed debug logs during AST building
    
    Returns:
        Structured document data with optional documentState
    """
    # Clear Bible verse cache at start of each transcription to prevent unbounded growth
    from bible_quote_processor import clear_bible_verse_cache
    clear_bible_verse_cache()
    
    result = {
        'title': None,
        'biblePassage': None,
        'speaker': None,
        'tags': [],
        'references': [],
        'body': '',
        'rawTranscript': '',
        'documentState': None  # New: structured document model
    }
    
    # Stage 1: Transcribe
    if skip_transcription:
        emit_progress(1, "Transcribing audio", 0, "Test Mode: Loading transcript...")
        try:
            # Load test transcript from the same directory as this script
            script_dir = os.path.dirname(os.path.abspath(__file__))
            test_file_path = os.path.join(script_dir, "test_mode_transcript.txt")
            
            with open(test_file_path, 'r', encoding='utf-8') as f:
                raw_text = f.read()
            
            # Simulate a brief delay to show the progress
            import time
            emit_progress(1, "Transcribing audio", 50, "Test Mode: Simulating transcription...")
            time.sleep(0.5)
            emit_progress(1, "Transcribing audio", 100, "Test Mode: Complete")
            emit_stage_complete(1, "Transcribing audio")
        except Exception as e:
            return {'error': f"Failed to load test transcript: {str(e)}"}
    else:
        raw_text = transcribe_audio(file_path, model_name, language)
        
    result['rawTranscript'] = raw_text
    
    # Stage 2: Extract metadata
    emit_progress(2, "Extracting metadata", 0, "Reading audio file metadata...")
    metadata = extract_audio_metadata(file_path)
    result['title'] = metadata.get('title')
    result['biblePassage'] = metadata.get('comment')
    result['speaker'] = metadata.get('authors')  # Authors metadata becomes speaker
    emit_stage_complete(2, "Extracting metadata")
    
    # Stage 3: Process Bible quotes
    processed_text, quote_boundaries, scripture_refs = process_bible_quotes(
        raw_text,
        auto_detect_translation=True
    )
    result['references'] = scripture_refs
    
    # Stage 4: Segment paragraphs using original raw_text to preserve offsets
    # quote_boundaries are relative to raw_text.
    paragraphed_text = segment_paragraphs(
        raw_text,
        quote_boundaries=quote_boundaries
    )
    result['body'] = paragraphed_text
    
    # CRITICAL FIX: Remap quote boundary positions after paragraph insertion
    # The paragraph segmentation adds '\n\n' breaks which shifts all positions.
    # We need to update quote_boundaries to match the new paragraphed_text positions.
    if quote_boundaries:
        quote_boundaries = remap_quote_boundaries_for_paragraphed_text(
            original_text=raw_text,
            paragraphed_text=paragraphed_text,
            quote_boundaries=quote_boundaries
        )
    
    # Stage 5: Extract tags
    tags = extract_tags(paragraphed_text, quote_boundaries)
    result['tags'] = tags
    
    # Stage 6: Build structured AST (new document model)
    if use_ast:
        emit_progress(6, "Building document model", 0, "Creating structured document...")
        try:
            from ast_builder import build_ast
            
            if debug_ast:
                print("[DEBUG AST] Starting AST building with debug mode enabled", file=sys.stderr)
            
            ast_result = build_ast(
                paragraphed_text=paragraphed_text,
                quote_boundaries=quote_boundaries,
                title=result['title'],
                bible_passage=result['biblePassage'],
                speaker=result['speaker'],
                tags=tags,
                debug=debug_ast  # Pass debug flag to AST builder
            )
            
            # Include full document state in result
            result['documentState'] = ast_result.document_state.to_dict()
            result['processingMetadata'] = ast_result.processing_metadata.to_dict()
            
            emit_progress(6, "Building document model", 100, "Document model complete")
        except Exception as e:
            # Log error but don't fail - legacy output is still available
            import traceback
            print(f"Warning: AST building failed: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            result['documentState'] = None
            result['astError'] = str(e)
    
    return result


def transcribe_only(
    file_path: str,
    model_name: str = "medium",
    language: str = "en"
) -> Dict[str, Any]:
    """
    Simple transcription without sermon processing.
    
    Args:
        file_path: Path to audio file
        model_name: Whisper model to use
        language: Language code or 'auto'
    
    Returns:
        Dict with transcription text
    """
    text = transcribe_audio(file_path, model_name, language)
    return {
        'text': text,
        'rawTranscript': text
    }


# ============================================================================
# COMMAND HANDLER
# ============================================================================

def handle_command(command: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle a command from the Electron app.
    
    Commands:
        - transcribe: Simple transcription
        - process_sermon: Full sermon processing pipeline
        - check_dependencies: Check if all required packages are installed
        - get_models: List available Whisper models
    """
    cmd = command.get('command', '')
    
    if cmd == 'check_dependencies':
        return check_dependencies()
    
    elif cmd == 'get_models':
        return {
            'models': [
                {'name': 'tiny', 'size': '75 MB', 'vram': '~1 GB'},
                {'name': 'tiny.en', 'size': '75 MB', 'vram': '~1 GB'},
                {'name': 'base', 'size': '142 MB', 'vram': '~1 GB'},
                {'name': 'base.en', 'size': '142 MB', 'vram': '~1 GB'},
                {'name': 'small', 'size': '466 MB', 'vram': '~2 GB'},
                {'name': 'small.en', 'size': '466 MB', 'vram': '~2 GB'},
                {'name': 'medium', 'size': '1.5 GB', 'vram': '~5 GB'},
                {'name': 'medium.en', 'size': '1.5 GB', 'vram': '~5 GB'},
                {'name': 'large-v3', 'size': '3.1 GB', 'vram': '~10 GB'},
                {'name': 'large-v3-turbo', 'size': '1.6 GB', 'vram': '~6 GB'},
            ]
        }
    
    elif cmd == 'transcribe':
        file_path = command.get('filePath')
        model_name = command.get('model', 'medium')
        language = command.get('language', 'en')
        
        if not file_path:
            return {'error': 'filePath is required'}
        
        return transcribe_only(file_path, model_name, language)
    
    elif cmd == 'process_sermon':
        file_path = command.get('filePath')
        model_name = command.get('model', 'medium')
        language = command.get('language', 'en')
        skip_transcription = command.get('skip_transcription', False)
        debug_ast = command.get('debug_ast', False)
        
        if not file_path:
            return {'error': 'filePath is required'}
        
        return process_sermon(
            file_path, 
            model_name, 
            language, 
            skip_transcription=skip_transcription,
            debug_ast=debug_ast
        )
    
    elif cmd == 'extract_metadata':
        file_path = command.get('filePath')
        if not file_path:
            return {'error': 'filePath is required'}
        return extract_audio_metadata(file_path)
    
    else:
        return {'error': f'Unknown command: {cmd}'}


def check_dependencies() -> Dict[str, Any]:
    """Check if all required Python packages are installed."""
    deps: Dict[str, Any] = {
        'torch': False,
        'whisper': False,
        'sentence_transformers': False,
        'keybert': False,
        'nltk': False,
        'mutagen': False,
        'requests': False,
        'numpy': False,
    }
    
    try:
        import torch
        deps['torch'] = True
        deps['torch_version'] = str(torch.__version__)
        deps['mps_available'] = torch.backends.mps.is_available()
        deps['cuda_available'] = torch.cuda.is_available()
    except ImportError:
        pass
    
    try:
        import whisper
        deps['whisper'] = True
    except ImportError:
        pass
    
    try:
        from sentence_transformers import SentenceTransformer
        deps['sentence_transformers'] = True
    except ImportError:
        pass
    
    try:
        from keybert import KeyBERT
        deps['keybert'] = True
    except ImportError:
        pass
    
    try:
        import nltk
        deps['nltk'] = True
    except ImportError:
        pass
    
    try:
        import mutagen
        deps['mutagen'] = True
    except ImportError:
        pass
    
    try:
        import requests
        deps['requests'] = True
    except ImportError:
        pass
    
    try:
        import numpy
        deps['numpy'] = True
    except ImportError:
        pass
    
    all_installed = all(deps.get(k, False) for k in ['torch', 'whisper', 'sentence_transformers', 'keybert', 'nltk', 'mutagen', 'requests', 'numpy'])
    
    return {
        'dependencies': deps,
        'all_installed': all_installed,
        'device': get_device() if deps['torch'] else 'unknown'
    }


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """
    Main entry point for subprocess mode.
    Reads JSON commands from stdin and writes JSON responses to stdout.
    """
    # Read command from stdin
    try:
        input_data = sys.stdin.read()
        if not input_data.strip():
            emit_error("No input provided")
            return
        
        command = json.loads(input_data)
    except json.JSONDecodeError as e:
        emit_error(f"Invalid JSON input: {e}")
        return
    except Exception as e:
        emit_error(f"Error reading input: {e}")
        return
    
    # Process the command
    try:
        result = handle_command(command)
        emit_result(result)
    except Exception as e:
        emit_error(f"Error processing command: {e}\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
