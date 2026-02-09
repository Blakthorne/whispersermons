#!/usr/bin/env python3
"""
WhisperSermons Python Bridge

This module provides a JSON-based subprocess interface for the Electron app to:
1. Transcribe audio using mlx-whisper (Apple Silicon optimized)
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


# Monkey-patch tqdm BEFORE importing mlx_whisper
# This allows us to capture whisper's internal progress
import tqdm as _tqdm_module
_original_tqdm = _tqdm_module.tqdm
_tqdm_module.tqdm = WhisperProgressTqdm

# Configure HuggingFace Hub cache directory (will be set by Electron)
# mlx-whisper uses huggingface_hub for model downloads
WHISPER_CACHE_DIR = os.environ.get('WHISPER_CACHE_DIR', None)
if WHISPER_CACHE_DIR:
    os.environ['HF_HOME'] = os.path.join(WHISPER_CACHE_DIR, 'huggingface')

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

# Unified embedding model (EmbeddingGemma-300m-4bit via mlx-embeddings)
# Loaded lazily via embedding_model.load_model() on first use

# ============================================================================
# MLX MODEL NAME MAPPING
# ============================================================================
# Maps user-facing model names to HuggingFace repo IDs for mlx-community models.
# These are pre-converted MLX format models optimized for Apple Silicon.

MLX_MODEL_MAP: Dict[str, str] = {
    'tiny': 'mlx-community/whisper-tiny',
    'tiny.en': 'mlx-community/whisper-tiny.en-mlx',
    'base': 'mlx-community/whisper-base-mlx',
    'base.en': 'mlx-community/whisper-base.en-mlx',
    'small': 'mlx-community/whisper-small-mlx',
    'small.en': 'mlx-community/whisper-small.en-mlx',
    'medium': 'mlx-community/whisper-medium-mlx',
    'medium.en': 'mlx-community/whisper-medium-mlx',
    'large': 'mlx-community/whisper-large-v3-mlx',
    'large-v3': 'mlx-community/whisper-large-v3-mlx',
    'large-v3-turbo': 'mlx-community/whisper-large-v3-turbo',
    'turbo': 'mlx-community/whisper-large-v3-turbo',
}


def get_mlx_model_repo(model_name: str) -> str:
    """Get the HuggingFace repo ID for a given model name.
    
    Args:
        model_name: User-facing model name (e.g., 'medium', 'large-v3-turbo')
    
    Returns:
        HuggingFace repo ID for mlx-community model
    """
    return MLX_MODEL_MAP.get(model_name, f'mlx-community/whisper-{model_name}')


def get_embedding_model():
    """Load the unified embedding model (EmbeddingGemma-300m-4bit via mlx-embeddings).
    
    Returns:
        Tuple of (model, tokenizer) from mlx-embeddings
    """
    from embedding_model import load_model
    return load_model()


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
    on_progress: Optional[Any] = None,
    advanced_settings: Optional[Dict[str, Any]] = None
) -> str:
    """
    Transcribe audio using mlx-whisper (Apple Silicon optimized).
    
    Uses MLX framework for native Apple GPU acceleration with fp16 support.
    Models are automatically downloaded from HuggingFace Hub.
    
    Args:
        file_path: Path to audio/video file
        model_name: Whisper model name (tiny, base, small, medium, large-v3, etc.)
        language: Language code or 'auto' for auto-detection
        on_progress: Optional callback for progress updates
        advanced_settings: Optional dict of advanced Whisper settings
    
    Returns:
        Transcribed text
    """
    import mlx_whisper  # type: ignore
    
    # Map user-facing model name to HuggingFace repo ID
    model_repo = get_mlx_model_repo(model_name)
    
    emit_progress(1, "Transcribing audio", 10, f"Loading {model_name} model (MLX)...")
    emit_progress(1, "Transcribing audio", 25, "Starting transcription...")
    
    # Default transcription parameters
    # mlx-whisper uses fp16 by default on Apple Silicon - this is a key advantage
    transcribe_kwargs: Dict[str, Any] = {
        'path_or_hf_repo': model_repo,
        'temperature': (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),  # Temperature fallback cascade
        'compression_ratio_threshold': 2.4,  # Detect repetitions
        'logprob_threshold': -1.0,  # Filter low-confidence segments
        'no_speech_threshold': None,  # DISABLED - prevents skipping audio segments
        'condition_on_previous_text': True,  # Use context from previous segments
        'verbose': False,  # Enable tqdm progress bar (our custom one captures it)
        'fp16': True,  # Half-precision works natively on Apple Silicon via MLX
        'initial_prompt': "This is a clear audio recording of speech."
    }
    
    # Apply advanced settings if provided
    if advanced_settings:
        # Temperature (can be single value or list for cascade)
        if 'temperature' in advanced_settings:
            temp = advanced_settings['temperature']
            if isinstance(temp, list):
                transcribe_kwargs['temperature'] = tuple(temp)
            else:
                transcribe_kwargs['temperature'] = temp
        
        # Sampling parameters
        # Note: beam_size is NOT implemented in mlx-whisper, so we skip it
        if 'bestOf' in advanced_settings:
            transcribe_kwargs['best_of'] = advanced_settings['bestOf']
        
        # Quality thresholds
        if 'compressionRatioThreshold' in advanced_settings:
            transcribe_kwargs['compression_ratio_threshold'] = advanced_settings['compressionRatioThreshold']
        if 'logprobThreshold' in advanced_settings:
            transcribe_kwargs['logprob_threshold'] = advanced_settings['logprobThreshold']
        if 'noSpeechThreshold' in advanced_settings:
            transcribe_kwargs['no_speech_threshold'] = advanced_settings['noSpeechThreshold']
        
        # Context and behavior
        if 'conditionOnPreviousText' in advanced_settings:
            transcribe_kwargs['condition_on_previous_text'] = advanced_settings['conditionOnPreviousText']
        if 'wordTimestamps' in advanced_settings:
            transcribe_kwargs['word_timestamps'] = advanced_settings['wordTimestamps']
        if 'initialPrompt' in advanced_settings:
            transcribe_kwargs['initial_prompt'] = advanced_settings['initialPrompt']
        
        # Performance - fp16 works on Apple Silicon with MLX!
        if 'fp16' in advanced_settings:
            transcribe_kwargs['fp16'] = advanced_settings['fp16']
        if 'hallucinationSilenceThreshold' in advanced_settings and advanced_settings['hallucinationSilenceThreshold'] is not None:
            transcribe_kwargs['hallucination_silence_threshold'] = advanced_settings['hallucinationSilenceThreshold']
    
    # Only set language if not 'auto'
    if language and language != 'auto':
        transcribe_kwargs['language'] = language
    
    # The progress is tracked via our custom tqdm wrapper
    # which automatically emits progress as mlx-whisper processes audio frames
    emit_progress(1, "Transcribing audio", 28, "Processing audio segments (MLX GPU)...")
    
    result = mlx_whisper.transcribe(file_path, **transcribe_kwargs)
    
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
# PARAGRAPH SEGMENTATION
# ============================================================================

def segment_paragraphs(
    text: str,
    quote_boundaries: Optional[List[Any]] = None,
    min_sentences: int = 5,
    similarity_threshold: float = 0.45
) -> Tuple[List[Any], List[List[int]]]:
    """
    Segment text into paragraph groups using the integrated pipeline.
    
    Returns sentence tokens and paragraph groups (lists of sentence indices).
    Paragraph structure is represented ONLY in the AST - the source text is
    never modified. The AST builder uses these groups to create ParagraphNode
    boundaries in the document tree.
    
    All positions reference raw_text directly - no remapping needed.
    
    Args:
        text: Raw text to segment (immutable - never modified)
        quote_boundaries: Quote boundaries to respect (positions in raw_text)
        min_sentences: Minimum sentences per paragraph
        similarity_threshold: Threshold for topic change detection
    
    Returns:
        Tuple of (sentences, paragraph_groups)
    """
    emit_progress(4, "Segmenting paragraphs", 0, "Loading semantic model...")
    
    from main import tokenize_sentences, segment_into_paragraph_groups
    
    emit_progress(4, "Segmenting paragraphs", 20, "Tokenizing sentences...")
    sentences = tokenize_sentences(text)
    
    emit_progress(4, "Segmenting paragraphs", 30, "Analyzing sentence boundaries...")
    paragraph_groups = segment_into_paragraph_groups(
        sentences,
        quote_boundaries=quote_boundaries,
        min_sentences_per_paragraph=min_sentences,
        similarity_threshold=similarity_threshold,
        window_size=3
    )
    
    emit_stage_complete(4, "Segmenting paragraphs")
    
    return sentences, paragraph_groups


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
    debug_ast: bool = False,  # New: enable debug logging for AST building
    advanced_settings: Optional[Dict[str, Any]] = None  # New: advanced Whisper settings
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
        advanced_settings: Optional dict of advanced Whisper settings
    
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
        raw_text = transcribe_audio(file_path, model_name, language, advanced_settings=advanced_settings)
        
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
    
    # Stage 4: Segment paragraphs using integrated pipeline
    # Returns sentence tokens and paragraph groups (sentence index lists).
    # Paragraph structure is represented ONLY in the AST - the source text
    # is never modified. All positions reference raw_text directly.
    sentences, paragraph_groups = segment_paragraphs(
        raw_text,
        quote_boundaries=quote_boundaries
    )
    # Body field contains the raw transcript. Paragraph structure comes
    # exclusively from the AST (documentState). This ensures the text
    # is never modified during pipeline processing.
    result['body'] = raw_text
    
    # Stage 5: Extract tags from raw text (not modified text)
    tags = extract_tags(raw_text, quote_boundaries)
    result['tags'] = tags
    
    # Stage 6: Build structured AST (new integrated document model)
    if use_ast:
        emit_progress(6, "Building document model", 0, "Creating structured document...")
        try:
            from ast_builder import build_ast
            
            if debug_ast:
                print("[DEBUG AST] Starting AST building with debug mode enabled", file=sys.stderr)
            
            # New integrated pipeline: pass raw_text, sentences, groups, boundaries
            # All positions reference raw_text directly - no remapping needed
            ast_result = build_ast(
                raw_text=raw_text,
                sentences=sentences,
                paragraph_groups=paragraph_groups,
                quote_boundaries=quote_boundaries,
                title=result['title'],
                bible_passage=result['biblePassage'],
                speaker=result['speaker'],
                tags=tags,
                debug=debug_ast
            )
            
            # Include full document state in result
            result['documentState'] = ast_result.document_state.to_dict()
            result['processingMetadata'] = ast_result.processing_metadata.to_dict()
            
            emit_progress(6, "Building document model", 100, "Document model complete")
        except Exception as e:
            # AST building is required — propagate the error
            import traceback
            print(f"Error: AST building failed: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            raise RuntimeError(f"AST building failed: {e}") from e
    
    return result


def transcribe_only(
    file_path: str,
    model_name: str = "medium",
    language: str = "en",
    advanced_settings: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Simple transcription without sermon processing.
    
    Args:
        file_path: Path to audio file
        model_name: Whisper model to use
        language: Language code or 'auto'
        advanced_settings: Optional dict of advanced Whisper settings
    
    Returns:
        Dict with transcription text
    """
    text = transcribe_audio(file_path, model_name, language, advanced_settings=advanced_settings)
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
                {'name': 'tiny', 'size': '75 MB', 'vram': '~1 GB', 'repo': 'mlx-community/whisper-tiny'},
                {'name': 'tiny.en', 'size': '75 MB', 'vram': '~1 GB', 'repo': 'mlx-community/whisper-tiny.en-mlx'},
                {'name': 'base', 'size': '142 MB', 'vram': '~1 GB', 'repo': 'mlx-community/whisper-base-mlx'},
                {'name': 'base.en', 'size': '142 MB', 'vram': '~1 GB', 'repo': 'mlx-community/whisper-base.en-mlx'},
                {'name': 'small', 'size': '466 MB', 'vram': '~2 GB', 'repo': 'mlx-community/whisper-small-mlx'},
                {'name': 'small.en', 'size': '466 MB', 'vram': '~2 GB', 'repo': 'mlx-community/whisper-small.en-mlx'},
                {'name': 'medium', 'size': '1.5 GB', 'vram': '~5 GB', 'repo': 'mlx-community/whisper-medium-mlx'},
                {'name': 'medium.en', 'size': '1.5 GB', 'vram': '~5 GB', 'repo': 'mlx-community/whisper-medium-mlx'},
                {'name': 'large-v3', 'size': '3.1 GB', 'vram': '~10 GB', 'repo': 'mlx-community/whisper-large-v3-mlx'},
                {'name': 'large-v3-turbo', 'size': '1.6 GB', 'vram': '~6 GB', 'repo': 'mlx-community/whisper-large-v3-turbo'},
            ]
        }
    
    elif cmd == 'transcribe':
        file_path = command.get('filePath')
        model_name = command.get('model', 'medium')
        language = command.get('language', 'en')
        advanced_settings = command.get('advancedSettings')
        
        if not file_path:
            return {'error': 'filePath is required'}
        
        return transcribe_only(file_path, model_name, language, advanced_settings)
    
    elif cmd == 'process_sermon':
        file_path = command.get('filePath')
        model_name = command.get('model', 'medium')
        language = command.get('language', 'en')
        skip_transcription = command.get('skip_transcription', False)
        debug_ast = command.get('debug_ast', False)
        advanced_settings = command.get('advancedSettings')
        
        if not file_path:
            return {'error': 'filePath is required'}
        
        return process_sermon(
            file_path, 
            model_name, 
            language, 
            skip_transcription=skip_transcription,
            debug_ast=debug_ast,
            advanced_settings=advanced_settings
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
        'mlx_whisper': False,
        'mlx': False,
        'mlx_embeddings': False,
        'mutagen': False,
        'requests': False,
        'numpy': False,
    }
    
    try:
        import mlx_whisper  # type: ignore
        deps['mlx_whisper'] = True
        deps['mlx_whisper_version'] = str(mlx_whisper.__version__)
    except ImportError:
        pass
    
    try:
        import mlx.core  # type: ignore
        deps['mlx'] = True
    except ImportError:
        pass
    
    try:
        from mlx_embeddings.utils import load  # type: ignore
        deps['mlx_embeddings'] = True
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
    
    all_installed = all(deps.get(k, False) for k in [
        'mlx_whisper', 'mlx', 'mlx_embeddings',
        'mutagen', 'requests', 'numpy'
    ])
    
    # Device: always MLX on Apple Silicon (the only supported platform)
    device = 'mlx'
    
    return {
        'dependencies': deps,
        'all_installed': all_installed,
        'device': device,
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
