#!/usr/bin/env python3
"""
Bible Quote Processor for Sermon Transcripts

This script processes raw sermon transcripts to:
1. Detect and normalize Bible verse references (fix transcription errors)
2. Identify actual Bible quote boundaries using API lookup + fuzzy matching
3. Detect interjections within quotes (e.g., "a what?")
4. Apply proper quotation marks around Bible passages

Author: AI Assistant
Date: December 2024
"""

import re
import json
import time
import difflib
from pathlib import Path
from typing import List, Tuple, Dict, Optional, NamedTuple, Callable, TYPE_CHECKING
from dataclasses import dataclass
import requests

if TYPE_CHECKING:
    from ast_builder import ASTBuilderResult

# ============================================================================
# CONFIGURATION
# ============================================================================

# Bible API configuration - Bolls.life API (free, no API key, many translations)
BIBLE_API_BASE = "https://bolls.life"
DEFAULT_TRANSLATION = "KJV"  # Default translation (can be changed)

# Supported translations for reference:
# KJV, NKJV, NIV, NIV2011, ESV, NLT, NASB, RSV, MSG, AMP, YLT, WEB, NET, NLV
# LSB, BSB, MEV, CSB17, CEB, NABRE, GNTD, ERV, ASV, GNT, ISV, and many more

API_RATE_LIMIT_DELAY = 0.5  # Bolls.life is more permissive than bible-api.com

# Cache file for Bible verses
CACHE_FILE = Path(__file__).parent / "bible_verse_cache.json"

# Fuzzy matching thresholds
QUOTE_MATCH_THRESHOLD = 0.60  # Minimum similarity ratio to consider a match
QUOTE_START_THRESHOLD = 0.70  # Higher threshold for starting a quote

# Interjection patterns (phrases that interrupt quotes)
INTERJECTION_PATTERNS = [
    r'\ba what\?',
    r'\bright\?',
    r'\bamen\?',
    r'\byes\?',
    r'\bokay\?',
    r'\bhuh\?',
    r'\bwho\?',  # "we will serve who?" style interjections
    # Catch "[word] what?" interjections like "his what?" where speaker pauses before a word
    r'\b(?:his|her|your|my|its|their|a|an|the|to|of|with)\s+what\?',
    r'\bwhat\?(?!\s+(?:shall|is|are|was|were|did|do|does|hath|have|had|should|would|could|can|will|may|might))',  # "what?" alone but not "what shall..."
]

# Book name to Bolls.life book ID mapping (standard Protestant Bible order)
BOOK_ID_MAP = {
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
    'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
    '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14,
    'Ezra': 15, 'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19,
    'Proverbs': 20, 'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23,
    'Jeremiah': 24, 'Lamentations': 25, 'Ezekiel': 26, 'Daniel': 27,
    'Hosea': 28, 'Joel': 29, 'Amos': 30, 'Obadiah': 31, 'Jonah': 32,
    'Micah': 33, 'Nahum': 34, 'Habakkuk': 35, 'Zephaniah': 36, 'Haggai': 37,
    'Zechariah': 38, 'Malachi': 39, 'Matthew': 40, 'Mark': 41, 'Luke': 42,
    'John': 43, 'Acts': 44, 'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47,
    'Galatians': 48, 'Ephesians': 49, 'Philippians': 50, 'Colossians': 51,
    '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54, '2 Timothy': 55,
    'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59, '1 Peter': 60,
    '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64, 'Jude': 65,
    'Revelation': 66
}

# Chapter counts for each Bible book (Protestant canon, 66 books)
# Used for offline validation of chapter numbers without an API call.
# Prevents false positives in normalization (e.g., rejecting "Matthew 63:3"
# since Matthew only has 28 chapters).
BOOK_CHAPTER_COUNTS = {
    'Genesis': 50, 'Exodus': 40, 'Leviticus': 27, 'Numbers': 36, 'Deuteronomy': 34,
    'Joshua': 24, 'Judges': 21, 'Ruth': 4, '1 Samuel': 31, '2 Samuel': 24,
    '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36,
    'Ezra': 10, 'Nehemiah': 13, 'Esther': 10, 'Job': 42, 'Psalms': 150,
    'Proverbs': 31, 'Ecclesiastes': 12, 'Song of Solomon': 8, 'Isaiah': 66,
    'Jeremiah': 52, 'Lamentations': 5, 'Ezekiel': 48, 'Daniel': 12,
    'Hosea': 14, 'Joel': 3, 'Amos': 9, 'Obadiah': 1, 'Jonah': 4,
    'Micah': 7, 'Nahum': 3, 'Habakkuk': 3, 'Zephaniah': 3, 'Haggai': 2,
    'Zechariah': 14, 'Malachi': 4, 'Matthew': 28, 'Mark': 16, 'Luke': 24,
    'John': 21, 'Acts': 28, 'Romans': 16, '1 Corinthians': 16, '2 Corinthians': 13,
    'Galatians': 6, 'Ephesians': 6, 'Philippians': 4, 'Colossians': 4,
    '1 Thessalonians': 5, '2 Thessalonians': 3, '1 Timothy': 6, '2 Timothy': 4,
    'Titus': 3, 'Philemon': 1, 'Hebrews': 13, 'James': 5, '1 Peter': 5,
    '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1, 'Jude': 1,
    'Revelation': 22
}

# Books with only 1 chapter — references like "Jude 12" always mean verse 12
# of the sole chapter, not chapter 12.
SINGLE_CHAPTER_BOOKS = frozenset(
    book for book, count in BOOK_CHAPTER_COUNTS.items() if count == 1
)


def is_valid_chapter(book: str, chapter: int) -> bool:
    """
    Check whether a chapter number is within the valid range for a book.

    Args:
        book: Canonical book name (e.g., "Matthew", "1 Corinthians")
        chapter: Chapter number to validate

    Returns:
        True if the chapter is valid (1 ≤ chapter ≤ max for the book).
        Returns True if the book is not in the lookup (fallback to permissive).
        Returns False for chapters ≤ 0.
    """
    if chapter <= 0:
        return False
    max_ch = BOOK_CHAPTER_COUNTS.get(book)
    if max_ch is None:
        return True  # Unknown book — permissive fallback
    return chapter <= max_ch


# ============================================================================
# BIBLE BOOK DATA
# ============================================================================

# Complete list of Bible book names with variations
BIBLE_BOOKS = {
    # Old Testament
    'genesis': 'Genesis', 'gen': 'Genesis',
    'exodus': 'Exodus', 'exod': 'Exodus', 'ex': 'Exodus',
    'leviticus': 'Leviticus', 'lev': 'Leviticus',
    'numbers': 'Numbers', 'num': 'Numbers',
    'deuteronomy': 'Deuteronomy', 'deut': 'Deuteronomy',
    'joshua': 'Joshua', 'josh': 'Joshua',
    'judges': 'Judges', 'judg': 'Judges',
    'ruth': 'Ruth',
    '1 samuel': '1 Samuel', '1samuel': '1 Samuel', '1 sam': '1 Samuel', '1sam': '1 Samuel', 'first samuel': '1 Samuel',
    '2 samuel': '2 Samuel', '2samuel': '2 Samuel', '2 sam': '2 Samuel', '2sam': '2 Samuel', 'second samuel': '2 Samuel',
    '1 kings': '1 Kings', '1kings': '1 Kings', '1 kgs': '1 Kings', 'first kings': '1 Kings',
    '2 kings': '2 Kings', '2kings': '2 Kings', '2 kgs': '2 Kings', 'second kings': '2 Kings',
    '1 chronicles': '1 Chronicles', '1chronicles': '1 Chronicles', '1 chron': '1 Chronicles', 'first chronicles': '1 Chronicles',
    '2 chronicles': '2 Chronicles', '2chronicles': '2 Chronicles', '2 chron': '2 Chronicles', 'second chronicles': '2 Chronicles',
    'ezra': 'Ezra',
    'nehemiah': 'Nehemiah', 'neh': 'Nehemiah',
    'esther': 'Esther', 'est': 'Esther',
    'job': 'Job',
    'psalms': 'Psalms', 'psalm': 'Psalms', 'ps': 'Psalms', 'psa': 'Psalms',
    'proverbs': 'Proverbs', 'prov': 'Proverbs', 'pro': 'Proverbs',
    'ecclesiastes': 'Ecclesiastes', 'eccl': 'Ecclesiastes', 'ecc': 'Ecclesiastes',
    'song of solomon': 'Song of Solomon', 'song': 'Song of Solomon', 'sos': 'Song of Solomon',
    'isaiah': 'Isaiah', 'isa': 'Isaiah',
    'jeremiah': 'Jeremiah', 'jer': 'Jeremiah',
    'lamentations': 'Lamentations', 'lam': 'Lamentations',
    'ezekiel': 'Ezekiel', 'ezek': 'Ezekiel',
    'daniel': 'Daniel', 'dan': 'Daniel',
    'hosea': 'Hosea', 'hos': 'Hosea',
    'joel': 'Joel',
    'amos': 'Amos',
    'obadiah': 'Obadiah', 'obad': 'Obadiah',
    'jonah': 'Jonah',
    'micah': 'Micah', 'mic': 'Micah',
    'nahum': 'Nahum', 'nah': 'Nahum',
    'habakkuk': 'Habakkuk', 'hab': 'Habakkuk',
    'zephaniah': 'Zephaniah', 'zeph': 'Zephaniah',
    'haggai': 'Haggai', 'hag': 'Haggai',
    'zechariah': 'Zechariah', 'zech': 'Zechariah',
    'malachi': 'Malachi', 'mal': 'Malachi',
    # New Testament
    'matthew': 'Matthew', 'matt': 'Matthew', 'mat': 'Matthew', 'mt': 'Matthew',
    'mark': 'Mark', 'mk': 'Mark',
    'luke': 'Luke', 'lk': 'Luke',
    'john': 'John', 'jn': 'John', 'jhn': 'John',
    'acts': 'Acts',
    'romans': 'Romans', 'rom': 'Romans',
    '1 corinthians': '1 Corinthians', '1corinthians': '1 Corinthians', '1 cor': '1 Corinthians', 'first corinthians': '1 Corinthians',
    '2 corinthians': '2 Corinthians', '2corinthians': '2 Corinthians', '2 cor': '2 Corinthians', 'second corinthians': '2 Corinthians',
    'galatians': 'Galatians', 'gal': 'Galatians',
    'ephesians': 'Ephesians', 'eph': 'Ephesians',
    'philippians': 'Philippians', 'phil': 'Philippians', 'php': 'Philippians',
    'colossians': 'Colossians', 'col': 'Colossians',
    '1 thessalonians': '1 Thessalonians', '1thessalonians': '1 Thessalonians', '1 thess': '1 Thessalonians', 'first thessalonians': '1 Thessalonians',
    '2 thessalonians': '2 Thessalonians', '2thessalonians': '2 Thessalonians', '2 thess': '2 Thessalonians', 'second thessalonians': '2 Thessalonians',
    '1 timothy': '1 Timothy', '1timothy': '1 Timothy', '1 tim': '1 Timothy', 'first timothy': '1 Timothy',
    '2 timothy': '2 Timothy', '2timothy': '2 Timothy', '2 tim': '2 Timothy', 'second timothy': '2 Timothy',
    'titus': 'Titus', 'tit': 'Titus',
    'philemon': 'Philemon', 'phlm': 'Philemon', 'phm': 'Philemon',
    'hebrews': 'Hebrews', 'heb': 'Hebrews',
    'james': 'James', 'jas': 'James',
    '1 peter': '1 Peter', '1peter': '1 Peter', '1 pet': '1 Peter', 'first peter': '1 Peter',
    '2 peter': '2 Peter', '2peter': '2 Peter', '2 pet': '2 Peter', 'second peter': '2 Peter',
    '1 john': '1 John', '1john': '1 John', 'first john': '1 John',
    '2 john': '2 John', '2john': '2 John', 'second john': '2 John',
    '3 john': '3 John', '3john': '3 John', 'third john': '3 John',
    'jude': 'Jude',
    'revelation': 'Revelation', 'rev': 'Revelation', 'revelations': 'Revelation',
}

# Book names sorted by length (longest first) to avoid partial matches
BOOK_NAMES_PATTERN = '|'.join(
    sorted(BIBLE_BOOKS.keys(), key=len, reverse=True)
)

# Word-to-number mapping for spoken verse numbers (e.g., "Romans 12 one" → "Romans 12:1")
WORD_TO_NUMBER = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24, 'twenty-five': 25,
    'twenty-six': 26, 'twenty-seven': 27, 'twenty-eight': 28, 'twenty-nine': 29, 'thirty': 30,
    'thirty-one': 31, 'thirty-two': 32, 'thirty-three': 33, 'thirty-four': 34, 'thirty-five': 35,
    'thirty-six': 36, 'thirty-seven': 37, 'thirty-eight': 38, 'thirty-nine': 39, 'forty': 40,
}

# Pattern for spoken numbers
SPOKEN_NUMBERS_PATTERN = '|'.join(sorted(WORD_TO_NUMBER.keys(), key=len, reverse=True))

# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class BibleReference:
    """Represents a detected Bible reference in the text."""
    book: str
    chapter: int
    verse_start: Optional[int] = None
    verse_end: Optional[int] = None
    original_text: str = ""
    position: int = 0  # Position in original text
    
    def to_api_format(self) -> str:
        """Convert to format suitable for bible-api.com"""
        if self.verse_start is None:
            return f"{self.book} {self.chapter}"
        elif self.verse_end is None or self.verse_end == self.verse_start:
            return f"{self.book} {self.chapter}:{self.verse_start}"
        else:
            return f"{self.book} {self.chapter}:{self.verse_start}-{self.verse_end}"
    
    def to_standard_format(self) -> str:
        """Convert to standard citation format"""
        if self.verse_start is None:
            return f"{self.book} {self.chapter}"
        elif self.verse_end is None or self.verse_end == self.verse_start:
            return f"{self.book} {self.chapter}:{self.verse_start}"
        else:
            return f"{self.book} {self.chapter}:{self.verse_start}-{self.verse_end}"

@dataclass
class QuoteBoundary:
    """Represents a detected Bible quote in the text.
    
    PHASE 4 ENHANCED: Now includes boundary verification metadata to track
    adjustments made during the verification process.
    """
    start_pos: int
    end_pos: int
    reference: BibleReference
    verse_text: str
    confidence: float
    translation: str = "KJV"  # Detected translation for this specific quote
    has_interjection: bool = False
    interjection_positions: Optional[List[Tuple[int, int]]] = None  # List of (start, end) positions
    
    # PHASE 4: Boundary verification metadata
    original_start_pos: Optional[int] = None  # Original detected start before verification
    original_end_pos: Optional[int] = None    # Original detected end before verification
    start_adjustment: int = 0                  # Positive = moved forward, negative = moved backward
    end_adjustment: int = 0                    # Positive = extended, negative = trimmed
    boundary_verified: bool = False            # True if boundaries were verified against verse text
    
    def __post_init__(self):
        if self.interjection_positions is None:
            self.interjection_positions = []
        # Initialize original positions if not set
        if self.original_start_pos is None:
            self.original_start_pos = self.start_pos
        if self.original_end_pos is None:
            self.original_end_pos = self.end_pos

# ============================================================================
# BIBLE API CLIENT
# ============================================================================

class BibleAPIClient:
    """Client for interacting with Bolls.life API with caching and rate limiting.
    
    Bolls.life API supports many translations including:
    KJV, NKJV, NIV, NIV2011, ESV, NLT, NASB, RSV, MSG, AMP, YLT, WEB, NET, etc.
    
    API format:
    - Single verse: https://bolls.life/get-verse/{translation}/{book_id}/{chapter}/{verse}/
    - Full chapter: https://bolls.life/get-text/{translation}/{book_id}/{chapter}/
    - Multiple verses: POST to https://bolls.life/get-verses/ with JSON body
    """
    
    def __init__(self, cache_file: Path = CACHE_FILE, translation: str = DEFAULT_TRANSLATION):
        self.cache_file = cache_file
        self.cache: Dict[str, dict] = self._load_cache()
        self.last_request_time = 0
        self.translation = translation
    
    def _load_cache(self) -> Dict[str, dict]:
        """Load cached verses from file."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}
    
    def _save_cache(self):
        """Save cache to file."""
        with open(self.cache_file, 'w', encoding='utf-8') as f:
            json.dump(self.cache, f, indent=2, ensure_ascii=False)
    
    def clear_cache(self):
        """Clear the in-memory cache (but keep the file for next session)."""
        self.cache = {}

    def _rate_limit(self):
        """Ensure we don't exceed API rate limits."""
        elapsed = time.time() - self.last_request_time
        if elapsed < API_RATE_LIMIT_DELAY:
            time.sleep(API_RATE_LIMIT_DELAY - elapsed)
        self.last_request_time = time.time()
    
    def _get_book_id(self, book_name: str) -> Optional[int]:
        """Get the Bolls.life book ID for a book name."""
        return BOOK_ID_MAP.get(book_name)
    
    def _clean_html(self, text: str) -> str:
        """Remove HTML tags and Strong's numbers from verse text returned by Bolls.life API.
        
        Bolls.life returns verse text with Strong's numbers embedded in tags like:
        "Wherefore<S>3606</S> he is able<S>1410</S>..."
        
        This method removes both the tags and the Strong's numbers to get clean text.
        """
        # Remove Strong's number tags completely (including the number inside)
        # Pattern matches: <S>1234</S> or <sup>any text</sup>
        text = re.sub(r'<S>\d+</S>', '', text)
        text = re.sub(r'<sup>[^<]*</sup>', '', text)
        
        # Remove any remaining HTML tags
        text = re.sub(r'<[^>]+>', '', text)
        
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
    
    def _fetch_single_verse(self, book: str, chapter: int, verse: int) -> Optional[dict]:
        """Fetch a single verse from Bolls.life API."""
        book_id = self._get_book_id(book)
        if not book_id:
            print(f"  ⚠ Unknown book: {book}")
            return None
        
        self._rate_limit()
        
        try:
            url = f"{BIBLE_API_BASE}/get-verse/{self.translation}/{book_id}/{chapter}/{verse}/"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data and 'text' in data:
                    # Clean HTML and return in standardized format
                    return {
                        'text': self._clean_html(data['text']),
                        'verse': data.get('verse'),
                        'book': book,
                        'chapter': chapter,
                        'translation': self.translation
                    }
            else:
                print(f"  ⚠ HTTP {response.status_code} for {book} {chapter}:{verse}")
        except requests.RequestException as e:
            print(f"  ⚠ Request error for {book} {chapter}:{verse}: {e}")
        
        return None
    
    def _fetch_chapter(self, book: str, chapter: int) -> Optional[List[dict]]:
        """Fetch an entire chapter from Bolls.life API."""
        book_id = self._get_book_id(book)
        if not book_id:
            print(f"  ⚠ Unknown book: {book}")
            return None
        
        self._rate_limit()
        
        try:
            url = f"{BIBLE_API_BASE}/get-text/{self.translation}/{book_id}/{chapter}/"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data and isinstance(data, list):
                    # Clean HTML from all verse texts
                    for item in data:
                        if 'text' in item:
                            item['text'] = self._clean_html(item['text'])
                    return data
            else:
                print(f"  ⚠ HTTP {response.status_code} for {book} {chapter}")
        except requests.RequestException as e:
            print(f"  ⚠ Request error for {book} {chapter}: {e}")
        
        return None
    
    def _fetch_verse_range(self, book: str, chapter: int, start_verse: int, end_verse: int) -> Optional[dict]:
        """Fetch a range of verses using the bulk API endpoint."""
        book_id = self._get_book_id(book)
        if not book_id:
            print(f"  ⚠ Unknown book: {book}")
            return None
        
        self._rate_limit()
        
        try:
            # Use POST endpoint for fetching specific verses
            url = f"{BIBLE_API_BASE}/get-verses/"
            payload = [{
                'translation': self.translation,
                'book': book_id,
                'chapter': chapter,
                'verses': list(range(start_verse, end_verse + 1))
            }]
            
            response = requests.post(url, json=payload, timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0 and len(data[0]) > 0:
                    # Combine verses into single text
                    verses = data[0]
                    combined_text = ' '.join(self._clean_html(v.get('text', '')) for v in verses if v.get('text'))
                    return {
                        'text': combined_text,
                        'verses': verses,
                        'book': book,
                        'chapter': chapter,
                        'verse_start': start_verse,
                        'verse_end': end_verse,
                        'translation': self.translation
                    }
            else:
                print(f"  ⚠ HTTP {response.status_code} for {book} {chapter}:{start_verse}-{end_verse}")
        except requests.RequestException as e:
            print(f"  ⚠ Request error for {book} {chapter}:{start_verse}-{end_verse}: {e}")
        
        return None
    
    def get_verse(self, reference: str) -> Optional[dict]:
        """
        Fetch verse text from API or cache.
        
        Args:
            reference: Bible reference in format "Book Chapter:Verse" or "Book Chapter:Start-End"
        
        Returns:
            API response dict with 'text' field, or None if not found
        """
        cache_key = f"{reference}|{self.translation}"
        
        # Check cache first
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        # Parse the reference
        # Format: "Book Chapter:Verse" or "Book Chapter:Start-End" or "Book Chapter"
        match = re.match(r'^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$', reference)
        if not match:
            print(f"  ⚠ Could not parse reference: {reference}")
            return None
        
        book = match.group(1)
        chapter = int(match.group(2))
        verse_start = int(match.group(3)) if match.group(3) else None
        verse_end = int(match.group(4)) if match.group(4) else None
        
        result = None
        
        if verse_start is None:
            # Fetch entire chapter
            chapter_data = self._fetch_chapter(book, chapter)
            if chapter_data:
                combined_text = ' '.join(self._clean_html(v.get('text', '')) for v in chapter_data if v.get('text'))
                result = {
                    'text': combined_text,
                    'book': book,
                    'chapter': chapter,
                    'translation': self.translation
                }
        elif verse_end is None:
            # Single verse
            result = self._fetch_single_verse(book, chapter, verse_start)
        else:
            # Verse range
            result = self._fetch_verse_range(book, chapter, verse_start, verse_end)
        
        if result:
            self.cache[cache_key] = result
            self._save_cache()
        
        return result
    
    def verify_reference(self, book: str, chapter: int, verse: Optional[int] = None) -> bool:
        """
        Verify that a Bible reference exists.
        
        Args:
            book: Book name
            chapter: Chapter number
            verse: Verse number (optional)
        
        Returns:
            True if reference exists, False otherwise
        """
        if verse:
            ref = f"{book} {chapter}:{verse}"
        else:
            ref = f"{book} {chapter}"
        
        result = self.get_verse(ref)
        return result is not None
    
    def set_translation(self, translation: str):
        """Change the Bible translation being used."""
        self.translation = translation
        print(f"  ℹ Bible translation set to: {translation}")


def clear_bible_verse_cache():
    """
    Clear the Bible verse cache file.
    Should be called at the start of each new transcription to prevent
    unbounded cache growth.
    """
    if CACHE_FILE.exists():
        try:
            CACHE_FILE.unlink()
            print("  🗑️  Cleared Bible verse cache")
        except IOError as e:
            print(f"  ⚠ Could not clear cache: {e}")


# ============================================================================
# AUTO-TRANSLATION DETECTION
# ============================================================================

# Common Bible translations to try for auto-detection
TRANSLATIONS_TO_DETECT = ['KJV', 'NKJV', 'NIV', 'ESV', 'NASB', 'NLT', 'RSV', 'ASV', 'YLT', 'WEB']

# Distinctive phrases that differ significantly between translations
# Format: {translation: [(verse_ref, distinctive_phrase), ...]}
# These are manually curated phrases that are unique to each translation
TRANSLATION_FINGERPRINTS = {
    'KJV': [
        ('Matthew 6:33', 'seek ye first the kingdom'),
        ('John 3:16', 'only begotten son'),
        ('Psalm 23:1', 'the lord is my shepherd i shall not want'),
        ('Romans 8:28', 'all things work together for good'),
        ('Hebrews 7:25', 'wherefore he is able'),
    ],
    'NKJV': [
        ('Matthew 6:33', 'seek first the kingdom'),
        ('John 3:16', 'only begotten son'),
        ('Psalm 23:1', 'the lord is my shepherd i shall not want'),
        ('Romans 8:28', 'all things work together for good'),
        ('Hebrews 7:25', 'therefore he is also able'),
    ],
    'NIV': [
        ('Matthew 6:33', 'seek first his kingdom'),
        ('John 3:16', 'one and only son'),
        ('Psalm 23:1', 'the lord is my shepherd i lack nothing'),
        ('Romans 8:28', 'in all things god works for the good'),
        ('Hebrews 7:25', 'therefore he is able'),
    ],
    'ESV': [
        ('Matthew 6:33', 'seek first the kingdom of god'),
        ('John 3:16', 'only son'),
        ('Psalm 23:1', 'the lord is my shepherd i shall not want'),
        ('Romans 8:28', 'for those who love god all things work together'),
        ('Hebrews 7:25', 'consequently he is able'),
    ],
    'NASB': [
        ('Matthew 6:33', 'seek first his kingdom'),
        ('John 3:16', 'only begotten son'),
        ('Psalm 23:1', 'the lord is my shepherd i shall not want'),
        ('Romans 8:28', 'god causes all things to work together'),
        ('Hebrews 7:25', 'therefore he is able also'),
    ],
    'NLT': [
        ('Matthew 6:33', 'seek the kingdom of god above all else'),
        ('John 3:16', 'one and only son'),
        ('Psalm 23:1', 'the lord is my shepherd i have all that i need'),
        ('Romans 8:28', 'god causes everything to work together'),
        ('Hebrews 7:25', 'therefore he is able once and forever'),
    ],
}


def detect_translation_from_transcript(transcript: str, api_client: BibleAPIClient, 
                                        references: Optional[List['BibleReference']] = None,
                                        verbose: bool = True) -> str:
    """
    Auto-detect which Bible translation is being used in the transcript.
    
    This works by:
    1. First trying to match against known translation fingerprints (fast)
    2. If that fails, fetching detected references in multiple translations
       and comparing verse text against the transcript (more accurate but slower)
    
    Args:
        transcript: The sermon transcript text
        api_client: BibleAPIClient instance
        references: Optional pre-detected Bible references
        verbose: Whether to print detection progress
    
    Returns:
        Detected translation code (e.g., 'KJV', 'NIV', 'ESV')
    """
    if verbose:
        print("\n🔍 Auto-detecting Bible translation...")
    
    transcript_lower = transcript.lower()
    
    # PHASE 1: Quick fingerprint matching
    # This uses known distinctive phrases that differ between translations
    fingerprint_scores = {t: 0 for t in TRANSLATION_FINGERPRINTS}
    
    for translation, fingerprints in TRANSLATION_FINGERPRINTS.items():
        for verse_ref, phrase in fingerprints:
            if phrase in transcript_lower:
                fingerprint_scores[translation] += 1
                if verbose:
                    print(f"   Found '{phrase[:30]}...' → matches {translation}")
    
    # Check if we have a clear winner from fingerprints
    max_fingerprint_score = max(fingerprint_scores.values())
    if max_fingerprint_score >= 2:  # At least 2 fingerprint matches
        winners = [t for t, s in fingerprint_scores.items() if s == max_fingerprint_score]
        if len(winners) == 1:
            detected = winners[0]
            if verbose:
                print(f"   ✓ Detected translation: {detected} (fingerprint score: {max_fingerprint_score})")
            return detected
    
    # PHASE 2: Verse comparison (more thorough)
    # Fetch actual verses in multiple translations and compare
    if verbose:
        print("   Fingerprints inconclusive, comparing verse text...")
    
    # Use provided references or detect them
    if references is None:
        # Quick reference detection with default translation
        temp_client = BibleAPIClient(translation='KJV')
        temp_refs = detect_bible_references(transcript, temp_client, transcript)[:5]
    else:
        temp_refs = references[:5]
    
    if not temp_refs:
        if verbose:
            print("   ⚠ No Bible references found, using default: KJV")
        return 'KJV'
    
    # Score each translation by comparing verse text to transcript
    translation_scores = {t: 0.0 for t in TRANSLATIONS_TO_DETECT}
    original_translation = api_client.translation
    
    for ref in temp_refs:
        if not ref.verse_start:
            continue
        
        ref_str = ref.to_api_format()
        search_start = ref.position
        search_end = min(ref.position + 2000, len(transcript))
        search_area = transcript_lower[search_start:search_end]
        search_words = set(normalize_for_comparison(search_area).split())
        
        for translation in TRANSLATIONS_TO_DETECT:
            api_client.translation = translation
            
            # Build cache key to avoid redundant fetches
            cache_key = f"{translation}:{ref_str}"
            
            result = api_client.get_verse(ref_str)
            
            if result and 'text' in result:
                verse_text = result['text']
                verse_words = get_words(verse_text)
                
                if len(verse_words) >= 3:
                    # Count matching words
                    matches = sum(1 for w in verse_words if w in search_words)
                    match_ratio = matches / len(verse_words)
                    translation_scores[translation] += match_ratio
    
    # Restore original translation
    api_client.translation = original_translation
    
    # Find best translation
    if all(s == 0 for s in translation_scores.values()):
        if verbose:
            print("   ⚠ No verse matches found, using default: KJV")
        return 'KJV'
    
    best_translation = max(translation_scores.keys(), key=lambda k: translation_scores[k])
    best_score = translation_scores[best_translation]
    
    if verbose:
        print(f"   Translation scores: {', '.join(f'{t}:{s:.2f}' for t, s in sorted(translation_scores.items(), key=lambda x: -x[1])[:5])}")
        print(f"   ✓ Detected translation: {best_translation} (score: {best_score:.2f})")
    
    return best_translation


# Priority order for translation detection (most common in sermons first)
TRANSLATION_PRIORITY = ['KJV', 'NKJV', 'ESV', 'NIV', 'NASB', 'NLT', 'RSV', 'ASV']


def detect_translation_for_quote(ref: 'BibleReference', transcript: str, 
                                  api_client: BibleAPIClient,
                                  verbose: bool = False) -> Tuple[str, str, float]:
    """
    Detect the best-matching Bible translation for a specific quote.
    
    This function is called for EACH Bible reference to determine which translation
    the speaker is actually using for that specific quote. This handles cases where
    speakers switch translations mid-sermon.
    
    Args:
        ref: The Bible reference to detect translation for
        transcript: Full transcript text
        api_client: BibleAPIClient instance
        verbose: Whether to print detection progress
    
    Returns:
        Tuple of (best_translation, verse_text, confidence_score)
    """
    ref_str = ref.to_api_format()
    
    # Extract the search area - text after the reference
    search_start = ref.position
    # Use a smaller search area (500 chars) for better translation detection accuracy
    # This prevents matching common words from later in the transcript
    search_end = min(ref.position + 500, len(transcript))
    search_area = transcript.lower()[search_start:search_end]
    search_words = set(normalize_for_comparison(search_area).split())
    
    # Store original translation to restore later
    original_translation = api_client.translation
    
    best_translation = TRANSLATION_PRIORITY[0] if TRANSLATION_PRIORITY else 'KJV'
    best_verse_text = ''
    best_score = -1.0
    all_scores = {}
    
    # Fetch verse in each translation and score by word overlap
    for translation in TRANSLATION_PRIORITY:
        api_client.translation = translation
        
        result = api_client.get_verse(ref_str)
        
        if result and 'text' in result:
            verse_text = result['text']
            verse_words = get_words(verse_text)
            
            if len(verse_words) >= 3:
                # Count matching words
                matches = sum(1 for w in verse_words if w in search_words)
                match_ratio = matches / len(verse_words)
                all_scores[translation] = match_ratio
                
                if match_ratio > best_score:
                    best_score = match_ratio
                    best_translation = translation
                    best_verse_text = verse_text
                
                # Only exit early if we have a perfect match
                if match_ratio >= 1.0:
                    break
    
    # Restore original translation
    api_client.translation = original_translation
    
    if verbose and len(all_scores) > 1:
        scores_str = ', '.join(f'{t}:{s:.2f}' for t, s in sorted(all_scores.items(), key=lambda x: -x[1])[:3])
        print(f"      Translation scores: {scores_str}")
    
    return best_translation, best_verse_text, best_score


def normalize_book_name(name: str) -> Optional[str]:
    """
    Normalize a book name to its canonical form.
    
    Args:
        name: Book name (possibly abbreviated or with variations)
    
    Returns:
        Canonical book name or None if not recognized
    """
    normalized = name.lower().strip()
    return BIBLE_BOOKS.get(normalized)

def split_runtogether_number(num_str: str, api_client: BibleAPIClient, book: str, 
                             transcript: Optional[str] = None, ref_position: int = 0) -> Optional[Tuple[int, int]]:
    """
    Split a run-together chapter:verse number like "725" into (7, 25) or "633" into (6, 33).
    
    This enhanced version uses both API verification AND transcript matching to determine
    the correct split. For example, "Matthew 633" could be either:
    - Matthew 63:3 (invalid - Matthew only has 28 chapters)
    - Matthew 6:33 (valid - and we can verify by finding "Seek ye first" in transcript)
    
    Args:
        num_str: The run-together number string (e.g., "633", "725")
        api_client: BibleAPIClient for verification
        book: Book name for verification (e.g., "Matthew")
        transcript: Full transcript text (optional, for enhanced matching)
        ref_position: Position of reference in transcript (for search area limiting)
    
    Returns:
        Tuple of (chapter, verse) or None if can't be split
    """
    if len(num_str) < 2:
        return None
    
    # Try different split positions
    # For "633": i=1 → (6, 33), i=2 → (63, 3)
    candidates = []
    
    for i in range(1, len(num_str)):
        chapter_str = num_str[:i]
        verse_str = num_str[i:]
        
        if verse_str.startswith('0') and len(verse_str) > 1:
            continue  # Verses don't start with 0 (except "0" itself which is invalid)
        
        try:
            chapter = int(chapter_str)
            verse = int(verse_str)
            
            # Reasonable bounds
            if 1 <= chapter <= 150 and 1 <= verse <= 200:
                candidates.append((chapter, verse))
        except ValueError:
            continue
    
    if not candidates:
        return None
    
    # If only one candidate, verify and return it
    if len(candidates) == 1:
        chapter, verse = candidates[0]
        if api_client.verify_reference(book, chapter, verse):
            return candidates[0]
        return None  # Single candidate is invalid
    
    # Multiple candidates - score each by API verification AND transcript matching
    scored_candidates = []
    
    for chapter, verse in candidates:
        # First check: API verification (reference must exist)
        ref_str = f"{book} {chapter}:{verse}"
        result = api_client.get_verse(ref_str)
        
        if not result or 'text' not in result:
            # Reference doesn't exist in Bible - score 0
            continue
        
        score = 1.0  # Base score for existing reference
        
        # Second check: If transcript provided, verify verse text appears
        if transcript and ref_position >= 0:
            verse_text = result['text']
            verse_words = get_words(verse_text)
            
            if len(verse_words) >= 3:
                # Search in transcript near the reference
                search_start = ref_position
                search_end = min(ref_position + 1500, len(transcript))
                search_area = transcript[search_start:search_end].lower()
                
                # Look for distinctive words from the verse
                # Use first 5 words as fingerprint
                fingerprint_words = verse_words[:min(5, len(verse_words))]
                
                # Count how many fingerprint words appear in search area
                matches = sum(1 for word in fingerprint_words 
                             if word in search_area or any(
                                 difflib.SequenceMatcher(None, word, search_word).ratio() > 0.85
                                 for search_word in search_area.split()[:100]
                             ))
                
                match_ratio = matches / len(fingerprint_words)
                score += match_ratio * 2  # Transcript match is worth up to 2 points
        
        scored_candidates.append((chapter, verse, score))
    
    if not scored_candidates:
        # No valid candidates found
        return None
    
    # Return highest-scored candidate
    best = max(scored_candidates, key=lambda x: x[2])
    
    # Debug logging
    if len(scored_candidates) > 1:
        print(f"      ℹ Multiple splits for '{num_str}': {[(c, v, f'{s:.2f}') for c, v, s in scored_candidates]}")
        print(f"      → Selected: {book} {best[0]}:{best[1]} (score: {best[2]:.2f})")
    
    return (best[0], best[1])

def detect_bible_references(text: str, api_client: BibleAPIClient, transcript_for_validation: Optional[str] = None) -> List[BibleReference]:
    """
    Detect all Bible references in text and normalize them.
    
    Handles various transcription formats:
    - Standard: "John 3:16"
    - Run-together: "Hebrews 725" → "Hebrews 7:25"  
    - Run-together with validation: "Matthew 633" → "Matthew 6:33" (verified against transcript)
    - Hyphen: "Micah 5-2" → "Micah 5:2"
    - Period: "Romans 12.1" → "Romans 12:1"
    - Comma: "Revelation 19, 16" → "Revelation 19:16"
    - Spoken enumeration: "Isaiah 9, 6, and 7" → "Isaiah 9:6-7"
    - Verbose: "Matthew chapter 2 verses 1 through 12" → "Matthew 2:1-12"
    
    Args:
        text: The text to search
        api_client: BibleAPIClient for verification
        transcript_for_validation: Optional full transcript text for smart reference validation
                                   (helps disambiguate references like "Matthew 633" vs "Matthew 63:3")
    
    Returns:
        List of BibleReference objects
    """
    references = []
    
    # Use transcript for validation if not provided separately
    validation_text = transcript_for_validation if transcript_for_validation else text
    
    # Pattern for book names (including numbered books)
    book_pattern = rf'(?:(?:first|second|third|1|2|3)\s+)?(?:{BOOK_NAMES_PATTERN})'
    
    # Comprehensive pattern to capture various formats
    # NOTE: Verbose patterns are COMMENTED OUT to preserve natural speech
    # The goal is to ONLY fix malformed punctuation, not replace verbose references
    patterns = [
        # REMOVED: Verbose format with full verse range - this was too aggressive and removed entire sentences
        # rf'(?P<book0>{book_pattern})\s+(?:chapter\s+)?(?P<ch0>\d+)\.?\s+(?:And\s+)?(?:we\s+(?:are\s+)?(?:going\s+to\s+)?read\s+)?verses?\s+(?P<v0a>\d+)\s+(?:through|to|-)\s+(?P<v0b>\d+)',
        
        # REMOVED: Verbose format with chapter keyword - preserves natural speech
        # rf'(?P<book1>{book_pattern})\s+chapter\s+(?P<ch1>\d+)(?:\s+(?:and\s+)?verse?s?\s+(?P<v1>\d+)(?:\s+(?:through|to|-)\s+(?P<v2>\d+))?)?',
        
        # Spoken enumeration: "Book X, Y, and Z" (chapter, verse, verse)
        # Negative lookahead prevents matching "and 2" when followed by numbered book names like "2 Peter"
        # Also prevents matching when the final number is followed by ", digit" (indicating a cross-reference)
        # e.g., "Matthew 5, 44 and 45" → Matthew 5:44-45 (matches)
        # e.g., "Matthew 16, 24 and 6, 21" → does NOT match (6 is followed by ", 21")
        rf'(?P<book2>{book_pattern})\s+(?P<ch2>\d+),\s*(?P<v3>\d+),?\s*and\s+(?P<v4>\d+)(?!\s*(?:peter|samuel|kings|chronicles|corinthians|thessalonians|timothy|john)|,\s*\d)',
        
        # Comma enumeration: "Book X, Y, Z" (chapter, verse1, verse2) - no "and" keyword
        # e.g., "Romans 12, 1, 2" → Romans 12:1-2
        rf'(?P<book2b>{book_pattern})\s+(?P<ch2b>\d+),\s*(?P<v3b>\d+),\s*(?P<v4b>\d+)(?!\s*[,\d])',
        
        # Colon + comma enumeration: "Book X:Y, Z" → verse range
        # e.g., "Romans 12:1, 2" → Romans 12:1-2
        # MUST come before standard colon pattern to catch the comma enumeration first
        rf'(?P<book3b>{book_pattern})\s+(?P<ch3b>\d+):(?P<v5b>\d+),\s*(?P<v6b>\d+)(?!\s*[,\d])',
        
        # Standard with colon: "Book X:Y" or "Book X:Y-Z"
        rf'(?P<book3>{book_pattern})\s+(?P<ch3>\d+):(?P<v5>\d+)(?:-(?P<v6>\d+))?',
        
        # Verbose chapter-only: "Book chapter X" - captures just the reference, not surrounding text
        # This enables the post-processing to attach verse ranges mentioned later
        # e.g., "Matthew chapter 2" + "verses 1 through 12" → Matthew 2:1-12
        rf'(?P<book9>{book_pattern})\s+chapter\s+(?P<ch9>\d+)(?!\s+(?:and\s+)?verse)',
        
        # Hyphen format: "Book X-Y" (but not verse ranges which have colon)
        rf'(?P<book4>{book_pattern})\s+(?P<ch4>\d+)-(?P<v7>\d+)(?![\d-])',
        
        # Period format: "Book X.Y"
        rf'(?P<book5>{book_pattern})\s+(?P<ch5>\d+)\.(?P<v8>\d+)',
        
        # Comma format: "Book X, Y" (chapter, verse - not enumeration)
        # Negative lookahead prevents matching enumeration patterns like "1, 2, 3"
        # Changed from (?!\s*,?\s*and) to allow "Job 33, 4 and Genesis" while blocking "1, 2, 3"
        rf'(?P<book6>{book_pattern})\s+(?P<ch6>\d+),\s*(?P<v9>\d+)(?!\s*,\s*\d)',
        
        # Spoken verse numbers: "Book X word" (e.g., "Romans 12 one" → "Romans 12:1")
        # MUST come before run-together pattern to catch spoken numbers first
        rf'(?P<book10>{book_pattern})\s+(?P<ch10>\d+)\s+(?P<v_word>(?:{SPOKEN_NUMBERS_PATTERN}))(?=\s|$|[,\.])',
        
        # Run-together or chapter-only: "Book XYZ" or "Book X"
        # Allow comma after (e.g., "Matthew 633,") but not other separators that indicate format
        rf'(?P<book7>{book_pattern})\s+(?P<num>\d+)(?!\s*[:\-.]|\s+(?:chapter|verse|and|through|to))',
        
        # "Book X and verse Y"
        rf'(?P<book8>{book_pattern})\s+(?P<ch8>\d+)\s+and\s+verse\s+(?P<v10>\d+)',
    ]
    
    seen_positions = set()  # Avoid duplicate matches
    
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            start_pos = match.start()
            
            # Skip if we already found a reference at this position
            if any(abs(start_pos - p) < 5 for p in seen_positions):
                continue
            
            groups = match.groupdict()
            
            # Extract book name
            book_raw = None
            for key in groups:
                if key.startswith('book') and groups[key]:
                    book_raw = groups[key]
                    break
            
            if not book_raw:
                continue
            
            book = normalize_book_name(book_raw)
            if not book:
                continue
            
            # Extract chapter and verse based on which pattern matched
            chapter = None
            verse_start = None
            verse_end = None
            
            # REMOVED: Verbose format handlers (book0, book1) to preserve natural speech
            # These patterns consumed entire sentences and replaced them with short forms
            
            # Spoken enumeration with "and" (book2, ch2, v3, v4)
            if groups.get('ch2'):
                chapter = int(groups['ch2'])
                verse_start = int(groups['v3'])
                verse_end = int(groups['v4'])
            
            # Comma enumeration without "and" (book2b, ch2b, v3b, v4b)
            # e.g., "Romans 12, 1, 2" → Romans 12:1-2
            elif groups.get('ch2b'):
                chapter = int(groups['ch2b'])
                verse_start = int(groups['v3b'])
                verse_end = int(groups['v4b'])
            
            # Standard with colon (book3, ch3, v5, v6)
            elif groups.get('ch3'):
                chapter = int(groups['ch3'])
                verse_start = int(groups['v5'])
                if groups.get('v6'):
                    verse_end = int(groups['v6'])
            
            # Colon + comma enumeration (book3b, ch3b, v5b, v6b)
            # e.g., "Romans 12:1, 2" → Romans 12:1-2
            elif groups.get('ch3b'):
                chapter = int(groups['ch3b'])
                verse_start = int(groups['v5b'])
                verse_end = int(groups['v6b'])
            
            # Verbose chapter-only: "Book chapter X" (book9, ch9)
            # This captures chapter-only references that use the word "chapter"
            # The post-processing will attach verse ranges mentioned later
            elif groups.get('ch9'):
                chapter = int(groups['ch9'])
                # verse_start remains None - post-processing will handle it
            
            # Hyphen format (book4, ch4, v7)
            elif groups.get('ch4'):
                chapter = int(groups['ch4'])
                verse_start = int(groups['v7'])
            
            # Period format (book5, ch5, v8)
            elif groups.get('ch5'):
                chapter = int(groups['ch5'])
                verse_start = int(groups['v8'])
            
            # Comma format (book6, ch6, v9)
            elif groups.get('ch6'):
                chapter = int(groups['ch6'])
                verse_start = int(groups['v9'])
            
            # "Book X and verse Y" (book8, ch8, v10)
            elif groups.get('ch8'):
                chapter = int(groups['ch8'])
                verse_start = int(groups['v10'])
            
            # Spoken verse numbers: "Romans 12 one" (book10, ch10, v_word)
            elif groups.get('ch10') and groups.get('v_word'):
                chapter = int(groups['ch10'])
                word = groups['v_word'].lower()
                if word in WORD_TO_NUMBER:
                    verse_start = WORD_TO_NUMBER[word]
            
            # Run-together or chapter-only (book7, num)
            elif groups.get('num'):
                num = groups['num']
                if len(num) >= 3:
                    # Likely run-together, try to split with transcript validation
                    split = split_runtogether_number(num, api_client, book, 
                                                     validation_text, start_pos)
                    if split:
                        chapter, verse_start = split
                    else:
                        # Can't split, treat as chapter only
                        chapter = int(num)
                else:
                    # Short number, likely chapter only
                    chapter = int(num)
            
            if chapter:
                ref = BibleReference(
                    book=book,
                    chapter=chapter,
                    verse_start=verse_start,
                    verse_end=verse_end,
                    original_text=match.group(),
                    position=start_pos
                )
                references.append(ref)
                seen_positions.add(start_pos)
    
    # Post-processing: Look for standalone "verses X through Y" after book references
    verse_range_pattern = r'verses?\s+(\d+)\s+(?:through|to)\s+(\d+)'
    for match in re.finditer(verse_range_pattern, text, re.IGNORECASE):
        # Find the nearest preceding reference without verses
        match_pos = match.start()
        for ref in references:
            if ref.position < match_pos and match_pos - ref.position < 200:
                if ref.verse_start is None:
                    # Update this reference with the verse range
                    ref.verse_start = int(match.group(1))
                    ref.verse_end = int(match.group(2))
                    ref.original_text = text[ref.position:match.end()]
                    break
    
    # Post-processing: Look for cross-references like "and X, Y" or "and X:Y" after a full reference
    # These inherit the book name from the preceding reference
    # e.g., "Matthew 16, 24 and 6, 21" → Matthew 16:24 + Matthew 6:21
    cross_ref_pattern = r'\s+and\s+(\d{1,3}),?\s*(\d{1,3})(?!\s*(?:peter|samuel|kings|chronicles|corinthians|thessalonians|timothy|john))'
    
    for match in re.finditer(cross_ref_pattern, text, re.IGNORECASE):
        match_pos = match.start()
        
        # Check if this "and X, Y" is already part of an existing reference's original_text
        # This prevents duplicates like "Matthew 5, 44 and 45" creating both:
        #   - Matthew 5:44-45 (from enumeration pattern)
        #   - Matthew 4:5 (from "and 45" being re-matched here)
        already_captured = False
        match_text = match.group().strip()  # e.g., "and 45"
        for ref in references:
            # Check if this match falls within the span of an existing reference
            ref_end = ref.position + len(ref.original_text)
            if ref.position <= match_pos < ref_end:
                # The match start is within an existing reference - it's already captured
                already_captured = True
                break
            # Also check if the "and X" text appears in the original_text of a reference
            # that has a verse_end (indicating enumeration like "44 and 45")
            if ref.verse_end and match_text.lower() in ref.original_text.lower():
                already_captured = True
                break
        
        if already_captured:
            continue
        
        # Find the nearest preceding reference to inherit book name from
        nearest_ref = None
        for ref in references:
            if ref.position < match_pos and match_pos - ref.position < 50:
                # Check that we're not matching a numbered book name (e.g., "and 2 Peter")
                if ref.book and ref.verse_start:
                    nearest_ref = ref
        
        if nearest_ref:
            cross_chapter = int(match.group(1))
            cross_verse = int(match.group(2))
            
            # Create a new reference with inherited book name
            cross_ref = BibleReference(
                book=nearest_ref.book,
                chapter=cross_chapter,
                verse_start=cross_verse,
                verse_end=None,
                original_text=match.group().strip(),
                position=match_pos + 1  # +1 to skip the leading space
            )
            
            # Verify this is a valid reference before adding
            if api_client.verify_reference(nearest_ref.book, cross_chapter, cross_verse):
                references.append(cross_ref)
                seen_positions.add(cross_ref.position)
    
    # Sort by position in text
    references.sort(key=lambda r: r.position)
    
    return references

def normalize_references_in_text(text: str, references: List[BibleReference]) -> str:
    """
    Replace malformed Bible references in text with properly formatted versions.
    
    NOTE: This function is an OPTIONAL COSMETIC post-processing utility.
    It is NOT called during the boundary detection pipeline (process_text).
    All boundary detection operates on unmodified original text to maintain
    coordinate-space consistency. Use this only for display formatting if
    the renderer needs pre-normalized text (the AST renderer already handles
    reference formatting via PassageNode.quoteDetection.normalizedReference).
    
    IMPORTANT: Verbose references using "chapter" are NOT normalized because we want
    to preserve natural speech patterns. Only malformed punctuation (like "Book X-Y"
    instead of "Book X:Y") is corrected.
    
    Args:
        text: Original text
        references: Detected references with their positions
    
    Returns:
        Text with normalized references
    """
    # Sort by position descending to replace from end (avoid position shifts)
    refs_sorted = sorted(references, key=lambda r: r.position, reverse=True)
    
    result = text
    for ref in refs_sorted:
        normalized = ref.to_standard_format()
        original = ref.original_text
        
        # Skip verbose references that use "chapter" - preserve natural speech
        if 'chapter' in original.lower():
            continue
        
        # Only replace if different
        if normalized != original:
            # Find the exact position and replace
            before = result[:ref.position]
            after = result[ref.position + len(original):]
            result = before + normalized + after
    
    return result


# ============================================================================
# AST-LEVEL BIBLE REFERENCE NORMALIZATION
# ============================================================================
#
# This section implements reference normalization that operates on TextNode.content
# strings within the AST, NOT on the raw transcript text. Normalization runs as
# Stage 2b in the AST pipeline, after apply_passages_to_ast() but before
# segment_ast_paragraphs(). The original text (raw_text) is NEVER modified —
# only TextNode display content is updated.
#
# Normalization rules handle common ASR transcription artifacts:
#   - Run-together numbers:  "Romans 829"     → "Romans 8:29"
#   - Hyphen separator:      "Galatians 1-6"  → "Galatians 1:6"
#   - Comma separator:       "Revelation 19, 16" → "Revelation 19:16"
#   - Enumeration with "and":"Romans 1, 21 and 22" → "Romans 1:21-22"
#   - Period separator:      "Romans 12.1"    → "Romans 12:1"
#   - Spoken verse numbers:  "Romans 12 one"  → "Romans 12:1"
#
# Verbose speech patterns (containing "chapter", "verses", "through") are
# preserved as-is, along with already-correct references.
# ============================================================================


@dataclass
class ReferenceNormalization:
    """Record of a single reference normalization applied to text.

    Stores enough information to recover the original text and understand
    which rule triggered the change.

    Attributes:
        original_text: The matched text before normalization (e.g., "Romans 829")
        normalized_text: The replacement text (e.g., "Romans 8:29")
        position: Character offset within the text segment
        book: Canonical book name (e.g., "Romans")
        chapter: Detected chapter number
        verse_start: Detected starting verse (or None)
        verse_end: Detected ending verse (or None)
        rule_applied: Label identifying which normalization pattern fired
    """
    original_text: str
    normalized_text: str
    position: int
    book: str
    chapter: int
    verse_start: Optional[int] = None
    verse_end: Optional[int] = None
    rule_applied: str = ""


def _is_verbose_reference(text_around: str) -> bool:
    """Check if text near a reference uses verbose speech patterns.

    Verbose references like "Matthew chapter 2 verses 1 through 12" should
    be preserved, not normalized. This helper looks for indicator words.
    """
    lower = text_around.lower()
    return any(word in lower for word in ('chapter', 'verses', 'verse', 'through'))


def normalize_bible_references_in_segment(
    text: str,
    api_client: Optional[BibleAPIClient] = None,
) -> Tuple[str, List[ReferenceNormalization]]:
    """
    Normalize malformed Bible references in a text segment.

    Applies normalization rules in priority order (longest-match-first) to fix
    common ASR transcription artifacts. Each rule match consumes the matched
    span to prevent double-normalization.

    This is a PURE function (text in → text out) with no AST awareness.
    It operates on individual text segments such as TextNode.content strings.

    Args:
        text: Input text segment to normalize
        api_client: Optional BibleAPIClient for online verification of
                    ambiguous cases. If None, uses only local BOOK_CHAPTER_COUNTS.

    Returns:
        Tuple of (normalized_text, list_of_normalizations) where each
        normalization records the original text, replacement, and rule used.

    Invariants:
        - Idempotent: applying normalization twice yields the same result.
        - Verbose speech patterns ("chapter", "verses", "through") are never altered.
        - Already-correct references (with colons) are never altered.
        - Single-chapter book references (e.g., "Jude 12") are left as-is.
    """
    normalizations: List[ReferenceNormalization] = []
    # Track consumed character spans to prevent overlapping matches
    consumed: List[Tuple[int, int]] = []

    book_pattern = rf'(?:(?:first|second|third|1|2|3)\s+)?(?:{BOOK_NAMES_PATTERN})'

    def _is_consumed(start: int, end: int) -> bool:
        """Check if a span overlaps any already-consumed span."""
        return any(not (end <= cs or start >= ce) for cs, ce in consumed)

    def _record(match_start: int, match_end: int, original: str, normalized: str,
                book: str, chapter: int, verse_start: Optional[int],
                verse_end: Optional[int], rule: str):
        """Record a normalization and mark the span as consumed."""
        consumed.append((match_start, match_end))
        normalizations.append(ReferenceNormalization(
            original_text=original,
            normalized_text=normalized,
            position=match_start,
            book=book,
            chapter=chapter,
            verse_start=verse_start,
            verse_end=verse_end,
            rule_applied=rule,
        ))

    # ------------------------------------------------------------------
    # Rule 1: Enumeration with "and"
    # "Romans 1, 21 and 22" → "Romans 1:21-22"
    # Must come before comma rule to match longer patterns first.
    # ------------------------------------------------------------------
    enum_and_pat = re.compile(
        rf'(?P<book>{book_pattern})\s+(?P<ch>\d+),\s*(?P<v1>\d+),?\s*and\s+(?P<v2>\d+)'
        rf'(?!\s*(?:peter|samuel|kings|chronicles|corinthians|thessalonians|timothy|john))',
        re.IGNORECASE
    )
    for m in enum_and_pat.finditer(text):
        if _is_consumed(m.start(), m.end()):
            continue
        book_raw = m.group('book')
        book = normalize_book_name(book_raw)
        if not book:
            continue
        if book in SINGLE_CHAPTER_BOOKS:
            continue
        ch = int(m.group('ch'))
        v1 = int(m.group('v1'))
        v2 = int(m.group('v2'))
        if not is_valid_chapter(book, ch):
            continue
        # Validate verses are plausible (≤ 200)
        if v1 > 200 or v2 > 200:
            continue
        if v2 == v1 + 1:
            normalized = f"{book} {ch}:{v1}-{v2}"
        elif v2 > v1:
            normalized = f"{book} {ch}:{v1}-{v2}"
        else:
            normalized = f"{book} {ch}:{v1}, {v2}"
        _record(m.start(), m.end(), m.group(), normalized, book, ch, v1, v2, 'enumeration_and')

    # ------------------------------------------------------------------
    # Rule 2: Comma as chapter:verse separator
    # "Revelation 19, 16" → "Revelation 19:16"
    # Negative lookahead: not followed by another comma+digit (enumeration).
    # ------------------------------------------------------------------
    comma_pat = re.compile(
        rf'(?P<book>{book_pattern})\s+(?P<ch>\d+),\s*(?P<v>\d+)(?!\s*,\s*\d)',
        re.IGNORECASE
    )
    for m in comma_pat.finditer(text):
        if _is_consumed(m.start(), m.end()):
            continue
        book_raw = m.group('book')
        book = normalize_book_name(book_raw)
        if not book:
            continue
        if book in SINGLE_CHAPTER_BOOKS:
            continue
        ch = int(m.group('ch'))
        v = int(m.group('v'))
        if not is_valid_chapter(book, ch):
            continue
        if v > 200 or v <= 0:
            continue
        # Check it's not verbose
        ctx_start = max(0, m.start() - 20)
        ctx_end = min(len(text), m.end() + 20)
        if _is_verbose_reference(text[ctx_start:ctx_end]):
            continue
        normalized = f"{book} {ch}:{v}"
        _record(m.start(), m.end(), m.group(), normalized, book, ch, v, None, 'comma_separator')

    # ------------------------------------------------------------------
    # Rule 3: Period as chapter:verse separator
    # "Romans 12.1" → "Romans 12:1"
    # Must NOT match sentence-ending periods.
    # ------------------------------------------------------------------
    period_pat = re.compile(
        rf'(?P<book>{book_pattern})\s+(?P<ch>\d+)\.(?P<v>\d+)',
        re.IGNORECASE
    )
    for m in period_pat.finditer(text):
        if _is_consumed(m.start(), m.end()):
            continue
        book_raw = m.group('book')
        book = normalize_book_name(book_raw)
        if not book:
            continue
        if book in SINGLE_CHAPTER_BOOKS:
            continue
        ch = int(m.group('ch'))
        v = int(m.group('v'))
        if not is_valid_chapter(book, ch):
            continue
        if v > 200 or v <= 0:
            continue
        normalized = f"{book} {ch}:{v}"
        _record(m.start(), m.end(), m.group(), normalized, book, ch, v, None, 'period_separator')

    # ------------------------------------------------------------------
    # Rule 4: Hyphen as chapter:verse separator
    # "Galatians 1-6" → "Galatians 1:6"
    # Must NOT normalize actual chapter ranges like "Genesis 1-3".
    # ------------------------------------------------------------------
    hyphen_pat = re.compile(
        rf'(?P<book>{book_pattern})\s+(?P<ch>\d+)-(?P<v>\d+)(?![\d-])',
        re.IGNORECASE
    )
    for m in hyphen_pat.finditer(text):
        if _is_consumed(m.start(), m.end()):
            continue
        book_raw = m.group('book')
        book = normalize_book_name(book_raw)
        if not book:
            continue
        if book in SINGLE_CHAPTER_BOOKS:
            continue
        ch = int(m.group('ch'))
        v = int(m.group('v'))
        if not is_valid_chapter(book, ch):
            continue
        if v <= 0 or v > 200:
            continue
        # Disambiguation: chapter range vs chapter:verse
        max_ch = BOOK_CHAPTER_COUNTS.get(book)
        if max_ch is not None:
            # If both numbers are small valid chapters and the gap is very small,
            # it could be a chapter range (e.g., "Genesis 1-3" = chapters 1-3).
            # Only skip when both numbers are small (≤ 3) and gap ≤ 2, which is
            # the most common chapter-range pattern in spoken sermons.
            if v <= max_ch and v >= ch and v <= 3 and (v - ch) <= 2:
                continue  # Conservative: treat as chapter range, do NOT normalize
        # If v exceeds max chapter count, it's definitely a verse number
        # Also normalize when v is plausible as a verse and ch is a valid chapter
        if api_client is not None:
            if not api_client.verify_reference(book, ch, v):
                continue
        normalized = f"{book} {ch}:{v}"
        _record(m.start(), m.end(), m.group(), normalized, book, ch, v, None, 'hyphen_separator')

    # ------------------------------------------------------------------
    # Rule 5: Spoken verse numbers
    # "Romans 12 one" → "Romans 12:1"
    # ------------------------------------------------------------------
    spoken_pat = re.compile(
        rf'(?P<book>{book_pattern})\s+(?P<ch>\d+)\s+(?P<word>(?:{SPOKEN_NUMBERS_PATTERN}))(?=\s|$|[,\.])',
        re.IGNORECASE
    )
    for m in spoken_pat.finditer(text):
        if _is_consumed(m.start(), m.end()):
            continue
        book_raw = m.group('book')
        book = normalize_book_name(book_raw)
        if not book:
            continue
        if book in SINGLE_CHAPTER_BOOKS:
            continue
        ch = int(m.group('ch'))
        word = m.group('word').lower()
        v = WORD_TO_NUMBER.get(word)
        if v is None:
            continue
        if not is_valid_chapter(book, ch):
            continue
        # Check it's not verbose
        ctx_start = max(0, m.start() - 20)
        ctx_end = min(len(text), m.end() + 20)
        if _is_verbose_reference(text[ctx_start:ctx_end]):
            continue
        normalized = f"{book} {ch}:{v}"
        _record(m.start(), m.end(), m.group(), normalized, book, ch, v, None, 'spoken_number')

    # ------------------------------------------------------------------
    # Rule 6: Run-together numbers (3+ digits, no separator)
    # "Romans 829" → "Romans 8:29"
    # Must not match chapter-only references (1-2 digits).
    # Must not match references already handled by a colon or other separator.
    # ------------------------------------------------------------------
    runtogether_pat = re.compile(
        rf'(?P<book>{book_pattern})\s+(?P<num>\d{{3,}})(?!\s*[:\-.]|\s+(?:chapter|verse|and\s+\d|through\s+\d|to\s+\d))',
        re.IGNORECASE
    )
    for m in runtogether_pat.finditer(text):
        if _is_consumed(m.start(), m.end()):
            continue
        book_raw = m.group('book')
        book = normalize_book_name(book_raw)
        if not book:
            continue
        if book in SINGLE_CHAPTER_BOOKS:
            continue
        num_str = m.group('num')

        # Try to split the run-together number into chapter:verse
        # Use local validation first, fall back to API if available
        best_split = None
        for i in range(1, len(num_str)):
            ch_str = num_str[:i]
            v_str = num_str[i:]
            if v_str.startswith('0') and len(v_str) > 1:
                continue
            try:
                ch = int(ch_str)
                v = int(v_str)
            except ValueError:
                continue
            if ch <= 0 or v <= 0 or v > 200:
                continue
            if not is_valid_chapter(book, ch):
                continue
            # Valid local candidate
            if best_split is None:
                best_split = (ch, v)
            else:
                # Prefer the split whose chapter is valid and verse is smaller
                # (more likely correct: e.g., 6:33 preferred over 63:3 for "633")
                if is_valid_chapter(book, ch):
                    if not is_valid_chapter(book, best_split[0]):
                        best_split = (ch, v)
                    elif ch > best_split[0]:
                        # Prefer larger chapter if both valid (e.g., 8:29 over 82:9)
                        # Actually prefer the split where chapter is valid and verse
                        # is reasonable — the longer chapter prefix is usually correct.
                        best_split = (ch, v)

        if best_split is None:
            continue

        ch, v = best_split

        # Optional API verification
        if api_client is not None:
            if not api_client.verify_reference(book, ch, v):
                continue

        normalized = f"{book} {ch}:{v}"
        _record(m.start(), m.end(), m.group(), normalized, book, ch, v, None, 'runtogether')

    # ------------------------------------------------------------------
    # Apply normalizations: sort by position descending to avoid offset shifts
    # ------------------------------------------------------------------
    if not normalizations:
        return text, []

    normalizations.sort(key=lambda n: n.position, reverse=True)
    result = text
    for norm in normalizations:
        before = result[:norm.position]
        after = result[norm.position + len(norm.original_text):]
        result = before + norm.normalized_text + after

    # Re-sort normalizations by position ascending for the caller
    normalizations.sort(key=lambda n: n.position)

    return result, normalizations


# ============================================================================
# QUOTE DETECTION WITH FUZZY MATCHING
# ============================================================================

def clean_text_for_matching(text: str) -> str:
    """
    Clean text for fuzzy matching by normalizing whitespace and punctuation.
    """
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    # Normalize quotes
    text = text.replace('"', '"').replace('"', '"').replace("'", "'").replace("'", "'")
    # Remove newlines
    text = text.replace('\n', ' ')
    return text.strip()

def normalize_for_comparison(text: str) -> str:
    """
    Aggressively normalize text for comparison by removing punctuation and normalizing spelling.
    """
    text = text.lower()
    # Remove all punctuation
    text = re.sub(r'[^\w\s]', '', text)
    # Normalize common spelling variations
    text = text.replace('counsellor', 'counselor')
    text = text.replace('colour', 'color')
    text = text.replace('favour', 'favor')
    text = text.replace('honour', 'honor')
    text = text.replace('saviour', 'savior')
    text = text.replace('behaviour', 'behavior')
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def get_words(text: str) -> List[str]:
    """Extract words from text, normalized for comparison."""
    normalized = normalize_for_comparison(text)
    return normalized.split()

def find_quote_in_text(verse_text: str, transcript: str, search_start: int = 0) -> Optional[Tuple[int, int, float]]:
    """
    Find the location of a Bible verse in the transcript using word-level matching.
    
    Args:
        verse_text: The actual Bible verse text from API
        transcript: The sermon transcript to search
        search_start: Position to start searching from
    
    Returns:
        Tuple of (start_pos, end_pos, confidence) or None if not found
    """
    # Get words from verse
    verse_words = get_words(verse_text)
    if len(verse_words) < 4:
        return None
    
    # Get search area from transcript
    search_area = transcript[search_start:search_start + 5000]
    transcript_words = search_area.split()
    
    # Find the distinctive first words of the verse
    # Use first 4-6 words as anchor
    anchor_size = min(6, len(verse_words))
    anchor_words = verse_words[:anchor_size]
    
    # Search for anchor in transcript using word-level matching
    best_start_idx = None
    best_start_score = 0
    
    for i in range(len(transcript_words) - anchor_size + 1):
        window = transcript_words[i:i + anchor_size]
        # Count matching words
        matches = sum(1 for v, t in zip(anchor_words, [normalize_for_comparison(w) for w in window]) if v == t)
        score = matches / anchor_size
        
        if score > best_start_score and score >= 0.5:  # At least 50% word match
            best_start_score = score
            best_start_idx = i
    
    if best_start_idx is None:
        return None
    
    # Now find where the verse ends by matching end words
    end_anchor_size = min(6, len(verse_words))
    end_anchor_words = verse_words[-end_anchor_size:]
    
    # Search from anchor position to end of reasonable range
    search_end = min(best_start_idx + len(verse_words) + 30, len(transcript_words))
    
    best_end_idx = None
    best_end_score = 0
    
    for i in range(best_start_idx + len(verse_words) - end_anchor_size - 10, search_end - end_anchor_size + 1):
        if i < best_start_idx:
            continue
        window = transcript_words[i:i + end_anchor_size]
        matches = sum(1 for v, t in zip(end_anchor_words, [normalize_for_comparison(w) for w in window]) if v == t)
        score = matches / end_anchor_size
        
        if score > best_end_score and score >= 0.5:
            best_end_score = score
            best_end_idx = i + end_anchor_size
    
    if best_end_idx is None:
        # Estimate end based on verse length
        best_end_idx = best_start_idx + len(verse_words) + 5
        best_end_score = 0.5
    
    # Convert word indices back to character positions
    # Find position of start word in search_area
    start_char_pos = 0
    for j in range(best_start_idx):
        start_char_pos = search_area.find(transcript_words[j], start_char_pos) + len(transcript_words[j])
    start_char_pos = search_area.find(transcript_words[best_start_idx], start_char_pos)
    
    # Find position of end word
    end_char_pos = start_char_pos
    for j in range(best_start_idx, min(best_end_idx, len(transcript_words))):
        next_pos = search_area.find(transcript_words[j], end_char_pos)
        if next_pos != -1:
            end_char_pos = next_pos + len(transcript_words[j])
    
    # Adjust to absolute positions
    actual_start = search_start + start_char_pos
    actual_end = search_start + end_char_pos
    
    confidence = (best_start_score + best_end_score) / 2
    
    return (actual_start, actual_end, confidence)

def find_distinctive_phrases(verse_text: str, min_length: int = 4) -> List[List[str]]:
    """
    Extract distinctive phrases from verse text that can be used for matching.
    
    Args:
        verse_text: The Bible verse text
        min_length: Minimum number of words for a phrase
    
    Returns:
        List of word lists representing distinctive phrases
    """
    words = get_words(verse_text)
    phrases = []
    
    # Common Bible verse connector words that speakers often skip
    # These words at the start of verses are frequently omitted when quoting
    SKIP_WORDS = {'but', 'and', 'for', 'then', 'now', 'so', 'yet', 'or', 'therefore', 'wherefore', 'behold'}
    
    # Take overlapping windows of words
    window_size = min(8, len(words))
    for i in range(0, len(words) - window_size + 1, 3):
        phrases.append(words[i:i + window_size])
    
    # Always include first and last phrases
    if words[:min_length] not in phrases:
        phrases.insert(0, words[:min(8, len(words))])
    if words[-min_length:] not in phrases:
        phrases.append(words[-min(8, len(words)):])
    
    # IMPORTANT: Also add phrases that skip the first 1-2 words if they're connector words
    # This handles cases where the speaker skips "But" or "And" at the start of a verse
    # e.g., "But seek ye first..." becomes "seek ye first..." in the transcript
    if len(words) >= window_size and words[0] in SKIP_WORDS:
        # Add phrase starting from word 1 (skipping first connector word)
        skip_1_phrase = words[1:1 + window_size]
        if skip_1_phrase not in phrases:
            phrases.insert(1, skip_1_phrase)
        
        # If second word is also a connector, add phrase starting from word 2
        if len(words) > window_size + 1 and words[1] in SKIP_WORDS:
            skip_2_phrase = words[2:2 + window_size]
            if skip_2_phrase not in phrases:
                phrases.insert(2, skip_2_phrase)
    
    return phrases

def find_best_phrase_match(phrases: List[List[str]], transcript: str, search_start: int, search_end: int) -> Optional[Tuple[int, int, float, int]]:
    """
    Find the best matching phrase in the transcript.
    
    Args:
        phrases: List of phrase word lists to search for
        transcript: The transcript text
        search_start: Start position for search
        search_end: End position for search
    
    Returns:
        Tuple of (match_start_pos, match_end_pos, confidence, phrase_index) or None
    """
    search_area = transcript[search_start:search_end]
    
    # Tokenize search area
    word_pattern = re.compile(r'\b\w+\b')
    word_matches = list(word_pattern.finditer(search_area))
    
    if not word_matches:
        return None
    
    words = [m.group() for m in word_matches]
    words_normalized = [normalize_for_comparison(w) for w in words]
    
    best_result = None
    best_score = 0
    
    for phrase_idx, phrase in enumerate(phrases):
        phrase_len = len(phrase)
        
        for i in range(len(words) - phrase_len + 1):
            window = words_normalized[i:i + phrase_len]
            
            # Count matching words
            matches = 0
            for p_word, w_word in zip(phrase, window):
                if p_word == w_word:
                    matches += 1
                elif len(p_word) > 3 and len(w_word) > 3:
                    if difflib.SequenceMatcher(None, p_word, w_word).ratio() > 0.8:
                        matches += 1
            
            score = matches / phrase_len
            if score > best_score and score >= 0.6:
                best_score = score
                start_pos = search_start + word_matches[i].start()
                end_pos = search_start + word_matches[i + phrase_len - 1].end()
                best_result = (start_pos, end_pos, score, phrase_idx)
    
    return best_result

def validate_gap_is_verse_content(gap_text: str, verse_text: str) -> bool:
    """
    Validate that the text between phrase matches is actual verse content, not commentary.
    
    This detects cases where a speaker:
    1. Reads part of a verse
    2. Makes commentary (explaining, repeating in their own words, etc.)
    3. Continues reading the verse
    
    The commentary should NOT be included in the quote.
    
    Args:
        gap_text: Text between two phrase matches
        verse_text: The full verse text from API
        
    Returns:
        True if gap appears to be verse content, False if it's commentary
    """
    gap_clean = gap_text.strip()
    
    # Very short gaps are likely verse content (punctuation, interjections)
    if len(gap_clean) < 20:
        return True
    
    # Check for known interjection patterns that are OK to span
    # Includes "his what?", "their what?", etc. where speaker pauses before a word
    interjection_only = re.match(
        r'^[,.\s]*('
        r'a what\??|right\??|amen\??|yes\??|who\??|'
        r'(?:his|her|your|my|its|their|a|an|the|to|of|with)\s+what\??'
        r')[,.\s]*$', 
        gap_clean, re.IGNORECASE
    )
    if interjection_only:
        return True
    
    # Commentary detection patterns - phrases that indicate the speaker is explaining, not quoting
    COMMENTARY_PATTERNS = [
        r'\bis\s+denoting\b',          # "is denoting"
        r'\bis\s+just\s+another\b',    # "is just another name"
        r'\bmeans\s+',                  # "means..."
        r'\bthat\s+is\s+',              # "that is..."
        r'\bin\s+other\s+words\b',      # "in other words"
        r'\bwhich\s+means\b',           # "which means"
        r'\bwe\s+see\b',                # "we see"
        r'\bwe\s+read\b',               # "we read"
        r'\bhe\s+says\b',               # "he says"
        r'\bthe\s+bible\s+says\b',      # "the bible says"
        r'\bthis\s+is\s+referring\b',   # "this is referring"
        r'\bthis\s+refers\b',           # "this refers"
        r'\bdenoting\s+a\b',            # "denoting a"
        r'\ba\s+ruler\s+or\s+a\s+king\b',  # specific commentary pattern
        r'^\s*a\s+what\?\s+',           # "a what?" at start followed by more text
    ]
    
    for pattern in COMMENTARY_PATTERNS:
        if re.search(pattern, gap_clean, re.IGNORECASE):
            return False  # This is commentary, not verse content
    
    # Check if gap content words appear in the verse text (allowing for interjections)
    # Remove known interjection patterns from gap for this check
    gap_without_interjections = re.sub(
        r'\ba what\?\b|\bwho\?\b|\b(?:his|her|your|my|its|their|a|an|the)\s+what\?\b', 
        '', gap_clean, flags=re.IGNORECASE
    )
    gap_words = get_words(gap_without_interjections)
    verse_words = get_words(verse_text)
    verse_words_set = set(verse_words)
    
    if len(gap_words) < 3:
        return True  # Too few words to judge
    
    # Count how many gap words appear in the verse
    matching_words = sum(1 for w in gap_words if w in verse_words_set)
    match_ratio = matching_words / len(gap_words)
    
    # If less than 50% of gap words are verse words, it's likely commentary
    if match_ratio < 0.5:
        return False
    
    return True


def find_verse_end_in_transcript(transcript: str, start_pos: int, verse_text: str,
                                   max_search: int = 1500, debug: bool = False) -> Optional[int]:
    """
    Find where the verse text ends in the transcript using word-by-word matching.
    
    PHASE 3 FIX: This function scans forward from the quote start to find where
    the verse content actually ends, handling transcription variations.
    
    Args:
        transcript: Full transcript text
        start_pos: Start position of the quote
        verse_text: The full verse text from Bible API
        max_search: Maximum characters to search
        debug: Whether to print debug information
    
    Returns:
        Position in transcript where verse text ends, or None if unreliable
    """
    verse_words = get_words(verse_text)
    if len(verse_words) < 3:
        return None
    
    search_region = transcript[start_pos:start_pos + max_search]
    
    # Get word positions in search region
    word_pattern = re.compile(r'\b\w+\b')
    word_matches = list(word_pattern.finditer(search_region))
    
    if not word_matches:
        return None
    
    search_words = [normalize_for_comparison(m.group()) for m in word_matches]
    
    # Track matching progress through verse words
    verse_idx = 0
    last_matched_pos = 0
    matched_count = 0
    skipped_count = 0
    
    for i, search_word in enumerate(search_words):
        if verse_idx >= len(verse_words):
            break  # Matched all verse words
        
        # Check for match (with fuzzy allowance)
        if _words_match_fuzzy(search_word, verse_words[verse_idx]):
            verse_idx += 1
            matched_count += 1
            last_matched_pos = word_matches[i].end()
            skipped_count = 0  # Reset skip counter
        else:
            # Allow skipping 1-2 words for interjections or minor variations
            skipped_count += 1
            
            # Check if we can match the NEXT verse word (speaker skipped a word)
            if verse_idx + 1 < len(verse_words) and _words_match_fuzzy(search_word, verse_words[verse_idx + 1]):
                verse_idx += 2  # Skip the missed word
                matched_count += 1
                last_matched_pos = word_matches[i].end()
                skipped_count = 0
            elif skipped_count > 5:
                # Too many consecutive non-matches - verse likely ended
                break
    
    # Calculate coverage - did we find most of the verse?
    coverage = matched_count / len(verse_words) if verse_words else 0
    
    if debug:
        print(f"      [END_FIND] Matched {matched_count}/{len(verse_words)} words ({coverage:.1%})")
    
    if coverage < 0.5:
        return None  # Insufficient coverage, boundary unreliable
    
    # Capture trailing punctuation after the last matched word
    end_absolute = start_pos + last_matched_pos
    trailing_text = transcript[end_absolute:end_absolute + 5]  # Look at next few chars
    
    # Extend past punctuation characters that are part of the verse ending
    punct_match = re.match(r'^[.,:;!?\'")\]]+', trailing_text)
    if punct_match:
        end_absolute += punct_match.end()
        if debug:
            print(f"      [END_FIND] Extended past trailing punctuation: '{punct_match.group()}'")
    
    return end_absolute


def _words_match_fuzzy(word1: str, word2: str, threshold: float = 0.8) -> bool:
    """
    Check if two words match, allowing for transcription variations.
    
    Handles common variations like:
    - "unto" vs "to"
    - "wholly" vs "holy"
    - Minor spelling differences
    """
    if word1 == word2:
        return True
    
    # Common substitutions in Bible text
    EQUIVALENTS = {
        ('unto', 'to'), ('to', 'unto'),
        ('thee', 'you'), ('you', 'thee'),
        ('thy', 'your'), ('your', 'thy'),
        ('thou', 'you'), ('you', 'thou'),
        ('hath', 'has'), ('has', 'hath'),
        ('doth', 'does'), ('does', 'doth'),
        ('ye', 'you'), ('you', 'ye'),
        ('saith', 'says'), ('says', 'saith'),
        ('wherefore', 'therefore'), ('therefore', 'wherefore'),
        ('wholly', 'holy'), ('holy', 'wholly'),  # Common transcription error
    }
    
    if (word1, word2) in EQUIVALENTS or (word2, word1) in EQUIVALENTS:
        return True
    
    # Fuzzy matching for longer words
    if len(word1) > 3 and len(word2) > 3:
        ratio = difflib.SequenceMatcher(None, word1, word2).ratio()
        return ratio >= threshold
    
    return False


def validate_quote_end(quote_text: str, verse_text: str, transcript: str, start_pos: int, end_pos: int, 
                       debug: bool = False) -> int:
    """
    Validate that the detected quote end actually matches verse content.
    
    ENHANCED (Phase 3): Now uses verse text as authoritative guide to:
    1. Extend the quote if verse content continues past detected end
    2. Trim the quote if it includes non-verse content
    
    Handles cases where:
    - Quote is cut short (missing "unto God which is your reasonable service")
    - Quote includes commentary (e.g., "Prince of Peace. That passage...")
    
    Args:
        quote_text: The detected quote text
        verse_text: The full verse text from API
        transcript: Full transcript
        start_pos: Start position of quote
        end_pos: Current end position of quote
        debug: Whether to print debug information
        
    Returns:
        Corrected end position
    """
    verse_words = get_words(verse_text)
    verse_words_set = set(verse_words)
    
    if len(verse_words) < 3:
        return end_pos
    
    # =========================================================================
    # PHASE 3 FIX: Try to find where the verse ACTUALLY ends in transcript
    # =========================================================================
    verse_end_pos = find_verse_end_in_transcript(transcript, start_pos, verse_text, debug=debug)
    
    if verse_end_pos and verse_end_pos > end_pos:
        # Verse content extends past our detected end - extend the quote
        # But validate that the extension contains verse words
        extension_text = transcript[end_pos:verse_end_pos]
        extension_words = get_words(extension_text)
        
        if extension_words:
            extension_matches = sum(1 for w in extension_words if w in verse_words_set)
            extension_ratio = extension_matches / len(extension_words)
            
            if extension_ratio >= 0.5:  # At least 50% verse words
                if debug:
                    print(f"      [END_VALIDATE] Extending quote by {verse_end_pos - end_pos} chars")
                    print(f"      [END_VALIDATE] Extension: '{extension_text[:50]}...'")
                return verse_end_pos
    
    # =========================================================================
    # Original validation: trim if end includes non-verse content
    # =========================================================================
    
    # Get the last portion of the detected quote
    last_chunk_size = min(40, len(quote_text))
    last_chunk = quote_text[-last_chunk_size:]
    last_words = get_words(last_chunk)
    
    if len(last_words) < 2:
        return end_pos
    
    verse_text_lower = verse_text.lower()
    
    # Check if the last few words appear in the verse
    last_few_words = last_words[-4:] if len(last_words) >= 4 else last_words
    last_phrase = ' '.join(last_few_words)
    
    # Check if this phrase appears in verse text
    if last_phrase in verse_text_lower:
        return end_pos  # End is valid
    
    # Check individual words - if most don't appear, we need to trim
    matching_words = sum(1 for w in last_few_words if w in verse_words_set)
    if matching_words >= len(last_few_words) * 0.7:
        return end_pos  # Mostly matching, end is valid
    
    # Need to find the actual end - search backwards for verse content
    # Look for sentence-ending punctuation followed by non-verse content
    quote_text_stripped = quote_text.rstrip()
    
    # Find potential end points (periods, question marks, etc.)
    potential_ends = []
    for i, char in enumerate(quote_text_stripped):
        if char in '.!?':
            potential_ends.append(i + 1)  # Position after the punctuation
    
    # Work backwards from each potential end to find one where previous content is verse
    for end_idx in reversed(potential_ends):
        if end_idx < 20:  # Too short
            continue
        
        # Get the text up to this end point
        candidate = quote_text_stripped[:end_idx]
        candidate_last_words = get_words(candidate[-30:])
        
        if len(candidate_last_words) < 2:
            continue
        
        # Check if these words appear in verse
        matching = sum(1 for w in candidate_last_words[-3:] if w in verse_words_set)
        if matching >= 2:
            # This looks like a valid end point
            if debug:
                print(f"      [END_VALIDATE] Trimming quote to sentence boundary at {end_idx}")
            return start_pos + end_idx
    
    return end_pos


def extend_quote_past_interjection(transcript: str, current_end: int, verse_text: str, max_look_ahead: int = 50) -> int:
    """
    Extend quote boundary to include verse content that appears after an interjection.
    
    Handles cases like: "There will your heart be, what? Also."
    Where "Also" is part of the verse but appears after the interjection "what?".
    
    Args:
        transcript: Full transcript text
        current_end: Current end position of the quote
        verse_text: The full verse text from API
        max_look_ahead: Maximum characters to look ahead for verse continuation
    
    Returns:
        Extended end position (may be same as current_end if no extension found)
    """
    verse_words = get_words(verse_text)
    verse_words_set = set(verse_words)
    
    # Get the last few words of the current quote to see what's already matched
    look_back = min(50, current_end)
    quote_end_text = transcript[current_end - look_back:current_end]
    quote_end_words = get_words(quote_end_text)
    
    # Find which verse words are NOT yet matched at the end
    # We're looking for words that should come after what we've matched
    if not quote_end_words:
        return current_end
    
    last_matched_word = quote_end_words[-1] if quote_end_words else ''
    
    # Find the position of the last matched word in the verse
    last_matched_idx = -1
    for i, vw in enumerate(verse_words):
        if vw == last_matched_word:
            last_matched_idx = i
    
    # If we couldn't find the match, try the second-to-last word
    if last_matched_idx == -1 and len(quote_end_words) >= 2:
        second_last = quote_end_words[-2]
        for i, vw in enumerate(verse_words):
            if vw == second_last:
                last_matched_idx = i
    
    if last_matched_idx == -1 or last_matched_idx >= len(verse_words) - 1:
        # Either couldn't find match or we're already at the end of the verse
        return current_end
    
    # There are remaining verse words after what we've matched
    remaining_verse_words = verse_words[last_matched_idx + 1:]
    
    if not remaining_verse_words:
        return current_end
    
    # Look ahead in the transcript for these remaining words
    look_ahead_text = transcript[current_end:current_end + max_look_ahead]
    look_ahead_words = get_words(look_ahead_text)
    
    # Find the remaining verse words after any interjection
    # Common interjections: what?, right?, amen?, who?, etc.
    interjection_words = {'what', 'right', 'amen', 'yes', 'okay', 'huh', 'who'}
    
    best_extension = current_end
    for i, word in enumerate(look_ahead_words):
        # Skip interjection words
        if word in interjection_words:
            continue
        
        # Check if this word matches the next expected verse word
        if word == remaining_verse_words[0]:
            # Found the continuation! Find where this word ends
            word_pattern = re.compile(r'\b' + re.escape(word) + r'\b', re.IGNORECASE)
            for match in word_pattern.finditer(look_ahead_text):
                word_end_pos = current_end + match.end()
                
                # Check for additional remaining verse words
                extended_end = word_end_pos
                if len(remaining_verse_words) > 1:
                    # Look for more verse words after this one
                    remaining_text = transcript[word_end_pos:word_end_pos + 30]
                    remaining_look_words = get_words(remaining_text)
                    for j, next_remaining in enumerate(remaining_verse_words[1:]):
                        if j < len(remaining_look_words) and remaining_look_words[j] == next_remaining:
                            # Find position of this word
                            next_pattern = re.compile(r'\b' + re.escape(next_remaining) + r'\b', re.IGNORECASE)
                            for next_match in next_pattern.finditer(remaining_text):
                                extended_end = word_end_pos + next_match.end()
                                break
                
                # Include trailing punctuation
                while extended_end < len(transcript) and transcript[extended_end] in '.,;:!?':
                    extended_end += 1
                
                best_extension = extended_end
                break
            break  # Found the first matching word, stop looking
    
    return best_extension


# ============================================================================
# INTRODUCTORY PHRASE DETECTION
# ============================================================================

# Common patterns that introduce Bible quotes after the reference
# These patterns appear BETWEEN the verse reference and the actual quoted text
# ENHANCED: Now includes compound patterns like "says Paul writes"
INTRO_PHRASE_PATTERNS = [
    # === COMPOUND ATTRIBUTION PATTERNS (check these FIRST as they're longer) ===
    # "says [Name] writes/says" patterns
    r'(?:says?|tells?\s+us)\s+(?:Paul|Jesus|David|Moses|Peter|John|James|Solomon|Isaiah|Jeremiah|the\s+(?:Lord|apostle|prophet))\s+(?:writes?|says?|tells?\s+us|wrote|said)\s+',
    # "writes [Name] says" patterns (less common but occurs)
    r'(?:writes?)\s+(?:Paul|Jesus|David|Moses|Peter|John|James|Solomon|Isaiah|Jeremiah)\s+(?:says?|tells?\s+us|said)\s+',
    # "he/she says [action] that" patterns
    r'(?:he|she|it)\s+(?:says?|tells?\s+us|writes?)\s+(?:here|there|to\s+us|unto\s+us)?\s*',
    
    # === AUTHOR ATTRIBUTION PATTERNS ===
    # "Paul writes", "Jesus says", "David said" - author before verb
    r'(?:Paul|Jesus|David|Moses|Peter|John|James|Solomon|Isaiah|Jeremiah|the\s+(?:Lord|apostle|prophet))\s+(?:says?|writes?|wrote|said|tells?\s+us)\s+',
    
    # === SIMPLE ATTRIBUTION PATTERNS ===
    # Single verb patterns (e.g., "says", "writes", "tells us")
    r'(?:says?|writes?|tells?\s+us|teaches?|declares?|proclaims?|records?|states?|reads?)\s+',
    
    # === CONTINUATION/CONTEXT PATTERNS ===
    # "the Bible says", "Scripture says", "the Word says"
    r'(?:the\s+)?(?:Bible|Scripture|Word|Lord)\s+(?:says?|tells?\s+us|writes?)\s+',
    
    # === QUOTE MARKER PATTERNS ===
    # "quote", "and I quote", etc.
    r'(?:quote|and\s+I\s+quote)\s*[,:]?\s*',
    # "let's read", "it reads"
    r'(?:let(?:\'s)?\s+read|it\s+reads?)\s*[,:]?\s*',
    
    # === VERSE LOCATION PATTERNS ===
    # "verse X says", "in verse X we read"
    r'(?:verse\s+\d+\s+)?(?:says?|we\s+read)\s+',
]

# Combined pattern for all intro phrases
INTRO_PHRASE_COMBINED = '|'.join(INTRO_PHRASE_PATTERNS)


def extract_reference_intro_length(transcript: str, ref_position: int, ref_length: int, 
                                    max_intro_length: int = 150) -> int:
    """
    Calculate how much text to skip past the reference to reach the quoted text.
    
    This handles cases where speakers use introductory phrases after the reference:
    - "Romans 12:1 says..." (skip past "says ")
    - "Paul writes in Romans 12:1..." (the intro comes BEFORE the reference)
    - "Romans 12 one says Paul writes I beseech you..." (skip past "says Paul writes ")
    
    ENHANCED: Now handles compound/chained intro patterns by applying patterns
    repeatedly until no more matches are found.
    
    Args:
        transcript: The full transcript text
        ref_position: Position where the reference starts in the transcript
        ref_length: Length of the reference text itself
        max_intro_length: Maximum characters to search for intro phrases (default 150)
    
    Returns:
        Total length to skip (ref_length + intro phrase length)
    """
    # Start searching immediately after the reference
    search_start = ref_position + ref_length
    search_end = min(search_start + max_intro_length, len(transcript))
    
    if search_start >= len(transcript):
        return ref_length
    
    # Text immediately following the reference
    after_ref = transcript[search_start:search_end]
    
    # Try to match intro patterns at the start of this text
    # ENHANCED: Apply patterns REPEATEDLY to catch compound patterns
    total_intro_length = 0
    remaining_text = after_ref
    
    # Compile pattern once
    intro_pattern = re.compile(
        r'^[\s,]*(?:' + INTRO_PHRASE_COMBINED + r')',
        re.IGNORECASE
    )
    
    # Apply patterns up to 5 times to catch compound chains
    for _ in range(5):
        match = intro_pattern.match(remaining_text)
        if match:
            matched_length = match.end()
            total_intro_length += matched_length
            remaining_text = remaining_text[matched_length:]
        else:
            break
    
    return ref_length + total_intro_length


def validate_start_is_verse_text(transcript: str, detected_start: int, verse_text: str,
                                  max_search_forward: int = 100, debug: bool = False) -> int:
    """
    Verify that detected_start points to actual verse text, not intro phrases.
    
    This function provides an additional layer of validation after intro phrase
    detection to ensure we're capturing the actual Bible verse content.
    
    PHASE 2 FIX: Handles cases where intro detection misses patterns like
    "his face. Romans 12 one says Paul writes I beseech you..."
    
    Args:
        transcript: Full transcript text
        detected_start: Proposed start position of the quote
        verse_text: The expected verse text from Bible API
        max_search_forward: Maximum characters to search forward for better match
        debug: Whether to print debug information
    
    Returns:
        Adjusted start position that matches verse beginning
    """
    verse_words = get_words(verse_text)
    if len(verse_words) < 3:
        return detected_start  # Can't validate short verses
    
    # First 5 words of verse are our "fingerprint"
    first_verse_words = verse_words[:min(5, len(verse_words))]
    
    # Check if detected start matches verse start
    detected_text = transcript[detected_start:detected_start + 150]
    detected_words = get_words(detected_text)[:len(first_verse_words)]
    
    if not detected_words:
        return detected_start
    
    # Calculate initial match score
    initial_matches = sum(1 for i, w in enumerate(detected_words) 
                         if i < len(first_verse_words) and w == first_verse_words[i])
    
    if debug:
        print(f"      [START_VALIDATE] Initial match: {initial_matches}/{len(first_verse_words)} words")
        print(f"      [START_VALIDATE] Verse starts: '{' '.join(first_verse_words)}'")
        print(f"      [START_VALIDATE] Detected starts: '{' '.join(detected_words)}'")
    
    # If initial match is good (>= 60%), use original position
    if initial_matches >= len(first_verse_words) * 0.6:
        return detected_start
    
    # Search forward for better match
    best_pos = detected_start
    best_score = initial_matches
    
    # Use word boundaries to search
    word_pattern = re.compile(r'\b(' + re.escape(first_verse_words[0]) + r')\b', re.IGNORECASE)
    
    search_area = transcript[detected_start:detected_start + max_search_forward]
    
    for match in word_pattern.finditer(search_area):
        search_pos = detected_start + match.start()
        search_text = transcript[search_pos:search_pos + 150]
        search_words = get_words(search_text)[:len(first_verse_words)]
        
        matches = sum(1 for i, w in enumerate(search_words)
                     if i < len(first_verse_words) and w == first_verse_words[i])
        
        if matches > best_score:
            best_score = matches
            best_pos = search_pos
            
            if debug:
                print(f"      [START_VALIDATE] Better match at +{search_pos - detected_start}: {matches}/{len(first_verse_words)}")
    
    # Only use new position if it's significantly better
    if best_score > initial_matches and best_pos > detected_start:
        if debug:
            print(f"      [START_VALIDATE] Adjusted start forward by {best_pos - detected_start} chars")
        return best_pos
    
    return detected_start


def find_quote_boundaries_improved(verse_text: str, transcript: str, ref_position: int, 
                                   ref_length: int = 0, debug: bool = False) -> Optional[Tuple[int, int, float]]:
    """
    Improved quote boundary detection using bidirectional distinctive phrase matching.
    
    This method extracts distinctive phrases from the Bible verse and searches
    for them in the transcript BOTH before and after the reference position.
    This handles the common pattern where a speaker mentions a verse reference
    and then immediately quotes it: "Romans 12:1 says I beseech you..."
    
    The algorithm prioritizes forward matches (after the reference) since that's
    the most common sermon pattern, but falls back to backward matches when needed.
    
    Args:
        verse_text: The actual Bible verse text from API
        transcript: The sermon transcript
        ref_position: Position of the reference in the transcript
        ref_length: Length of the reference text to skip past (e.g., "Matthew 6:33" = 12 chars)
                   This is automatically extended to include any detected intro phrases.
        debug: Whether to output debug logging for boundary detection decisions
    
    Returns:
        Tuple of (start_pos, end_pos, confidence) or None
    """
    verse_words = get_words(verse_text)
    
    if len(verse_words) < 4:
        if debug:
            print(f"  [DEBUG] Verse too short ({len(verse_words)} words), skipping")
        return None
    
    # Extend ref_length to include any introductory phrases (e.g., "says", "Paul writes")
    effective_ref_length = extract_reference_intro_length(transcript, ref_position, ref_length)
    
    if debug and effective_ref_length > ref_length:
        intro_text = transcript[ref_position + ref_length:ref_position + effective_ref_length]
        print(f"  [DEBUG] Detected intro phrase: '{intro_text.strip()}'")
    
    # =========================================================================
    # BIDIRECTIONAL SEARCH: Search both FORWARD and BACKWARD from reference
    # =========================================================================
    
    # Forward search region: starts after reference+intro, extends ~6000 chars
    forward_search_start = ref_position + effective_ref_length
    forward_search_end = min(ref_position + 6000, len(transcript))
    
    # Backward search region: starts ~500 chars BEFORE reference
    backward_search_distance = 500
    backward_search_start = max(0, ref_position - backward_search_distance)
    backward_search_end = ref_position  # Don't include the reference itself
    
    if debug:
        print(f"  [DEBUG] Reference position: {ref_position}, ref_length: {ref_length}, effective: {effective_ref_length}")
        print(f"  [DEBUG] Forward search: [{forward_search_start}, {forward_search_end}]")
        print(f"  [DEBUG] Backward search: [{backward_search_start}, {backward_search_end}]")
        # Show snippets of the search regions
        forward_snippet = transcript[forward_search_start:forward_search_start + 150].replace('\n', ' ')
        print(f"  [DEBUG] Forward region starts: '{forward_snippet}...'")
        if backward_search_start < backward_search_end:
            backward_snippet = transcript[max(backward_search_end - 150, backward_search_start):backward_search_end].replace('\n', ' ')
            print(f"  [DEBUG] Backward region ends: '...{backward_snippet}'")
    
    # Extract distinctive phrases from the verse
    phrases = find_distinctive_phrases(verse_text)
    
    if not phrases:
        if debug:
            print(f"  [DEBUG] No distinctive phrases found in verse")
        return None
    
    if debug:
        print(f"  [DEBUG] Extracted {len(phrases)} distinctive phrases from verse")
    
    # =========================================================================
    # FORWARD SEARCH: Look for phrase matches AFTER the reference
    # =========================================================================
    forward_matches = []
    for phrase_idx, phrase in enumerate(phrases):
        result = find_best_phrase_match([phrase], transcript, forward_search_start, forward_search_end)
        if result:
            start, end, score, _ = result
            forward_matches.append((start, end, score, phrase_idx, 'forward'))
            if debug:
                matched_text = transcript[start:end]
                print(f"  [DEBUG] Forward match [{phrase_idx}]: '{matched_text}' at {start}-{end} (score: {score:.2f})")
    
    # =========================================================================
    # BACKWARD SEARCH: Look for phrase matches BEFORE the reference
    # (Only search if there's a meaningful backward region)
    # =========================================================================
    backward_matches = []
    if backward_search_end > backward_search_start + 10:  # At least 10 chars to search
        for phrase_idx, phrase in enumerate(phrases):
            result = find_best_phrase_match([phrase], transcript, backward_search_start, backward_search_end)
            if result:
                start, end, score, _ = result
                backward_matches.append((start, end, score, phrase_idx, 'backward'))
                if debug:
                    matched_text = transcript[start:end]
                    print(f"  [DEBUG] Backward match [{phrase_idx}]: '{matched_text}' at {start}-{end} (score: {score:.2f})")
    
    if debug:
        print(f"  [DEBUG] Total matches: {len(forward_matches)} forward, {len(backward_matches)} backward")
    
    # =========================================================================
    # DIRECTION SELECTION: Prefer forward matches (most common sermon pattern)
    # =========================================================================
    
    # Evaluate forward matches for significance
    forward_significant = _evaluate_match_significance(forward_matches, phrases)
    backward_significant = _evaluate_match_significance(backward_matches, phrases)
    
    if debug:
        print(f"  [DEBUG] Forward significance: {forward_significant}")
        print(f"  [DEBUG] Backward significance: {backward_significant}")
    
    # Decision logic: prefer forward matches unless backward is clearly better
    selected_matches = []
    search_direction = 'forward'
    
    if forward_matches and forward_significant['is_significant']:
        # Forward region has significant matches - use it
        selected_matches = forward_matches
        search_direction = 'forward'
        if debug:
            print(f"  [DEBUG] Selected FORWARD matches (significant cluster)")
    elif backward_matches and backward_significant['is_significant'] and not forward_matches:
        # No forward matches but backward has significant matches
        selected_matches = backward_matches
        search_direction = 'backward'
        if debug:
            print(f"  [DEBUG] Selected BACKWARD matches (no forward, backward is significant)")
    elif forward_matches:
        # Forward has some matches (even if not fully significant) - prefer it
        selected_matches = forward_matches
        search_direction = 'forward'
        if debug:
            print(f"  [DEBUG] Selected FORWARD matches (has matches, preferred direction)")
    elif backward_matches:
        # Only backward matches available
        selected_matches = backward_matches
        search_direction = 'backward'
        if debug:
            print(f"  [DEBUG] Selected BACKWARD matches (only option)")
    else:
        # No matches in either direction
        if debug:
            print(f"  [DEBUG] No matches found in either direction")
        return None
    
    # =========================================================================
    # CLUSTER ANALYSIS: Group contiguous matches and find best cluster
    # =========================================================================
    
    # Sort matches by position (remove direction marker for processing)
    all_matches = [(m[0], m[1], m[2], m[3]) for m in selected_matches]
    all_matches.sort(key=lambda x: x[0])
    
    if not all_matches:
        return None
    
    # Filter for contiguity AND validate gap content between matches
    # This prevents including commentary text that happens to contain verse-like phrases
    MAX_GAP_BETWEEN_PHRASES = 300  # Maximum chars between consecutive phrase matches
    MIN_GAP_TO_VALIDATE = 30  # Only validate gaps larger than this
    
    # Find clusters of contiguous matches
    clusters = []
    current_cluster = [all_matches[0]]
    
    for match in all_matches[1:]:
        prev_match = current_cluster[-1]
        gap_start = prev_match[1]
        gap_end = match[0]
        gap_size = gap_end - gap_start
        
        # Check if gap is within size limit
        if gap_size > MAX_GAP_BETWEEN_PHRASES:
            # Gap too large, start new cluster
            clusters.append(current_cluster)
            current_cluster = [match]
        elif gap_size > MIN_GAP_TO_VALIDATE:
            # Validate that gap content is verse text, not commentary
            gap_text = transcript[gap_start:gap_end]
            if validate_gap_is_verse_content(gap_text, verse_text):
                current_cluster.append(match)
            else:
                # Gap contains commentary - start new cluster
                clusters.append(current_cluster)
                current_cluster = [match]
        else:
            # Small gap, assume it's verse content
            current_cluster.append(match)
    
    clusters.append(current_cluster)  # Add the last cluster
    
    if debug:
        print(f"  [DEBUG] Found {len(clusters)} match clusters")
        for i, cluster in enumerate(clusters):
            phrase_indices = [m[3] for m in cluster]
            print(f"    Cluster {i}: {len(cluster)} matches, phrase indices: {phrase_indices}")
    
    # Identify significant clusters and track which verse phrase indices they cover
    # A significant cluster has at least 3 matches or covers the verse start/end
    significant_clusters = []
    for cluster in clusters:
        phrase_indices = set(m[3] for m in cluster)
        has_start = 0 in phrase_indices or 1 in phrase_indices  # First phrases
        has_end = (len(phrases) - 1) in phrase_indices or (len(phrases) - 2) in phrase_indices  # Last phrases
        
        if len(cluster) >= 3 or has_start or has_end:
            # Calculate what portion of the verse this cluster represents
            max_phrase_idx = max(m[3] for m in cluster)
            min_phrase_idx = min(m[3] for m in cluster)
            significant_clusters.append({
                'cluster': cluster,
                'phrase_indices': phrase_indices,
                'min_phrase': min_phrase_idx,
                'max_phrase': max_phrase_idx,
                'has_start': has_start,
                'has_end': has_end
            })
    
    if not significant_clusters:
        # Fall back to largest cluster
        selected_cluster = max(clusters, key=len)
        first_match = selected_cluster[0]
        last_match = selected_cluster[-1]
    else:
        # Check if we have multiple significant clusters covering different parts
        # If so, we might have quote + commentary + quote continuation
        
        # Sort significant clusters by their position in the verse (min_phrase)
        significant_clusters.sort(key=lambda c: c['min_phrase'])
        
        # Start with the first significant cluster
        first_cluster = significant_clusters[0]
        first_match = first_cluster['cluster'][0]
        last_match = first_cluster['cluster'][-1]
        max_covered_phrase = first_cluster['max_phrase']
        
        # Check if later clusters cover LATER parts of the verse (not repeats)
        for later_cluster in significant_clusters[1:]:
            # If this cluster covers phrases AFTER what we've covered, include it
            if later_cluster['min_phrase'] > max_covered_phrase:
                # This is a continuation, not a repeat
                last_match = later_cluster['cluster'][-1]
                max_covered_phrase = later_cluster['max_phrase']
            elif later_cluster['has_end'] and not first_cluster['has_end']:
                # This cluster has the verse ending, include it
                last_match = later_cluster['cluster'][-1]
                max_covered_phrase = max(max_covered_phrase, later_cluster['max_phrase'])
    
    start_pos = first_match[0]
    end_pos = last_match[1]
    
    if debug:
        print(f"  [DEBUG] Initial boundaries: {start_pos}-{end_pos}")
        print(f"  [DEBUG] Quote text: '{transcript[start_pos:end_pos][:100]}...'")
    
    # PHASE 2 FIX: Validate and adjust start position to exclude intro phrases
    # This handles cases where phrase matching catches intro text
    validated_start = validate_start_is_verse_text(transcript, start_pos, verse_text, 
                                                    max_search_forward=100, debug=debug)
    if validated_start != start_pos:
        if debug:
            print(f"  [DEBUG] Adjusted start forward from {start_pos} to {validated_start}")
        start_pos = validated_start
    
    # Validate and potentially trim the quote end
    quote_text = transcript[start_pos:end_pos]
    validated_end = validate_quote_end(quote_text, verse_text, transcript, start_pos, end_pos, debug=debug)
    if validated_end != end_pos:
        if debug:
            print(f"  [DEBUG] Trimmed quote end from {end_pos} to {validated_end}")
        end_pos = validated_end
    
    # Check for verse content that continues after an interjection
    # e.g., "There will your heart be, what? Also." - "Also" is part of the verse
    extended_end = extend_quote_past_interjection(transcript, end_pos, verse_text)
    if extended_end > end_pos:
        if debug:
            print(f"  [DEBUG] Extended quote past interjection from {end_pos} to {extended_end}")
        end_pos = extended_end
    
    # Collect all matches that fall within our boundaries for confidence calculation
    matches_in_range = [m for m in all_matches if m[0] >= start_pos and m[1] <= end_pos]
    
    # Calculate overall confidence
    if matches_in_range:
        avg_confidence = sum(m[2] for m in matches_in_range) / len(matches_in_range)
    else:
        avg_confidence = 0.5
    
    # Validate: make sure we have both start and end coverage
    phrase_indices_covered = set(m[3] for m in matches_in_range)
    has_start_coverage = 0 in phrase_indices_covered or 1 in phrase_indices_covered
    has_end_coverage = (len(phrases) - 1) in phrase_indices_covered or (len(phrases) - 2) in phrase_indices_covered
    
    if not has_start_coverage and not has_end_coverage:
        # We might have only middle matches, which is unreliable
        avg_confidence *= 0.7
    
    # =========================================================================
    # CONFIDENCE ADJUSTMENTS based on search direction and proximity
    # =========================================================================
    
    # Proximity bonus: quote starts close to reference (within 100 chars after)
    distance_from_ref = start_pos - (ref_position + effective_ref_length)
    if 0 <= distance_from_ref <= 100 and search_direction == 'forward':
        avg_confidence = min(1.0, avg_confidence + 0.05)
        if debug:
            print(f"  [DEBUG] Proximity bonus applied (+0.05), distance: {distance_from_ref}")
    
    # Direction penalty: backward matches are less common, lower confidence
    if search_direction == 'backward':
        avg_confidence = max(0.0, avg_confidence - 0.10)
        if debug:
            print(f"  [DEBUG] Backward direction penalty applied (-0.10)")
    
    # Length validation: reject matches that are too short or too long
    quote_length = end_pos - start_pos
    if quote_length < 10:
        if debug:
            print(f"  [DEBUG] Quote too short ({quote_length} chars), rejecting")
        return None
    if quote_length > 5000:
        if debug:
            print(f"  [DEBUG] Quote too long ({quote_length} chars), rejecting")
        return None
    
    if debug:
        print(f"  [DEBUG] Final boundaries: {start_pos}-{end_pos}, confidence: {avg_confidence:.2f}")
    
    return (start_pos, end_pos, avg_confidence)


def _evaluate_match_significance(matches: list, phrases: list) -> dict:
    """
    Evaluate whether a set of matches is significant enough to represent a valid quote.
    
    Args:
        matches: List of match tuples (start, end, score, phrase_idx, direction)
        phrases: List of distinctive phrases from the verse
    
    Returns:
        Dict with significance info: is_significant, match_count, has_start, has_end
    """
    if not matches:
        return {
            'is_significant': False,
            'match_count': 0,
            'has_start': False,
            'has_end': False,
            'phrase_coverage': 0.0
        }
    
    phrase_indices = set(m[3] for m in matches)
    has_start = 0 in phrase_indices or 1 in phrase_indices
    has_end = (len(phrases) - 1) in phrase_indices or (len(phrases) - 2) in phrase_indices
    
    # Calculate phrase coverage
    phrase_coverage = len(phrase_indices) / len(phrases) if phrases else 0.0
    
    # A match set is significant if:
    # 1. Has 3+ matches, OR
    # 2. Has both start and end coverage, OR
    # 3. Has high phrase coverage (>50%)
    is_significant = (
        len(matches) >= 3 or 
        (has_start and has_end) or 
        phrase_coverage > 0.5
    )
    
    return {
        'is_significant': is_significant,
        'match_count': len(matches),
        'has_start': has_start,
        'has_end': has_end,
        'phrase_coverage': phrase_coverage
    }

# ============================================================================
# PARTIAL VERSE RANGE DETECTION
# ============================================================================

def fetch_verse_range_individual(api_client: BibleAPIClient, book: str, chapter: int, 
                                  start_verse: int, end_verse: int) -> Dict[int, str]:
    """
    Fetch individual verses in a range for precise matching.
    
    When a speaker announces a verse range but only reads part of it,
    we need to detect which specific verses actually appear in the transcript.
    
    Args:
        api_client: BibleAPIClient instance
        book: Book name (e.g., "Matthew")
        chapter: Chapter number
        start_verse: First verse in range
        end_verse: Last verse in range
    
    Returns:
        Dict mapping verse number to verse text
    """
    verses = {}
    
    # Use the bulk API for efficiency
    book_id = BOOK_ID_MAP.get(book)
    if not book_id:
        print(f"  ⚠ Unknown book: {book}")
        return verses
    
    try:
        # Use POST endpoint for fetching specific verses
        url = f"{BIBLE_API_BASE}/get-verses/"
        payload = [{
            'translation': api_client.translation,
            'book': book_id,
            'chapter': chapter,
            'verses': list(range(start_verse, end_verse + 1))
        }]
        
        api_client._rate_limit()
        response = requests.post(url, json=payload, timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                for verse_data in data[0]:
                    verse_num = verse_data.get('verse')
                    verse_text = verse_data.get('text', '')
                    if verse_num and verse_text:
                        verses[verse_num] = api_client._clean_html(verse_text)
    except requests.RequestException as e:
        print(f"  ⚠ Request error for {book} {chapter}:{start_verse}-{end_verse}: {e}")
        # Fallback: fetch individually
        for verse_num in range(start_verse, end_verse + 1):
            ref = f"{book} {chapter}:{verse_num}"
            result = api_client.get_verse(ref)
            if result and 'text' in result:
                verses[verse_num] = result['text'].strip()
    
    return verses


def detect_matching_verse_subset(individual_verses: Dict[int, str], transcript: str, 
                                  search_start: int, search_window: int = 6000,
                                  min_confidence: float = 0.6,
                                  first_verse_num: Optional[int] = None) -> Tuple[Optional[int], Optional[int], List[Tuple[int, int, int, float]]]:
    """
    Detect which verses from a range actually appear in the transcript.
    
    This handles the case where a speaker announces "verses 1-12" but
    actually only reads verses 7-12.
    
    Also handles cases where speakers skip connector words at verse starts
    (e.g., "But when the fulness..." spoken as "When the fulness...").
    
    Args:
        individual_verses: Dict mapping verse number to verse text
        transcript: The sermon transcript
        search_start: Position to start searching from
        search_window: How far ahead to search
        min_confidence: Minimum confidence threshold for verse detection.
                       For extending beyond explicitly referenced verses, use 0.8.
        first_verse_num: The explicitly referenced first verse number. Verses
                        beyond this require higher confidence to prevent false positives.
    
    Returns:
        Tuple of (first_matching_verse, last_matching_verse, matches_list)
        where matches_list contains (verse_num, start_pos, end_pos, confidence)
    """
    search_end = min(search_start + search_window, len(transcript))
    search_area = transcript[search_start:search_end]
    
    # Find word positions in ORIGINAL text and normalize them for matching
    # This ensures index consistency between matching and position lookup
    word_pattern = re.compile(r'\b\w+\b')
    word_matches_in_area = list(word_pattern.finditer(search_area))
    
    # Normalize each word for matching (but keep original positions)
    search_area_words = [normalize_for_comparison(m.group()) for m in word_matches_in_area]
    
    # Common Bible verse connector words that speakers often skip at the start of verses
    SKIP_WORDS = {'but', 'and', 'for', 'then', 'now', 'so', 'yet', 'or', 'therefore', 'wherefore', 'behold'}
    
    matches = []
    
    for verse_num, verse_text in sorted(individual_verses.items()):
        verse_words = get_words(verse_text)
        
        if len(verse_words) < 3:
            continue
        
        # Build multiple anchor candidates: starting from word 0, and also skipping skip words
        # This handles cases like "But when..." being spoken as "When..."
        # IMPORTANT: When first word is a skip word, we put skip-word anchors FIRST
        # because speakers often omit these words, and we want to find the actual quote
        # location rather than a false positive elsewhere that happens to contain the skip word.
        anchor_candidates = []
        anchor_size = min(6, len(verse_words))
        
        # Check if first word is a skip word
        first_is_skip = verse_words[0] in SKIP_WORDS if verse_words else False
        
        if first_is_skip and len(verse_words) > anchor_size:
            # Put skip-word anchors FIRST when first word is skippable
            # Secondary anchor: skip first word
            anchor_candidates.append(verse_words[1:1 + anchor_size])
            
            # Tertiary anchor: skip first two words if both are skip words
            if len(verse_words) > anchor_size + 1 and verse_words[1] in SKIP_WORDS:
                anchor_candidates.append(verse_words[2:2 + anchor_size])
            
            # Primary anchor last (with skip word)
            anchor_candidates.append(verse_words[:anchor_size])
        else:
            # Normal order: primary anchor first
            anchor_candidates.append(verse_words[:anchor_size])
            
            if len(verse_words) > anchor_size and verse_words[0] in SKIP_WORDS:
                anchor_candidates.append(verse_words[1:1 + anchor_size])
                if len(verse_words) > anchor_size + 1 and verse_words[1] in SKIP_WORDS:
                    anchor_candidates.append(verse_words[2:2 + anchor_size])
        
        # Search for any anchor candidate in search area words
        # Stop searching once we find a good match (>= 0.6) with an earlier anchor
        best_match_idx = None
        best_match_score = 0
        found_with_preferred_anchor = False
        
        for anchor_idx, anchor_words in enumerate(anchor_candidates):
            # If we already found a match with a preferred (earlier) anchor, skip remaining
            if found_with_preferred_anchor:
                break
                
            for i in range(len(search_area_words) - len(anchor_words) + 1):
                window = search_area_words[i:i + len(anchor_words)]
                
                # Count matching words with fuzzy matching
                matches_count = 0
                for anchor_word, window_word in zip(anchor_words, window):
                    if anchor_word == window_word:
                        matches_count += 1
                    elif len(anchor_word) > 3 and len(window_word) > 3:
                        if difflib.SequenceMatcher(None, anchor_word, window_word).ratio() > 0.8:
                            matches_count += 0.8
                
                score = matches_count / len(anchor_words)
                
                # Determine the confidence threshold for this verse
                # Use the base min_confidence for the first (explicitly referenced) verse,
                # but require higher confidence (0.8) for subsequent verses to prevent
                # false positives from common phrases like "and the LORD God"
                required_confidence = min_confidence
                if first_verse_num is not None and verse_num > first_verse_num:
                    required_confidence = max(min_confidence, 0.8)  # At least 80% for extensions
                
                if score > best_match_score and score >= required_confidence:
                    best_match_score = score
                    best_match_idx = i
                    # If this is a preferred anchor (skip-word anchor when first word is skip),
                    # mark that we found a match so we stop looking at later anchors
                    if first_is_skip and anchor_idx < len(anchor_candidates) - 1:
                        found_with_preferred_anchor = True
        
        # Also apply the confidence threshold when deciding if we found a match
        required_confidence = min_confidence
        if first_verse_num is not None and verse_num > first_verse_num:
            required_confidence = max(min_confidence, 0.8)
        
        if best_match_idx is not None and best_match_score >= required_confidence:
            # Get character position from word match (indices are now consistent)
            char_start = word_matches_in_area[best_match_idx].start()
            
            # For the end position, try to match the last words of the verse
            end_anchor_size = min(5, len(verse_words))
            end_anchor_words = verse_words[-end_anchor_size:]
            
            # Search for end anchor starting from best_match_idx
            best_end_idx = None
            best_end_score = 0
            search_range_start = best_match_idx + max(0, len(verse_words) - end_anchor_size - 10)
            search_range_end = min(best_match_idx + len(verse_words) + 15, len(search_area_words) - end_anchor_size + 1)
            
            for j in range(search_range_start, search_range_end):
                window = search_area_words[j:j + end_anchor_size]
                
                # Count matching words
                end_matches = 0
                for end_anchor, win_word in zip(end_anchor_words, window):
                    if end_anchor == win_word:
                        end_matches += 1
                    elif len(end_anchor) > 3 and len(win_word) > 3:
                        if difflib.SequenceMatcher(None, end_anchor, win_word).ratio() > 0.8:
                            end_matches += 0.8
                
                end_score = end_matches / end_anchor_size
                if end_score > best_end_score and end_score >= 0.5:
                    best_end_score = end_score
                    best_end_idx = j + end_anchor_size - 1
            
            if best_end_idx is not None:
                char_end = word_matches_in_area[best_end_idx].end()
            else:
                # Fallback: estimate end based on verse length
                estimated_end_word_idx = min(best_match_idx + len(verse_words), len(word_matches_in_area) - 1)
                char_end = word_matches_in_area[estimated_end_word_idx].end()
            
            # Convert to absolute positions
            abs_start = search_start + char_start
            abs_end = search_start + char_end
            
            matches.append((verse_num, abs_start, abs_end, best_match_score))
    
    if not matches:
        return (None, None, [])
    
    # Sort matches by position
    matches.sort(key=lambda x: x[1])
    
    # Filter for contiguity - remove matches that are too far from the previous match
    # This prevents false positives where similar phrases appear much later in the text
    MAX_GAP_BETWEEN_VERSES = 500  # Maximum characters between end of one verse and start of next
    filtered_matches = []
    for match in matches:
        verse_num, start_pos, end_pos, score = match
        if filtered_matches:
            prev_verse_num, prev_start, prev_end, prev_score = filtered_matches[-1]
            gap = start_pos - prev_end
            if gap > MAX_GAP_BETWEEN_VERSES:
                # This match is too far from the previous one - likely a false positive
                # Skip it
                continue
        filtered_matches.append(match)
    
    matches = filtered_matches
    
    if not matches:
        return (None, None, [])
    
    # Determine the actual verse range that appears
    first_verse = min(m[0] for m in matches)
    last_verse = max(m[0] for m in matches)
    
    return (first_verse, last_verse, matches)


def build_composite_verse_text(individual_verses: Dict[int, str], 
                                first_verse: Optional[int], last_verse: Optional[int]) -> str:
    """
    Build composite text from a subset of verses.
    
    Args:
        individual_verses: Dict mapping verse number to verse text
        first_verse: First verse to include (None returns empty string)
        last_verse: Last verse to include (None returns empty string)
    
    Returns:
        Combined verse text
    """
    if first_verse is None or last_verse is None:
        return ''
    
    texts = []
    for verse_num in range(first_verse, last_verse + 1):
        if verse_num in individual_verses:
            texts.append(individual_verses[verse_num])
    
    return ' '.join(texts)


def find_quote_boundaries_with_subset(individual_verses: Dict[int, str], matches: List[Tuple[int, int, int, float]], 
                                       first_verse: Optional[int], last_verse: Optional[int]) -> Optional[Tuple[int, int, float]]:
    """
    Determine precise quote boundaries from matched verse subset.
    
    Args:
        individual_verses: Dict mapping verse number to verse text
        matches: List of (verse_num, start_pos, end_pos, confidence)
        first_verse: First matching verse number (None returns None)
        last_verse: Last matching verse number (None returns None)
    
    Returns:
        Tuple of (start_pos, end_pos, confidence) or None
    """
    if not matches or first_verse is None or last_verse is None:
        return None
    
    # Get the position of the first matching verse
    first_verse_matches = [m for m in matches if m[0] == first_verse]
    last_verse_matches = [m for m in matches if m[0] == last_verse]
    
    if not first_verse_matches or not last_verse_matches:
        # Fall back to using all matches
        first_verse_matches = [matches[0]]
        last_verse_matches = [matches[-1]]
    
    start_pos = first_verse_matches[0][1]
    end_pos = last_verse_matches[-1][2]
    
    # Calculate average confidence
    avg_confidence = sum(m[3] for m in matches) / len(matches)
    
    return (start_pos, end_pos, avg_confidence)


def extend_quote_start_backward(text: str, quote_start: int, ref_position: int) -> int:
    """
    Extend quote start backward to capture paraphrased introductory text.
    
    When speakers read Bible passages, they sometimes paraphrase the beginning
    (e.g., "And he called the wise men" instead of "Then Herod, when he had privily called").
    This function looks for common patterns that suggest where the reading actually started.
    
    Args:
        text: Full transcript text
        quote_start: Detected start position of the verbatim quote
        ref_position: Position of the Bible reference in the transcript
    
    Returns:
        Adjusted start position (may be earlier than quote_start)
    """
    # Don't look before the reference position
    search_start = ref_position
    
    # Get the text between reference and quote start
    bridge_text = text[search_start:quote_start]
    
    # Common patterns that indicate reading/quoting has started:
    # - Sentence starts after common phrases like "verse 1."
    # - Sentence-initial "And", "But", "Then", "Now", "For", "Behold"
    
    # Look for the last sentence start that could be the quote beginning
    # Common verse-initial words in Bible
    verse_starters = [
        r'\.\s+(And\s+(?:he|she|they|it|when|lo|behold))',
        r'\.\s+(But\s+(?:he|she|they|it|when))',
        r'\.\s+(Then\s+(?:he|she|they|Herod|Jesus))',
        r'\.\s+(Now\s+(?:when|there|it|this))',
        r'\.\s+(For\s+(?:he|she|they|unto|thus|the|God))',
        r'\.\s+(Behold)',
        r'\.\s+(When\s+(?:he|she|they|Jesus))',
        r'\.\s+(Wherefore)',
        r'\.\s+(Unto\s+(?:us|them|him|her|you))',
        r'verse\s+\d+\.\s+(\w)',  # After "verse 1." etc.
    ]
    
    best_extension_pos = quote_start
    
    for pattern in verse_starters:
        for match in re.finditer(pattern, bridge_text, re.IGNORECASE):
            # Calculate absolute position
            match_start = search_start + match.start(1) if match.lastindex else search_start + match.start()
            
            # Only extend if this position is closer to ref_position but still before quote_start
            if match_start < best_extension_pos and match_start >= search_start:
                # Make sure there's actual content and it's not too far
                if quote_start - match_start < 200:  # Max 200 chars of paraphrase
                    best_extension_pos = match_start
    
    return best_extension_pos


# ============================================================================
# INTERJECTION AND COMMENTARY DETECTION
# ============================================================================


def compute_sequential_alignment(
    chunk_words: List[str],
    verse_words: List[str],
    max_verse_skip: int = 3,
) -> Tuple[float, List[int], List[Tuple[int, int]]]:
    """
    Compute how well chunk_words align sequentially against verse_words.

    Uses Longest Common Subsequence (LCS) to find the longest ordered subsequence
    of chunk_words that appears (in the same order) in verse_words. This correctly
    handles small word-order transpositions in transcription (e.g., "I yet" vs
    "yet I") without losing alignment, while still giving low scores for true
    paraphrases where words appear in a fundamentally different order.

    Args:
        chunk_words: Normalized words from the transcript chunk
        verse_words: Normalized words from the Bible verse text
        max_verse_skip: (unused, kept for API compat) — LCS handles skips inherently

    Returns:
        Tuple of:
        - alignment_ratio: fraction of chunk words that aligned sequentially (0.0-1.0)
        - aligned_indices: list of chunk word indices that were part of the LCS
        - gap_regions: list of (start_idx, end_idx) in chunk_words that were NOT aligned
    """
    if not chunk_words or not verse_words:
        return (0.0, [], [])

    n = len(chunk_words)
    m = len(verse_words)

    # Build LCS table using fuzzy word matching
    # dp[i][j] = length of LCS of chunk_words[:i] and verse_words[:j]
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if _words_match_fuzzy(chunk_words[i - 1], verse_words[j - 1]):
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    lcs_length = dp[n][m]
    alignment_ratio = lcs_length / n if n > 0 else 0.0

    # Backtrack to find which chunk indices were aligned
    aligned: List[int] = []
    i, j = n, m
    while i > 0 and j > 0:
        if _words_match_fuzzy(chunk_words[i - 1], verse_words[j - 1]):
            aligned.append(i - 1)
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    aligned.reverse()

    # Extract gap regions — contiguous spans of chunk indices NOT in aligned
    gap_regions: List[Tuple[int, int]] = []
    aligned_set = set(aligned)
    gap_start: Optional[int] = None

    for i in range(n):
        if i not in aligned_set:
            if gap_start is None:
                gap_start = i
        else:
            if gap_start is not None:
                gap_regions.append((gap_start, i))
                gap_start = None

    if gap_start is not None:
        gap_regions.append((gap_start, n))

    return (alignment_ratio, aligned, gap_regions)


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
    if not remaining_raw_text or not verse_words:
        return None

    # Tokenize remaining text into words with positions
    word_pattern = re.compile(r'\b\w+\b')
    word_matches = list(word_pattern.finditer(remaining_raw_text))

    if not word_matches:
        return None

    remaining_words = [normalize_for_comparison(m.group()) for m in word_matches]

    # For each starting position in remaining_words, try to find a consecutive run
    # of min_run_length words that match verse_words in order
    for i in range(len(remaining_words)):
        # Find where this word appears in verse_words
        for v_start in range(len(verse_words)):
            if _words_match_fuzzy(remaining_words[i], verse_words[v_start]):
                # Check if the next min_run_length - 1 words also match consecutively
                run_length = 1
                v_idx = v_start + 1
                r_idx = i + 1

                while (run_length < min_run_length and
                       r_idx < len(remaining_words) and
                       v_idx < len(verse_words)):
                    if _words_match_fuzzy(remaining_words[r_idx], verse_words[v_idx]):
                        run_length += 1
                        v_idx += 1
                        r_idx += 1
                    elif v_idx + 1 < len(verse_words) and _words_match_fuzzy(remaining_words[r_idx], verse_words[v_idx + 1]):
                        # Allow skipping one verse word (speaker may skip a word)
                        run_length += 1
                        v_idx += 2
                        r_idx += 1
                    else:
                        break

                if run_length >= min_run_length:
                    # Found a consecutive run — return the raw text position
                    return offset + word_matches[i].start()

    return None

def detect_commentary_blocks(text: str, start_pos: int, end_pos: int, verse_text: str) -> List[Tuple[int, int]]:
    """
    Detect commentary blocks within a quote boundary.
    
    Commentary blocks are longer sections where the speaker explains or comments
    on the verse rather than reading it. These should be excluded from quoting.
    
    Uses sequential word alignment (order-aware) as the primary detection signal,
    with word-set overlap as a secondary confirmation for borderline cases.
    This correctly identifies paraphrases that reuse verse vocabulary in different order.
    
    Args:
        text: Full transcript text
        start_pos: Start of quote
        end_pos: End of quote
        verse_text: The verse text being quoted
    
    Returns:
        List of (start, end) positions of commentary blocks
    """
    quote_text = text[start_pos:end_pos]
    commentary_blocks = []
    
    # Look for sentence boundaries within the quote
    # Commentary typically starts after a sentence end and doesn't match verse text
    sentence_pattern = re.compile(r'([.!?])\s+([A-Z])')
    
    verse_words_list = get_words(verse_text)   # Ordered list for sequential matching
    verse_words_set = set(verse_words_list)     # Set for fast lookups
    
    # Find potential sentence boundaries
    boundaries = []
    for match in sentence_pattern.finditer(quote_text):
        boundaries.append(match.start() + 1)  # Position after the punctuation
    
    if not boundaries:
        return []
    
    # Commentary detection patterns (allow multi-word subjects before "is")
    COMMENTARY_PATTERNS = [
        r'^\s*[A-Za-z]+(?:\s+[A-Za-z]+)*\s+is\s+denoting\b',  # "X is denoting"
        r'^\s*[A-Za-z]+(?:\s+[A-Za-z]+)*\s+is\s+just\s+another\b',  # "X is just another"
        r'^\s*[A-Za-z]+(?:\s+[A-Za-z]+)*\s+means\b',          # "X means"
        r'^\s*[Tt]hat\s+is\b',                                 # "That is"
        r'^\s*[Tt]his\s+means\b',                              # "This means"
        r'^\s*[Ii]n\s+other\s+words\b',                        # "In other words"
        r'^\s*[Ww]hich\s+means\b',                             # "Which means"
        # Speaker attribution and commentary lead-ins
        r'^\s*(?:[Ss]o\s+)?(?:Paul|he|she|the\s+apostle|the\s+author)\s+(?:says|writes|said|wrote)\b',
        r'^\s*(?:Is|Are|Was|Were|Do|Does|Did|Can|Could|Should)\s+(?:there|we|you|they|it)\b.*\?',
        r"^\s*(?:So|Now|See|Look|Notice)\s*,?\s+(?:he|she|Paul|we|I|you)\b",
        r"^\s*I(?:'m| am)\s+(?:not\s+)?(?:here|just|simply)\b",
    ]
    
    # Track position to skip over already-detected commentary blocks
    skip_until = 0
    
    # For each boundary, check if the following text is verse content or commentary
    for boundary_pos in boundaries:
        abs_pos = start_pos + boundary_pos
        if abs_pos < skip_until:
            continue  # Inside a previously detected commentary block
        
        # Get the next ~150 chars after this boundary
        chunk_end = min(boundary_pos + 150, len(quote_text))
        chunk = quote_text[boundary_pos:chunk_end]
        
        # Skip if this is just whitespace or too short
        chunk_stripped = chunk.strip()
        if len(chunk_stripped) < 20:
            continue
        
        # Check for commentary patterns (explicit regex patterns first)
        is_commentary = False
        
        for pattern in COMMENTARY_PATTERNS:
            if re.search(pattern, chunk):
                is_commentary = True
                break
        
        if not is_commentary:
            # Sequential alignment check (order-aware, fixes Bugs 2 & 3)
            chunk_words = get_words(chunk[:150])
            if len(chunk_words) >= 5:
                alignment_ratio, aligned_indices, gap_regions = compute_sequential_alignment(
                    chunk_words, verse_words_list
                )
                
                # Primary check: low sequential alignment → commentary
                if alignment_ratio < 0.35:
                    is_commentary = True
                elif alignment_ratio < 0.55:
                    # Borderline: check if words match in set but NOT in sequence
                    # (paraphrase detection — same words, different order)
                    set_matching = sum(1 for w in chunk_words if w in verse_words_set)
                    set_ratio = set_matching / len(chunk_words)
                    
                    # High set overlap but low sequential alignment = paraphrase
                    if set_ratio > 0.4 and alignment_ratio < 0.45:
                        is_commentary = True
                
                # Guard: If flagged as commentary but the chunk STARTS with
                # verse-aligned words, it means the verse resumes after a
                # sentence break (e.g., after an interjection like "who?").
                # Cancel the commentary flag — the actual commentary will be
                # caught at the next sentence boundary within this chunk.
                if is_commentary and aligned_indices:
                    aligned_set = set(aligned_indices)
                    leading_aligned = 0
                    for idx in range(min(5, len(chunk_words))):
                        if idx in aligned_set:
                            leading_aligned += 1
                        else:
                            break
                    
                    # Require 3+ consecutive leading words aligned AND at least
                    # one content word (length >= 4) to avoid false positives
                    # from common function words like "and to the".
                    if leading_aligned >= 3:
                        has_content_word = any(
                            len(chunk_words[idx]) >= 4
                            for idx in range(leading_aligned)
                        )
                        if has_content_word:
                            is_commentary = False
        
        if is_commentary:
            # Find where this commentary block ends
            commentary_start = start_pos + boundary_pos
            
            # Word-level verse resumption detection (fixes Bug 1)
            # Use min_run_length=5 to avoid false positives where commentary
            # paraphrases reuse short sequences of verse words
            remaining_text = quote_text[boundary_pos:]
            commentary_end = end_pos  # Default to end of quote
            
            resumption_pos = find_verse_resumption_point(
                remaining_text,
                verse_words_list,
                offset=start_pos + boundary_pos,
                min_run_length=5
            )
            
            if resumption_pos is not None and resumption_pos > commentary_start + 50:
                commentary_end = resumption_pos
            
            # Validate commentary block isn't too short
            if commentary_end - commentary_start > 30:
                commentary_blocks.append((commentary_start, commentary_end))
                skip_until = commentary_end  # Skip boundaries inside this block
    
    # Merge overlapping blocks
    if not commentary_blocks:
        return []
    
    commentary_blocks.sort()
    merged = [commentary_blocks[0]]
    for start, end in commentary_blocks[1:]:
        if start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    
    return merged


def detect_interjections(text: str, start_pos: int, end_pos: int) -> List[Tuple[int, int]]:
    """
    Detect interjections within a quote boundary.
    
    Args:
        text: Full transcript text
        start_pos: Start of quote
        end_pos: End of quote
    
    Returns:
        List of (start, end) positions of interjections
    """
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


def trim_trailing_exclusions(
    text: str,
    start: int,
    end: int,
    all_exclusions: List[Tuple[int, int]],
    min_trailing_len: int = 25,
    proximity: int = 10,
    verbose: bool = False
) -> Tuple[int, List[Tuple[int, int]]]:
    """
    Trim trailing commentary/exclusion from a passage boundary.

    If the last exclusion extends to (or near) end_pos, it means the passage
    boundary was set too far — the exclusion IS the non-verse tail. Trim
    end_pos to the start of the trailing exclusion so the non-verse text
    becomes part of the next paragraph instead of an interjection node.

    Short trailing exclusions (< min_trailing_len chars) are kept as interjections
    since they may be legitimate end-of-verse interjections like "amen?".

    Args:
        text: Full transcript text
        start: Passage start position (absolute)
        end: Passage end position (absolute, will be adjusted)
        all_exclusions: List of (start, end) exclusion positions
        min_trailing_len: Minimum length for trailing exclusion to trigger trim
        proximity: How close to end_pos the exclusion must extend to be considered trailing
        verbose: Enable debug logging

    Returns:
        Tuple of (new_end, filtered_exclusions)
    """
    if not all_exclusions:
        return end, all_exclusions

    last_start, last_end = all_exclusions[-1]
    trailing_len = last_end - last_start

    # Only trim if the exclusion reaches close to the passage end and is long enough
    # to be commentary (not a short interjection like "amen?")
    if last_end >= end - proximity and trailing_len >= min_trailing_len:
        new_end = last_start
        # Trim trailing whitespace from the new end position
        while new_end > start and text[new_end - 1] in ' \t\n':
            new_end -= 1

        if new_end > start:
            if verbose:
                trimmed_text = text[new_end:end][:50].replace('\n', ' ')
                print(f"      ✂ Trimmed trailing commentary ({trailing_len} chars): '{trimmed_text}...'")
            return new_end, all_exclusions[:-1]

    return end, all_exclusions


# ============================================================================
# PHASE 4: BOUNDARY VERIFICATION
# ============================================================================

def verify_quote_boundaries(quote: QuoteBoundary, transcript: str, verbose: bool = False) -> QuoteBoundary:
    """
    Verify and potentially adjust quote boundaries against the verse text.
    
    PHASE 4: This function provides a post-processing step to verify that detected
    boundaries accurately capture the Bible verse content by comparing against the
    verse text from the API.
    
    The function:
    1. Validates start boundary matches verse start
    2. Validates end boundary includes complete verse
    3. Tracks any adjustments made for debugging/logging
    4. Updates confidence score based on boundary quality
    
    Args:
        quote: QuoteBoundary object with initial boundaries
        transcript: Full transcript text
        verbose: Whether to print verification details
    
    Returns:
        Updated QuoteBoundary with verified positions and adjustment metadata
    """
    # Store original positions
    original_start = quote.start_pos
    original_end = quote.end_pos
    
    verse_text = quote.verse_text
    if not verse_text or len(get_words(verse_text)) < 3:
        # Can't verify without verse text
        quote.boundary_verified = False
        return quote
    
    ref_str = quote.reference.to_standard_format()
    
    # =========================================================================
    # VERIFY START BOUNDARY
    # =========================================================================
    verified_start = validate_start_is_verse_text(
        transcript, original_start, verse_text, 
        max_search_forward=100, debug=verbose
    )
    
    # =========================================================================
    # VERIFY END BOUNDARY
    # =========================================================================
    # First try to find actual verse end
    verse_end_pos = find_verse_end_in_transcript(
        transcript, verified_start, verse_text, 
        max_search=1500, debug=verbose
    )
    
    verified_end = original_end
    if verse_end_pos and verse_end_pos > verified_start:
        # Validate the extension contains verse words
        verse_words_set = set(get_words(verse_text))
        extension_text = transcript[original_end:verse_end_pos]
        extension_words = get_words(extension_text)
        
        if extension_words:
            extension_matches = sum(1 for w in extension_words if w in verse_words_set)
            extension_ratio = extension_matches / len(extension_words)
            
            if extension_ratio >= 0.5:
                verified_end = verse_end_pos
    
    # =========================================================================
    # UPDATE QUOTE WITH VERIFIED BOUNDARIES
    # =========================================================================
    start_adjustment = verified_start - original_start
    end_adjustment = verified_end - original_end
    
    quote.original_start_pos = original_start
    quote.original_end_pos = original_end
    quote.start_pos = verified_start
    quote.end_pos = verified_end
    quote.start_adjustment = start_adjustment
    quote.end_adjustment = end_adjustment
    quote.boundary_verified = True
    
    # Adjust confidence based on boundary changes
    # Large adjustments indicate initial detection was less accurate
    total_adjustment = abs(start_adjustment) + abs(end_adjustment)
    if total_adjustment > 50:
        quote.confidence = max(0.5, quote.confidence - 0.10)
    elif total_adjustment > 20:
        quote.confidence = max(0.6, quote.confidence - 0.05)
    elif end_adjustment > 0:
        # Extended to include more verse text - slight confidence boost
        quote.confidence = min(1.0, quote.confidence + 0.02)
    
    if verbose and (start_adjustment != 0 or end_adjustment != 0):
        print(f"      🔍 Boundary verification for {ref_str}:")
        if start_adjustment != 0:
            print(f"         Start: {original_start} → {verified_start} (adjustment: {start_adjustment:+d})")
        if end_adjustment != 0:
            print(f"         End: {original_end} → {verified_end} (adjustment: {end_adjustment:+d})")
        print(f"         Final confidence: {quote.confidence:.2f}")
    
    return quote


# ============================================================================
# MAIN PROCESSING PIPELINE
# ============================================================================

def process_transcript(input_file: str, output_file: Optional[str] = None, translation: Optional[str] = None, 
                       auto_detect: bool = True) -> str:
    """
    Main processing pipeline for sermon transcripts (file-based wrapper).
    
    This is a convenience wrapper around process_text() that handles file I/O.
    
    Args:
        input_file: Path to raw transcript file
        output_file: Path to save processed transcript (optional)
        translation: Bible translation to use. If None and auto_detect=True, 
                    translation will be auto-detected PER QUOTE.
                    Supported: KJV, NKJV, NIV, ESV, NLT, NASB, RSV, MSG, AMP, etc.
        auto_detect: If True and translation is None, automatically detect translation per-quote
    
    Returns:
        Processed transcript text
    """
    print("=" * 60)
    print("Bible Quote Processor for Sermon Transcripts")
    print("=" * 60)
    
    # Read input file
    print(f"\n📖 Reading transcript from: {input_file}")
    with open(input_file, 'r', encoding='utf-8') as f:
        text = f.read()
    print(f"   Original length: {len(text)} characters")
    
    # Process text (handles all the heavy lifting including per-quote translation detection)
    processed_text, quotes = process_text(text, translation=translation, verbose=True, auto_detect=auto_detect)
    
    # Save output
    if output_file:
        print(f"\n💾 Saving processed transcript to: {output_file}")
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(processed_text)
    
    return processed_text
    
    return text


def process_text(text: str, translation: Optional[str] = None, verbose: bool = True, 
                 auto_detect: bool = True, progress_callback: Optional[Callable[[int, str], None]] = None) -> Tuple[str, List[QuoteBoundary]]:
    """
    Process raw transcript text directly (for integration with main.py pipeline).
    
    COORDINATE CONTRACT:
    All QuoteBoundary.start_pos/end_pos values MUST reference positions in the
    unmodified input text. No text mutation is permitted during boundary detection.
    Reference normalization (e.g., "Romans 12 one" → "Romans 12:1") is NOT applied
    to the source text — it is available via reference.to_standard_format() for
    display purposes and stored as metadata on AST PassageNode nodes.
    
    This contract ensures that downstream consumers (ast_builder, paragraph
    segmentation, tag extraction) can safely use quote boundary positions to
    slice the original text without coordinate-space mismatches.
    
    Args:
        text: Raw transcript text (NEVER modified by this function)
        translation: Bible translation to use. If None and auto_detect=True, 
                    translation will be auto-detected PER QUOTE (allowing for
                    speakers who switch translations mid-sermon).
                    Supported: KJV, NKJV, NIV, ESV, NLT, NASB, RSV, MSG, AMP, etc.
        verbose: Whether to print progress messages
        auto_detect: If True and translation is None, automatically detect the translation
                    for EACH quote based on word overlap with the transcript
        progress_callback: Optional callback function(percent: int, message: str) for progress updates
    
    Returns:
        Tuple of (original_text, list_of_quote_boundaries)
        The returned text is IDENTICAL to the input text (no mutation).
        The quote boundaries can be used by downstream processors (like paragraph
        segmentation) to ensure quotes are not split across paragraphs.
    """
    # Save original text for immutability assertion at the end
    _original_input_text = text
    
    def report_progress(percent: int, message: str):
        """Helper to report progress via callback."""
        if progress_callback:
            progress_callback(percent, message)
    
    report_progress(0, "Initializing Bible processor...")
    
    if verbose:
        print("=" * 60)
        print("Bible Quote Processor")
        print("=" * 60)
        print(f"   Original length: {len(text)} characters")
    
    # Initialize API client with default translation (may be overridden per-quote)
    initial_translation = translation if translation else DEFAULT_TRANSLATION
    api_client = BibleAPIClient(translation=initial_translation)
    
    # Determine if we're doing per-quote detection
    per_quote_detection = (not translation and auto_detect)
    
    if verbose:
        if per_quote_detection:
            print("   📖 Translation: AUTO-DETECT (per-quote)")
        else:
            print(f"   📖 Using translation: {translation if translation else DEFAULT_TRANSLATION}")
    
    # Phase 1: Detect and normalize Bible references (with transcript validation)
    report_progress(5, "Detecting Bible references...")
    if verbose:
        print("\n🔍 Phase 1: Detecting Bible references...")
    references = detect_bible_references(text, api_client, text)
    if verbose:
        print(f"   Found {len(references)} Bible references:")
        for ref in references:
            print(f"      • {ref.original_text} → {ref.to_standard_format()}")
    
    # Phase 2: SKIPPED — Reference normalization removed from this pipeline stage.
    # 
    # COORDINATE CONTRACT: All QuoteBoundary.start_pos/end_pos values MUST
    # reference positions in the unmodified input text. No text mutation is
    # permitted during boundary detection. Reference normalization (e.g.,
    # "Romans 12 one" → "Romans 12:1") is stored as metadata on the AST
    # PassageNode.quoteDetection for renderer display, NOT applied to the
    # source text. This eliminates the entire class of coordinate-space
    # mismatch bugs where mutated-text positions are used to slice original text.
    #
    # The normalized reference is available via reference.to_standard_format()
    # for display purposes.
    #
    # NOTE: AST-level reference normalization now happens in Stage 2b of the
    # AST pipeline (normalize_ast_references in ast_builder.py). It operates
    # on TextNode.content strings AFTER passages are applied to the AST,
    # so it never affects coordinate-space consistency.
    report_progress(15, "Reference formats ready (no text mutation)...")
    if verbose:
        print("\n✏️  Phase 2: SKIPPED (no text mutation — references kept in original form)")
        print("   Normalized forms available via reference.to_standard_format():")
        for ref in references:
            if ref.original_text != ref.to_standard_format():
                print(f"      • '{ref.original_text}' → display as '{ref.to_standard_format()}'")
    
    # Phase 3: Fetch Bible verse texts and detect translation PER QUOTE
    # This handles speakers who switch translations mid-sermon
    report_progress(20, "Fetching Bible verses from API...")
    if verbose:
        if per_quote_detection:
            print("\n🌐 Phase 3: Fetching verses & detecting translation per-quote...")
        else:
            print("\n🌐 Phase 3: Fetching Bible verse texts from API...")
    
    verse_texts = {}
    verse_translations = {}  # Track which translation was used for each verse
    individual_verses_cache = {}
    
    total_refs = len(references)
    for ref_idx, ref in enumerate(references):
        # Report granular progress during Phase 3 (API fetches take time)
        # Phase 3 spans from 20% to 60%, so distribute progress across references
        if total_refs > 0:
            phase3_progress = 20 + int((ref_idx / total_refs) * 40)
            report_progress(phase3_progress, f"Fetching verse {ref_idx + 1} of {total_refs}...")
        
        if ref.verse_start:
            api_ref = ref.to_api_format()
            # Use position-based key to handle multiple references to the same verse
            # This prevents dictionary overwrites when a verse is mentioned multiple times
            cache_key = f"{api_ref}@{ref.position}"
            
            if per_quote_detection:
                # Detect best translation for THIS specific quote
                if verbose:
                    print(f"   {api_ref}: Detecting translation...", end=" ")
                
                detected_trans, verse_text, score = detect_translation_for_quote(
                    ref, text, api_client, verbose=False
                )
                
                if verse_text:
                    verse_texts[cache_key] = verse_text
                    verse_translations[cache_key] = detected_trans
                    if verbose:
                        print(f"✓ {detected_trans} ({len(verse_text)} chars, score: {score:.2f})")
                    
                    # Handle verse ranges - need to fetch individual verses in the detected translation
                    if ref.verse_end and ref.verse_end > ref.verse_start:
                        if verbose:
                            print(f"      ↳ Fetching individual verses for range detection...")
                        # Temporarily switch to detected translation for range fetch
                        original_trans = api_client.translation
                        api_client.translation = detected_trans
                        individual = fetch_verse_range_individual(
                            api_client, ref.book, ref.chapter, 
                            ref.verse_start, ref.verse_end
                        )
                        api_client.translation = original_trans
                        if individual:
                            individual_verses_cache[cache_key] = individual
                            if verbose:
                                print(f"         Fetched {len(individual)} individual verses")
                else:
                    if verbose:
                        print("✗ Not found")
            else:
                # Use fixed translation (original behavior)
                if verbose:
                    print(f"   Fetching: {api_ref}...", end=" ")
                result = api_client.get_verse(api_ref)
                if result and 'text' in result:
                    verse_texts[cache_key] = result['text']
                    verse_translations[cache_key] = api_client.translation
                    if verbose:
                        print(f"✓ ({len(result['text'])} chars)")
                    
                    if ref.verse_end and ref.verse_end > ref.verse_start:
                        if verbose:
                            print(f"      ↳ Fetching individual verses for range detection...")
                        individual = fetch_verse_range_individual(
                            api_client, ref.book, ref.chapter, 
                            ref.verse_start, ref.verse_end
                        )
                        if individual:
                            individual_verses_cache[cache_key] = individual
                            if verbose:
                                print(f"         Fetched {len(individual)} individual verses")
                else:
                    if verbose:
                        print("✗ Not found")
    
    # Phase 4: Find quote boundaries
    report_progress(65, "Finding quote boundaries...")
    if verbose:
        print("\n🎯 Phase 4: Finding quote boundaries in transcript...")
    quotes = []
    
    for ref_idx, ref in enumerate(references):
        # Report granular progress during Phase 4 (60% to 85%)
        if total_refs > 0:
            phase4_progress = 65 + int((ref_idx / total_refs) * 20)
            report_progress(phase4_progress, f"Analyzing quote {ref_idx + 1} of {total_refs}...")
        
        if ref.verse_start:
            api_ref = ref.to_api_format()
            # Use the same position-based key as Phase 3
            cache_key = f"{api_ref}@{ref.position}"
            if cache_key in verse_texts:
                verse_text = verse_texts[cache_key]
                detected_translation = verse_translations.get(cache_key, api_client.translation)
                
                # Use the actual length of the matched reference text in the transcript,
                # not the normalized format. This is critical because spoken numbers like
                # "Romans 12 one" (13 chars) differ from "Romans 12:1" (11 chars).
                ref_length = len(ref.original_text) if ref.original_text else len(ref.to_standard_format())
                
                # Skip past the reference text to avoid matching verse numbers as part of quote
                result = find_quote_boundaries_improved(verse_text, text, ref.position, ref_length)
                
                # For single-verse references (no verse_end), check if the speaker continues reading
                # subsequent verses beyond the announced verse. If so, extend the quote boundaries.
                is_single_verse = ref.verse_end is None or ref.verse_end == ref.verse_start
                
                if is_single_verse and result is not None and cache_key not in individual_verses_cache:
                    # Fetch a few verses after the announced verse to check for continuation
                    start_verse = ref.verse_start
                    # Fetch up to 10 subsequent verses to check for multi-verse reading
                    original_trans = api_client.translation
                    api_client.translation = detected_translation
                    subsequent_verses = fetch_verse_range_individual(
                        api_client, ref.book, ref.chapter, 
                        start_verse, start_verse + 10
                    )
                    api_client.translation = original_trans
                    
                    if subsequent_verses and len(subsequent_verses) > 1:
                        # Check if subsequent verses appear in the transcript after the initial quote
                        _, _, initial_end, initial_conf = result[0], result[1], result[1], result[2]
                        
                        # Search for subsequent verses starting from where we found the first verse
                        # Pass first_verse_num to require higher confidence for verses beyond the referenced one
                        first_match, last_match, subset_matches = detect_matching_verse_subset(
                            subsequent_verses, text, ref.position,
                            first_verse_num=start_verse  # Require 80%+ confidence for extensions
                        )
                        
                        if subset_matches and last_match and last_match > start_verse:
                            # Speaker read additional verses!
                            if verbose:
                                print(f"   {api_ref}: Single verse reference but speaker read verses {first_match}-{last_match}")
                            
                            # Use the extended verse range
                            individual_verses_cache[cache_key] = subsequent_verses
                            subset_result = find_quote_boundaries_with_subset(
                                subsequent_verses, subset_matches, first_match, last_match
                            )
                            if subset_result and subset_result[1] > result[1]:  # Extended result is longer
                                result = subset_result
                                verse_text = build_composite_verse_text(
                                    subsequent_verses, first_match, last_match
                                )
                                # Update reference to reflect actual verses read
                                ref.verse_end = last_match if last_match != start_verse else None
                
                if cache_key in individual_verses_cache:
                    individual_verses = individual_verses_cache[cache_key]
                    first_match_verse, last_match_verse, subset_matches = detect_matching_verse_subset(
                        individual_verses, text, ref.position
                    )
                    
                    if subset_matches:
                        subset_confidence = sum(m[3] for m in subset_matches) / len(subset_matches)
                        use_subset = False
                        
                        if result is None:
                            use_subset = True
                            if verbose:
                                print(f"   {api_ref}: Standard matching failed, trying subset detection...")
                        elif (result[2] < 0.7 and first_match_verse != ref.verse_start):
                            use_subset = True
                            if verbose:
                                print(f"   {api_ref}: Low confidence ({result[2]:.2f}), actual range: {first_match_verse}-{last_match_verse}")
                        elif first_match_verse and (first_match_verse != ref.verse_start or last_match_verse != ref.verse_end):
                            subset_result = find_quote_boundaries_with_subset(
                                individual_verses, subset_matches, first_match_verse, last_match_verse
                            )
                            if subset_result:
                                expected_verse_count = (ref.verse_end - ref.verse_start + 1) if ref.verse_end else 1
                                actual_verse_count = len(subset_matches)
                                
                                if actual_verse_count < expected_verse_count:
                                    # Only use subset if it covers as much or more text than the improved result
                                    # This prevents shorter false-positive subsets from overriding good results
                                    if result is None or subset_result[1] >= result[1]:
                                        use_subset = True
                                        if verbose:
                                            print(f"   {api_ref}: Partial reading: verses {first_match_verse}-{last_match_verse}")
                                elif subset_result[2] > (result[2] if result else 0):
                                    use_subset = True
                        
                        if use_subset:
                            subset_result = find_quote_boundaries_with_subset(
                                individual_verses, subset_matches, first_match_verse, last_match_verse
                            )
                            if subset_result:
                                result = subset_result
                                verse_text = build_composite_verse_text(
                                    individual_verses, first_match_verse, last_match_verse
                                )
                
                if result:
                    start, end, confidence = result
                    extended_start = extend_quote_start_backward(text, start, ref.position)
                    if extended_start < start:
                        if verbose:
                            print(f"   {api_ref}: Extended start backward {start - extended_start} chars")
                        start = extended_start
                    
                    if verbose:
                        trans_info = f" [{detected_translation}]" if per_quote_detection else ""
                        print(f"   {api_ref}{trans_info}: Found at positions {start}-{end} (confidence: {confidence:.2f})")
                    
                    # Detect interjections (short like "a what?")
                    interjections = detect_interjections(text, start, end)
                    
                    # Detect commentary blocks (longer explanatory sections)
                    commentary_blocks = detect_commentary_blocks(text, start, end, verse_text)
                    
                    # Merge interjections and commentary blocks
                    all_exclusions = interjections + commentary_blocks
                    all_exclusions.sort()
                    
                    # Merge overlapping exclusions
                    if all_exclusions:
                        merged_exclusions = [all_exclusions[0]]
                        for excl_start, excl_end in all_exclusions[1:]:
                            if excl_start <= merged_exclusions[-1][1] + 5:  # Allow small gap
                                merged_exclusions[-1] = (merged_exclusions[-1][0], max(merged_exclusions[-1][1], excl_end))
                            else:
                                merged_exclusions.append((excl_start, excl_end))
                        all_exclusions = merged_exclusions
                    
                    # Trim trailing commentary from passage boundary
                    # If the last exclusion extends to end, it's non-verse tail text
                    # that should be in the next paragraph, not an interjection
                    end, all_exclusions = trim_trailing_exclusions(
                        text, start, end, all_exclusions, verbose=verbose
                    )
                    
                    if all_exclusions and verbose:
                        num_inter = len([e for e in all_exclusions if e[1] - e[0] < 30])
                        num_comm = len([e for e in all_exclusions if e[1] - e[0] >= 30])
                        parts = []
                        if num_inter:
                            parts.append(f"{num_inter} interjection(s)")
                        if num_comm:
                            parts.append(f"{num_comm} commentary block(s)")
                        print(f"      ⚠ Found {', '.join(parts)}")
                    
                    quote = QuoteBoundary(
                        start_pos=start,
                        end_pos=end,
                        reference=ref,
                        verse_text=verse_text,
                        confidence=confidence,
                        translation=detected_translation,
                        has_interjection=bool(all_exclusions),
                        interjection_positions=all_exclusions
                    )
                    
                    # PHASE 4: Verify and potentially adjust boundaries
                    quote = verify_quote_boundaries(quote, text, verbose=verbose)
                    
                    quotes.append(quote)
                else:
                    if verbose:
                        print(f"   {api_ref}: ✗ Could not locate in transcript")
        else:
            # Chapter-only reference (e.g., "Galatians 4")
            # Try to detect which verses from the chapter are being read
            chapter_ref = f"{ref.book} {ref.chapter}"
            cache_key = f"{chapter_ref}@{ref.position}"
            
            if verbose:
                print(f"   {chapter_ref}: Chapter-only reference, detecting quoted verses...")
            
            # Fetch individual verses from the chapter (first 20 verses should cover most quotes)
            individual_verses = {}
            for v in range(1, 21):  # Check verses 1-20
                verse_result = api_client.get_verse(f"{ref.book} {ref.chapter}:{v}")
                if verse_result and 'text' in verse_result:
                    individual_verses[v] = verse_result['text']
                else:
                    break  # Stop if we hit a verse that doesn't exist
            
            if individual_verses:
                first_match_verse, last_match_verse, subset_matches = detect_matching_verse_subset(
                    individual_verses, text, ref.position
                )
                
                if subset_matches and first_match_verse and last_match_verse:
                    subset_result = find_quote_boundaries_with_subset(
                        individual_verses, subset_matches, first_match_verse, last_match_verse
                    )
                    
                    if subset_result:
                        start, end, confidence = subset_result
                        verse_text = build_composite_verse_text(
                            individual_verses, first_match_verse, last_match_verse
                        )
                        
                        # Update the reference with the actual verses found
                        ref.verse_start = first_match_verse
                        ref.verse_end = last_match_verse if last_match_verse != first_match_verse else None
                        
                        extended_start = extend_quote_start_backward(text, start, ref.position)
                        if extended_start < start:
                            if verbose:
                                print(f"   {chapter_ref}: Extended start backward {start - extended_start} chars")
                            start = extended_start
                        
                        if verbose:
                            detected_range = f"{first_match_verse}-{last_match_verse}" if last_match_verse != first_match_verse else str(first_match_verse)
                            print(f"   {chapter_ref}: Detected verses {detected_range}, found at {start}-{end} (conf: {confidence:.2f})")
                        
                        # Detect interjections and commentary
                        interjections = detect_interjections(text, start, end)
                        commentary_blocks = detect_commentary_blocks(text, start, end, verse_text)
                        all_exclusions = interjections + commentary_blocks
                        all_exclusions.sort()
                        
                        if all_exclusions:
                            merged_exclusions = [all_exclusions[0]]
                            for excl_start, excl_end in all_exclusions[1:]:
                                if excl_start <= merged_exclusions[-1][1] + 5:
                                    merged_exclusions[-1] = (merged_exclusions[-1][0], max(merged_exclusions[-1][1], excl_end))
                                else:
                                    merged_exclusions.append((excl_start, excl_end))
                            all_exclusions = merged_exclusions
                        
                        # Trim trailing commentary from passage boundary
                        end, all_exclusions = trim_trailing_exclusions(
                            text, start, end, all_exclusions, verbose=verbose
                        )
                        
                        quote = QuoteBoundary(
                            start_pos=start,
                            end_pos=end,
                            reference=ref,
                            verse_text=verse_text,
                            confidence=confidence,
                            translation=api_client.translation,
                            has_interjection=bool(all_exclusions),
                            interjection_positions=all_exclusions
                        )
                        
                        # PHASE 4: Verify and potentially adjust boundaries
                        quote = verify_quote_boundaries(quote, text, verbose=verbose)
                        
                        quotes.append(quote)
                    else:
                        if verbose:
                            print(f"   {chapter_ref}: ✗ Could not determine quote boundaries")
                else:
                    if verbose:
                        print(f"   {chapter_ref}: ✗ No matching verses found in transcript")
    
    report_progress(100, "Bible processing complete")
    
    if verbose:
        print("\n" + "=" * 60)
        print("✅ Processing complete!")
        print(f"   • References normalized: {len(references)}")
        print(f"   • Quotes found: {len(quotes)}")
        
        # Show translation breakdown if per-quote detection was used
        if per_quote_detection and quotes:
            from collections import Counter
            trans_counts = Counter(q.translation for q in quotes)
            trans_summary = ', '.join(f"{t}: {c}" for t, c in trans_counts.most_common())
            print(f"   • Translations detected: {trans_summary}")
        
        # PHASE 4: Show boundary verification statistics
        if quotes:
            verified_quotes = [q for q in quotes if q.boundary_verified]
            adjusted_quotes = [q for q in verified_quotes if q.start_adjustment != 0 or q.end_adjustment != 0]
            if verified_quotes:
                print(f"   • Boundaries verified: {len(verified_quotes)}/{len(quotes)}")
            if adjusted_quotes:
                print(f"   • Boundaries adjusted: {len(adjusted_quotes)}")
                # Show details for each adjusted quote
                for q in adjusted_quotes:
                    ref_str = q.reference.to_standard_format()
                    adjustments = []
                    if q.start_adjustment != 0:
                        adjustments.append(f"start {q.start_adjustment:+d}")
                    if q.end_adjustment != 0:
                        adjustments.append(f"end {q.end_adjustment:+d}")
                    print(f"      - {ref_str}: {', '.join(adjustments)}")
        
        print(f"   • Output length: {len(text)} characters")
        print("=" * 60)
    
    # IMMUTABILITY ASSERTION: Verify text was never mutated during processing.
    # This prevents future regressions where someone adds text mutation back
    # into the pipeline, which would break coordinate-space consistency.
    assert text is _original_input_text, (
        "INVARIANT VIOLATION: process_text() mutated the input text! "
        f"Original length={len(_original_input_text)}, current length={len(text)}. "
        "All QuoteBoundary positions reference the original text — mutation is forbidden."
    )
    
    return text, quotes


def get_quote_char_ranges(quotes: List[QuoteBoundary]) -> List[Tuple[int, int]]:
    """
    Get the character position ranges of all quotes.
    
    This is useful for downstream processors that need to know which
    parts of the text are Bible quotes (e.g., to avoid splitting them
    across paragraphs).
    
    Args:
        quotes: List of QuoteBoundary objects
    
    Returns:
        List of (start_pos, end_pos) tuples for each quote
    """
    return [(q.start_pos, q.end_pos) for q in quotes]


# ============================================================================
# AST BUILDER INTEGRATION (NEW DOCUMENT MODEL)
# ============================================================================

def process_text_to_ast(
    text: str,
    translation: Optional[str] = None,
    verbose: bool = True,
    auto_detect: bool = True,
    progress_callback: Optional[Callable[[int, str], None]] = None,
    title: Optional[str] = None,
    bible_passage: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> "ASTBuilderResult":
    """
    Process text and build structured AST document model.
    
    This is the new entry point that produces a rich structured document
    instead of plain text with embedded quote marks.
    
    Args:
        text: Raw transcript text
        translation: Bible translation to use (None for auto-detect)
        verbose: Whether to print progress messages
        auto_detect: If True, auto-detect translation per quote
        progress_callback: Optional progress callback(percent, message)
        title: Document title (from audio metadata)
        bible_passage: Main Bible passage (from audio metadata)
        tags: Extracted keyword tags
    
    Returns:
        ASTBuilderResult containing:
        - document_state: Complete document state with AST, indexes, event log
        - processing_metadata: Timing and statistics
    """
    # Import AST builder (lazy import to avoid circular dependency)
    from ast_builder import build_ast, ASTBuilderResult
    
    # Step 1: Process text using existing pipeline (returns original text + quotes)
    # process_text() guarantees text is unmodified (immutability assertion)
    processed_text, quote_boundaries = process_text(
        text=text,
        translation=translation,
        verbose=verbose,
        auto_detect=auto_detect,
        progress_callback=progress_callback
    )
    
    # Create API client for reference normalization verification (Stage 2b)
    initial_translation = translation if translation else DEFAULT_TRANSLATION
    ast_api_client = BibleAPIClient(translation=initial_translation)
    
    # Step 2: Build AST (AST-first pipeline — no separate sentence/paragraph step)
    if verbose:
        print("\n🏗️  Building document AST...")
    
    result = build_ast(
        raw_text=processed_text,
        quote_boundaries=quote_boundaries,
        title=title,
        bible_passage=bible_passage,
        tags=tags or [],
        api_client=ast_api_client,
    )
    
    if verbose:
        print(f"   ✓ Built AST with {result.processing_metadata.paragraph_count} paragraphs, "
              f"{result.processing_metadata.passage_count} passages, "
              f"{result.processing_metadata.normalization_count} normalizations")
    
    return result


def process_text_to_ast_json(
    text: str,
    translation: Optional[str] = None,
    verbose: bool = True,
    auto_detect: bool = True,
    progress_callback: Optional[Callable[[int, str], None]] = None,
    title: Optional[str] = None,
    bible_passage: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> str:
    """
    Process text and return AST as JSON string.
    
    Convenience wrapper around process_text_to_ast that returns JSON.
    
    Args:
        Same as process_text_to_ast
    
    Returns:
        JSON string of the ASTBuilderResult
    """
    result = process_text_to_ast(
        text=text,
        translation=translation,
        verbose=verbose,
        auto_detect=auto_detect,
        progress_callback=progress_callback,
        title=title,
        bible_passage=bible_passage,
        tags=tags
    )
    return result.to_json()


# ============================================================================
# TESTING / VERIFICATION
# ============================================================================

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        # Default to whisper_raw.txt
        input_file = "whisper_raw.txt"
    else:
        input_file = sys.argv[1]
    
    output_file = input_file.replace('.txt', '_processed.txt')
    if output_file == input_file:
        output_file = input_file + '_processed'
    
    result = process_transcript(input_file, output_file)
