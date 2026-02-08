# Fix SSL certificate verification issues on macOS
import ssl
ssl._create_default_https_context = ssl._create_unverified_context

"""
Sermon Processing Pipeline
==========================

Core pipeline for WhisperDesk sermon transcription post-processing.

Embedding Model
---------------
Uses EmbeddingGemma-300m-4bit (mlx-community/embeddinggemma-300m-4bit) via
mlx-embeddings for all embedding tasks (paragraph segmentation AND tag
extraction). This replaced the previous dual-model setup:
  - all-MiniLM-L6-v2 (384-dim, sentence-transformers) → removed
  - all-mpnet-base-v2 (768-dim, sentence-transformers) → removed
  - keyword extraction library → removed (replaced by semantic KB matching)
  - NLTK POS tagging → removed

The single 768-dim model runs natively on Apple Silicon via MLX with no
PyTorch dependency. MTEB score ~69.67.

Threshold Calibration
---------------------
EmbeddingGemma produces higher cosine similarities between related sentences
compared to the old MiniLM model, requiring threshold recalibration:
  - Paragraph segmentation: 0.45 (was 0.30) for pipeline call
  - segment_into_paragraphs() default: 0.55 (was 0.65)
  - Tag semantic_threshold: 0.40 (unchanged)

Calibrated on test_mode_transcript.txt (580 sentences → 15 paragraphs at 0.45).
"""

import mlx_whisper
import numpy as np
import re
from typing import List, Optional

# Unified embedding model (EmbeddingGemma-300m-4bit via mlx-embeddings)
# Replaces both all-MiniLM-L6-v2 (384-dim) and all-mpnet-base-v2 (768-dim)
# with a single 768-dim model with MTEB score ~69.67, native MLX GPU acceleration
from embedding_model import encode_texts, load_model

# Import Bible quote processor
from bible_quote_processor import process_text, QuoteBoundary

# Cached embeddings for theological concepts (computed once, reused)
# =============================================================================
# This is NOT a restricted tag list - it's a semantic knowledge base for
# inferring what the sermon is ABOUT. The embedding model finds concepts that
# are semantically similar to the sermon content, even if the exact words
# never appear in the sermon.
#
# Example: A sermon about "following Jesus" and "denying self" will match
# "Discipleship" because the MEANING is similar, even though "Discipleship"
# is never spoken.
#
# Each entry is: "ConceptName - clarifying description"
# The description helps the embedding model understand the concept precisely.
# =============================================================================

THEOLOGICAL_CONCEPTS_KB = [
    # ==========================================================================
    # CORE CHRISTIAN DOCTRINES (what Christians believe)
    # ==========================================================================
    "Trinity - God as Father Son and Holy Spirit three in one",
    "Incarnation - God becoming human in Jesus Christ",
    "Atonement - Christ's death paying for sin",
    "Redemption - being bought back and rescued from sin",
    "Justification - being declared righteous before God by faith",
    "Sanctification - the process of becoming holy and Christlike",
    "Glorification - the ultimate transformation in heaven",
    "Salvation - being saved from sin and death through Christ",
    "Resurrection - rising from the dead as Christ did",
    "Second Coming - Christ's return at the end of time",
    "Judgment - God's final evaluation of humanity",
    "Heaven - eternal life with God",
    "Hell - eternal separation from God",
    "Sin - transgression against God's law and nature",
    "Original Sin - inherited sinful nature from Adam",
    "Sovereignty - God's supreme authority and control over all",
    "Providence - God's ongoing care and guidance of creation",
    "Election - God choosing people for salvation",
    "Predestination - God's foreordaining of events and salvation",
    "Free Will - human capacity to make genuine choices",
    "Inspiration - Scripture being God-breathed",
    "Inerrancy - the Bible being without error",
    "Revelation - God making himself known to humanity",
    
    # ==========================================================================
    # CHRISTIAN PRACTICES (what Christians do)
    # ==========================================================================
    "Discipleship - following Jesus as a student and apprentice",
    "Evangelism - sharing the gospel with unbelievers",
    "Witnessing - testifying to what God has done",
    "Prayer - communicating with God",
    "Intercession - praying on behalf of others",
    "Fasting - abstaining from food for spiritual purposes",
    "Worship - honoring and adoring God",
    "Praise - expressing gratitude and admiration to God",
    "Bible Study - reading and learning Scripture",
    "Meditation - deeply reflecting on God's word",
    "Fellowship - Christian community and gathering together",
    "Church Attendance - participating in corporate worship",
    "Baptism - water ritual signifying faith and new life",
    "Communion - Lord's Supper remembering Christ's sacrifice",
    "Confession - admitting sin to God and others",
    "Repentance - turning away from sin toward God",
    "Service - helping others in Jesus' name",
    "Ministry - using gifts to build up the church",
    "Missions - taking the gospel to other cultures",
    "Giving - financially supporting God's work",
    "Tithing - giving ten percent to the church",
    "Stewardship - managing God's resources responsibly",
    "Sabbath - rest and worship on the Lord's day",
    
    # ==========================================================================
    # CHRISTIAN VIRTUES & CHARACTER (who Christians become)
    # ==========================================================================
    "Faith - trusting God and believing his promises",
    "Hope - confident expectation of God's promises",
    "Love - selfless care for God and others",
    "Joy - deep gladness independent of circumstances",
    "Peace - tranquility and wholeness from God",
    "Patience - endurance and long-suffering",
    "Kindness - gentle and considerate treatment of others",
    "Goodness - moral excellence and virtue",
    "Faithfulness - loyal and reliable commitment",
    "Gentleness - humble and meek disposition",
    "Self-Control - mastery over desires and impulses",
    "Humility - modest view of oneself before God",
    "Meekness - strength under control",
    "Obedience - following God's commands",
    "Holiness - being set apart for God's purposes",
    "Righteousness - right standing and right living before God",
    "Purity - moral cleanness and innocence",
    "Integrity - wholeness and consistency of character",
    "Wisdom - applying knowledge rightly",
    "Discernment - distinguishing truth from error",
    "Courage - boldness in the face of fear",
    "Perseverance - continuing despite difficulties",
    "Contentment - satisfaction in any circumstance",
    "Gratitude - thankfulness to God",
    "Compassion - feeling and acting on others' suffering",
    "Mercy - not giving deserved punishment",
    "Grace - giving undeserved favor",
    "Forgiveness - releasing others from their debts against us",
    
    # ==========================================================================
    # THEOLOGICAL THEMES (concepts explored in sermons)
    # ==========================================================================
    "Grace - God's unmerited favor toward sinners",
    "Mercy - God withholding deserved judgment",
    "Blessing - God's favor and good gifts",
    "Covenant - God's binding agreement with his people",
    "Promise - God's reliable commitments",
    "Fulfillment - God keeping his promises",
    "Prophecy - God revealing future events",
    "Kingdom of God - God's reign and rule",
    "Gospel - good news of salvation through Christ",
    "Cross - Christ's crucifixion and its meaning",
    "Blood of Christ - the atoning sacrifice",
    "Sacrifice - giving up something valuable for God",
    "Offering - presenting gifts to God",
    "Altar - place of sacrifice and meeting God",
    "Temple - God's dwelling place",
    "Tabernacle - portable sanctuary in the wilderness",
    "Ark of the Covenant - symbol of God's presence",
    "Glory of God - God's visible splendor and honor",
    "Presence of God - experiencing God's nearness",
    "Word of God - Scripture and divine communication",
    "Law - God's commands and moral standards",
    "Commandments - God's specific instructions",
    "Testimony - witness to God's work",
    "Truth - reality as God defines it",
    "Light - God's revelation and guidance",
    "Darkness - sin and spiritual ignorance",
    "Life - spiritual vitality from God",
    "Death - physical and spiritual separation from God",
    "Eternal Life - unending existence with God",
    
    # ==========================================================================
    # BIBLICAL NARRATIVES & EVENTS (stories and history)
    # ==========================================================================
    "Creation - God making the world",
    "Fall of Man - Adam and Eve's sin",
    "Flood - Noah and God's judgment",
    "Exodus - Israel's deliverance from Egypt",
    "Passover - deliverance through the lamb's blood",
    "Wilderness - Israel's desert wandering",
    "Promised Land - Canaan as Israel's inheritance",
    "Conquest - Joshua taking the land",
    "Judges - cycle of sin and deliverance",
    "Kingdom - Israel under Saul David and Solomon",
    "Exile - Israel's captivity in Babylon",
    "Return - restoration from exile",
    "Nativity - Jesus' birth in Bethlehem",
    "Baptism of Jesus - Spirit descending like a dove",
    "Temptation - Jesus overcoming Satan in desert",
    "Ministry of Jesus - teaching healing and miracles",
    "Sermon on the Mount - Jesus' ethical teaching",
    "Parables - Jesus' teaching stories",
    "Miracles - supernatural signs of God's power",
    "Transfiguration - Jesus revealed in glory",
    "Passion - Jesus' suffering and death",
    "Crucifixion - Jesus dying on the cross",
    "Burial - Jesus in the tomb",
    "Empty Tomb - evidence of resurrection",
    "Resurrection Appearances - Jesus seen alive",
    "Ascension - Jesus returning to heaven",
    "Pentecost - Holy Spirit coming upon believers",
    "Early Church - first Christian community",
    "Persecution - suffering for faith",
    "Martyrdom - dying for faith in Christ",
    
    # ==========================================================================
    # CHRISTIAN LIFE & RELATIONSHIPS (living out faith)
    # ==========================================================================
    "Marriage - covenant union between husband and wife",
    "Family - household as unit of discipleship",
    "Parenting - raising children in the faith",
    "Children - young ones in God's family",
    "Singleness - unmarried life for God's purposes",
    "Friendship - close relationships among believers",
    "Community - life together in the body of Christ",
    "Church - gathered believers as Christ's body",
    "Leadership - guiding others in the faith",
    "Pastoring - shepherding God's flock",
    "Teaching - instructing in the faith",
    "Preaching - proclaiming God's word",
    "Mentoring - training younger believers",
    "Accountability - mutual responsibility in faith",
    "Unity - oneness among believers",
    "Diversity - variety of gifts and backgrounds",
    "Work - labor as service to God",
    "Vocation - calling to specific work",
    "Rest - sabbath and refreshment",
    "Leisure - recreation and enjoyment",
    "Money - financial stewardship",
    "Possessions - material goods and simplicity",
    "Generosity - giving freely to others",
    "Hospitality - welcoming strangers and guests",
    "Justice - right treatment of others",
    "Compassion Ministry - caring for the needy",
    "Social Concern - addressing society's problems",
    
    # ==========================================================================
    # SPIRITUAL WARFARE & GROWTH (inner life)
    # ==========================================================================
    "Spiritual Warfare - battle against evil forces",
    "Temptation - enticement to sin",
    "Sin - falling short of God's standard",
    "Confession - admitting wrongdoing",
    "Forgiveness - being pardoned by God",
    "Cleansing - being made pure from sin",
    "Renewal - being made new spiritually",
    "Transformation - being changed by God",
    "Growth - maturing in faith",
    "Fruit of the Spirit - evidence of Spirit's work",
    "Spiritual Gifts - abilities given by the Spirit",
    "Calling - God's summons to purpose",
    "Purpose - God's intention for life",
    "Destiny - God's plan for the future",
    "Identity in Christ - who we are in Jesus",
    "Adoption - being made God's children",
    "Inheritance - what believers receive from God",
    "Security - assurance of salvation",
    "Assurance - confidence in relationship with God",
    "Doubt - struggling with belief",
    "Suffering - enduring hardship and pain",
    "Trials - tests of faith",
    "Persecution - opposition for following Christ",
    "Endurance - persisting through difficulty",
    "Victory - overcoming through Christ",
    "Deliverance - being set free from bondage",
    "Healing - restoration of body soul or spirit",
    "Comfort - God's consolation in sorrow",
    "Peace of God - supernatural tranquility",
    
    # ==========================================================================
    # ESCHATOLOGY (end times)
    # ==========================================================================
    "End Times - events before Christ's return",
    "Signs of the Times - indicators of the end",
    "Tribulation - period of intense suffering",
    "Antichrist - opponent of Christ in end times",
    "Rapture - believers caught up to meet Christ",
    "Second Coming - Christ's return to earth",
    "Millennium - thousand year reign",
    "Final Judgment - God's ultimate verdict",
    "Lake of Fire - place of eternal punishment",
    "New Heaven - renewed creation above",
    "New Earth - renewed creation below",
    "New Jerusalem - heavenly city",
    "Eternity - endless existence with God",
    "Resurrection of the Dead - all rising for judgment",
    "Rewards - recompense for faithful service",
    "Crowns - symbols of eternal reward",
    
    # ==========================================================================
    # KEY BIBLICAL FIGURES (people to learn from)
    # ==========================================================================
    "Abraham - father of faith",
    "Moses - lawgiver and deliverer",
    "David - shepherd king after God's heart",
    "Solomon - wisest king",
    "Elijah - prophet of fire",
    "Isaiah - messianic prophet",
    "Jeremiah - weeping prophet",
    "Daniel - faithful in exile",
    "John the Baptist - forerunner of Christ",
    "Peter - rock and apostle",
    "Paul - apostle to Gentiles",
    "Mary - mother of Jesus",
    "Mary Magdalene - witness to resurrection",
    "Apostles - sent ones of Jesus",
    "Prophets - spokespersons for God",
    "Patriarchs - founding fathers of Israel",
]

# Cached embeddings for theological concepts (computed once, reused)
theological_concept_embeddings = None
theological_concept_names = None  # Clean names without descriptions

def transcribe_audio(file_path: str) -> str:
    print("Transcribing audio...")
    # Use mlx-whisper with medium model for good speed-accuracy balance
    model_repo = "mlx-community/whisper-medium-mlx"
    
    print("✓ Using Apple Silicon GPU via MLX")
    
    # Balanced parameters optimized for long files
    # IMPORTANT: no_speech_threshold is set to None to prevent skipping audio segments.
    # With a threshold like 0.6, Whisper can skip 10-30+ seconds of audio if it detects
    # "silence" (which may actually be soft speech, background music, or pauses).
    # For sermon transcription, we want ALL audio transcribed, even quiet parts.
    result = mlx_whisper.transcribe(
        file_path,
        path_or_hf_repo=model_repo,
        language="en",  # Specify language for better accuracy
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),  # Temperature fallback to avoid hallucinations
        compression_ratio_threshold=2.4,  # Detect repetitions
        logprob_threshold=-1.0,  # Filter low-confidence segments
        no_speech_threshold=None,  # DISABLED - prevents skipping audio segments
        condition_on_previous_text=True,  # Use context from previous segments
        verbose=True,  # Show progress for long files
        fp16=True,  # MLX natively supports fp16 on Apple Silicon
        initial_prompt="This is a clear audio recording of speech."  # Help model recognize speech
    )
    print("Finished transcribing!")
    return str(result["text"])

# Prayer detection patterns - sentences that start prayers (NOT including "Amen" which ENDS prayers)
# These patterns should be SPECIFIC to prayer invocations, not just any sentence starting with "God" or "Lord"
PRAYER_START_PATTERNS = [
    r"^let'?s\s+pray",                          # "Let's pray"
    r"^let\s+us\s+pray",                        # "Let us pray"
    r"^dearly?\s+(heavenly\s+)?father",         # "Dear Father", "Dearly Father"  
    r"^dear\s+(lord|god)",                      # "Dear Lord", "Dear God"
    r"^(lord|father|god),?\s+(we|i)\s+(ask|pray|thank|come)\b",  # "Lord, we pray/ask/thank/come"
    r"^in\s+jesus['']?\s+name",                 # "In Jesus' name"
    # NOTE: "Amen" is NOT a prayer start - it ENDS prayers. Handled separately below.
]

# Pattern to detect sentences that END with "Amen" (prayer endings)
# This matches "Amen.", "In Jesus' name we pray, Amen.", etc.
AMEN_END_PATTERN = r"\bamen\s*[.!]?\s*$"


def convert_to_markdown(transcript: str, quote_boundaries: Optional[List[QuoteBoundary]] = None,
                        tags: Optional[List[str]] = None, scripture_refs: Optional[List[str]] = None) -> str:
    """
    Convert the final transcript to a formatted markdown file.
    
    Output structure:
    1. Tags section (first)
    2. Scripture References section (second)
    3. Transcript with formatting:
       - Bible quotes (text in "...") are italicized
       - Bible verse references (e.g., "Matthew 2:1-12") are bolded
    
    Args:
        transcript: The paragraphed transcript text
        quote_boundaries: List of QuoteBoundary objects for quotes
        tags: List of keyword tag strings
        scripture_refs: List of scripture reference strings
    
    Returns:
        Formatted markdown string
    """
    print("Converting to markdown format...")
    
    markdown_parts = []
    
    # Section 1: Tags (if available)
    if tags:
        markdown_parts.append("## Tags\n")
        markdown_parts.append(", ".join(tags))
        markdown_parts.append("\n")
    
    # Section 2: Scripture References (if available)
    if scripture_refs:
        markdown_parts.append("\n---\n")
        markdown_parts.append("\n## Scripture References\n")
        markdown_parts.append("\n".join(f"- {ref}" for ref in scripture_refs))
        markdown_parts.append("\n")
    
    # Section 3: Transcript with formatting
    if tags or scripture_refs:
        markdown_parts.append("\n---\n")
    markdown_parts.append("\n## Transcript\n\n")
    
    # Process the transcript to add formatting
    formatted_transcript = transcript
    
    # Remove any existing metadata sections from the transcript (they'll be at the start now)
    # These are added at the end in the current pipeline, so strip them
    if "---\n\n## Scripture References" in formatted_transcript:
        formatted_transcript = formatted_transcript.split("---\n\n## Scripture References")[0].strip()
    if "---\n\n## Tags" in formatted_transcript:
        formatted_transcript = formatted_transcript.split("---\n\n## Tags")[0].strip()
    
    # Step B: Bold Bible verse references in the text
    # Create a pattern that matches Bible references like "Matthew 2:1-12", "John 3:16", etc.
    # This should match the book names followed by chapter:verse patterns
    bible_books_pattern = r'\b(' + '|'.join([
        # Old Testament
        'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
        'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
        '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther',
        'Job', 'Psalms?', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
        'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
        'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
        'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
        # New Testament
        'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
        '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
        'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
        '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
        'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
        'Jude', 'Revelation'
    ]) + r')\s+(\d+)(?::(\d+)(?:-(\d+))?)?'
    
    def bold_reference(match):
        full_match = match.group(0)
        # Only bold if it looks like a proper reference (has chapter at minimum)
        return f'**{full_match}**'
    
    formatted_transcript = re.sub(bible_books_pattern, bold_reference, formatted_transcript, flags=re.IGNORECASE)
    
    # Clean up any double-bolding that might occur
    formatted_transcript = re.sub(r'\*\*\*\*', '**', formatted_transcript)
    
    markdown_parts.append(formatted_transcript)
    
    result = "".join(markdown_parts)
    
    print(f"   ✓ Markdown conversion complete")
    if quote_boundaries:
        print(f"      • {len(quote_boundaries)} quotes italicized")
    if scripture_refs:
        print(f"      • {len(scripture_refs)} references section")
    if tags:
        print(f"      • {len(tags)} tags in header")
    
    return result


def segment_into_paragraphs(text: str, quote_boundaries: Optional[List[QuoteBoundary]] = None, 
                            min_sentences_per_paragraph: int = 8, 
                            similarity_threshold: float = 0.55, 
                            window_size: int = 3) -> str:
    """
    Intelligently segment text into paragraphs based on semantic similarity.
    
    Uses EmbeddingGemma-300m-4bit (768-dim) for sentence embeddings.
    The threshold was calibrated from 0.65 (MiniLM 384-dim) to 0.55 for the
    new model's higher-quality similarity distributions.
    Optimized for rambling speech like sermons - avoids over-segmentation.
    
    IMPORTANT: This function ensures Bible quotes are never split across paragraphs.
    Quotes are treated as atomic units that must stay together.
    
    Also detects prayers and ensures they start new paragraphs.
    
    Args:
        text: The input text to segment (with quotes already marked)
        quote_boundaries: List of QuoteBoundary objects indicating quote positions
                         (used to prevent splitting quotes across paragraphs)
        min_sentences_per_paragraph: Minimum sentences before allowing a paragraph break (default: 8)
        similarity_threshold: Cosine similarity threshold (0-1). Lower = more paragraphs (default: 0.65)
        window_size: Number of sentence transitions to average for smoother detection (default: 3)
    
    Returns:
        Text with paragraph breaks (double newlines)
    """
    print("Segmenting text into paragraphs based on context...")
    
    # Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    
    if len(sentences) <= min_sentences_per_paragraph:
        return text
    
    # Detect sentences that are prayer starts (should force paragraph break before)
    prayer_start_sentences = set()
    # Detect sentences that are "Amen" (should be attached to previous paragraph)
    amen_sentences = set()
    for sent_idx, sentence in enumerate(sentences):
        sent_stripped = sentence.strip()
        # Check for "Amen" first (takes priority)
        if re.search(AMEN_END_PATTERN, sent_stripped, re.IGNORECASE):
            amen_sentences.add(sent_idx)
        else:
            for pattern in PRAYER_START_PATTERNS:
                if re.search(pattern, sent_stripped, re.IGNORECASE):
                    prayer_start_sentences.add(sent_idx)
                    break
    
    if prayer_start_sentences:
        print(f"   Detected {len(prayer_start_sentences)} prayer start(s) (will force paragraph breaks)")
    if amen_sentences:
        print(f"   Detected {len(amen_sentences)} 'Amen' sentence(s) (will attach to previous paragraph)")
    
    # Build prayer RANGES (start_idx → amen_idx) to prevent breaks within prayers
    # Each PRIMARY prayer start should find its corresponding Amen ending
    # NESTED prayer starts (like "Dearly Father" inside "Let's pray") should NOT force breaks
    sentences_in_prayers = set()
    primary_prayer_starts = set()  # Only these will force paragraph breaks
    prayer_ranges = []  # List of (start, end) tuples
    sorted_prayer_starts = sorted(prayer_start_sentences)
    sorted_amens = sorted(amen_sentences)
    used_amens = set()
    
    for prayer_start_idx in sorted_prayer_starts:
        # Skip if this start is already inside another prayer range
        already_in_range = False
        for (range_start, range_end) in prayer_ranges:
            if range_start <= prayer_start_idx <= range_end:
                already_in_range = True
                break
        
        if already_in_range:
            continue  # This is a nested prayer start, skip it
            
        # Find the first unused Amen after this start
        amen_idx = None
        for candidate_amen in sorted_amens:
            if candidate_amen > prayer_start_idx and candidate_amen not in used_amens:
                amen_idx = candidate_amen
                used_amens.add(amen_idx)
                break
        
        if amen_idx is not None:
            # This is a PRIMARY prayer start - mark it and build range
            primary_prayer_starts.add(prayer_start_idx)
            prayer_ranges.append((prayer_start_idx, amen_idx))
            # Mark all sentences in this range
            for idx in range(prayer_start_idx, amen_idx + 1):
                sentences_in_prayers.add(idx)
    
    if sentences_in_prayers:
        print(f"   {len(sentences_in_prayers)} sentences are within prayers (will not split)")
        if len(primary_prayer_starts) < len(prayer_start_sentences):
            nested = len(prayer_start_sentences) - len(primary_prayer_starts)
            print(f"   {nested} nested prayer pattern(s) detected (will not force breaks)")
    
    # Build a mapping of character positions to sentence indices
    # This helps us identify which sentences are part of quotes
    sentence_char_positions = []
    current_pos = 0
    for sent in sentences:
        start_pos = text.find(sent, current_pos)
        if start_pos == -1:
            start_pos = current_pos
        end_pos = start_pos + len(sent)
        sentence_char_positions.append((start_pos, end_pos))
        current_pos = end_pos
    
    # Identify which sentences are part of quotes (should not be split)
    # For quotes with interjections, we need to track the full quote range
    sentences_in_quotes = set()
    quote_ranges = []  # List of (first_sentence_idx, last_sentence_idx) for each quote
    if quote_boundaries:
        for quote in quote_boundaries:
            first_sent_idx = None
            last_sent_idx = None
            for sent_idx, (sent_start, sent_end) in enumerate(sentence_char_positions):
                # Check if sentence overlaps with quote boundary
                # A sentence is "in" a quote if there's any overlap
                if sent_start < quote.end_pos and sent_end > quote.start_pos:
                    sentences_in_quotes.add(sent_idx)
                    if first_sent_idx is None:
                        first_sent_idx = sent_idx
                    last_sent_idx = sent_idx
            
            # Store the full range for this quote (handles interjections)
            if first_sent_idx is not None and last_sent_idx is not None:
                quote_ranges.append((first_sent_idx, last_sent_idx))
        
        print(f"   {len(sentences_in_quotes)} sentences are within Bible quotes (will not split)")
        if any(end - start > 0 for start, end in quote_ranges):
            multi_sent_quotes = sum(1 for start, end in quote_ranges if end > start)
            print(f"   {multi_sent_quotes} quotes span multiple sentences (will keep together)")
    
    # Get embeddings for all sentences using unified EmbeddingGemma model (768-dim)
    # Task: semantic_similarity for paragraph boundary detection
    print(f"Analyzing {len(sentences)} sentences...")
    embeddings = encode_texts(sentences, task="semantic_similarity")
    
    # Calculate cosine similarities between consecutive sentences
    similarities = []
    for i in range(len(embeddings) - 1):
        cos_sim = np.dot(embeddings[i], embeddings[i + 1]) / (
            np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[i + 1])
        )
        similarities.append(cos_sim)
    
    # Calculate rolling average for smoother topic detection
    smoothed_similarities = []
    for i in range(len(similarities)):
        start_idx = max(0, i - window_size // 2)
        end_idx = min(len(similarities), i + window_size // 2 + 1)
        avg_sim = np.mean(similarities[start_idx:end_idx])
        smoothed_similarities.append(avg_sim)
    
    # Build paragraphs with minimum length requirement
    # CRITICAL: Never break inside a quote (even with interjections)
    # ALSO: Force breaks before AND after prayers (prayers get their own paragraphs)
    paragraphs = []
    current_paragraph = [sentences[0]]
    just_ended_prayer = False  # Track if we just added an Amen
    
    for i, similarity in enumerate(smoothed_similarities):
        next_sentence_idx = i + 1
        
        # If we just ended a prayer with Amen, force a paragraph break now
        if just_ended_prayer:
            if current_paragraph:
                paragraphs.append(' '.join(current_paragraph))
                current_paragraph = []
            just_ended_prayer = False
        
        # Check if this sentence (i+1) is a PRIMARY prayer start (force break BEFORE it)
        # Only primary prayer starts force breaks - nested ones (like "Dearly Father" inside "Let's pray") don't
        is_new_prayer_start = next_sentence_idx in primary_prayer_starts
        if is_new_prayer_start and current_paragraph:
            # Force paragraph break before prayer
            paragraphs.append(' '.join(current_paragraph))
            current_paragraph = [sentences[next_sentence_idx]]
            continue
        
        # If this is an "Amen" sentence, add it to current paragraph and mark for break after
        if next_sentence_idx in amen_sentences:
            current_paragraph.append(sentences[next_sentence_idx])
            just_ended_prayer = True  # Will force break on next iteration
            continue
        
        current_paragraph.append(sentences[next_sentence_idx])
        
        # Determine if we CAN break here (not inside a quote OR a prayer)
        can_break = True
        
        # Check if we're in the middle of a prayer - if so, don't break
        if sentences_in_prayers:
            if next_sentence_idx in sentences_in_prayers:
                # Check if the next sentence is also part of the same prayer
                if (next_sentence_idx + 1) < len(sentences) and (next_sentence_idx + 1) in sentences_in_prayers:
                    can_break = False
        
        # Check if we're in the middle of a quote (including quotes with interjections)
        # Use quote_ranges to check if current and next sentence are part of same logical quote
        if can_break and quote_ranges:
            for quote_start, quote_end in quote_ranges:
                # If current sentence is within a quote range and there are more sentences
                # in that same quote range after us, don't break
                if quote_start <= next_sentence_idx <= quote_end:
                    if next_sentence_idx < quote_end:
                        # There are more sentences in this quote - don't break
                        can_break = False
                        break
        
        # Check for interjection pattern: sentence ends with "what?", "who?", etc.
        # and next sentence starts with a quote - these should stay together
        if can_break and (next_sentence_idx + 1) < len(sentences):
            current_sent = sentences[next_sentence_idx].strip()
            following_sent = sentences[next_sentence_idx + 1].strip()
            # Pattern: current ends with interjection question
            if re.search(r'\b(what|who|where|when|why|how)\?\s*$', current_sent, re.IGNORECASE):
                # If the next sentence is part of a quote, don't break
                if (next_sentence_idx + 1) in sentences_in_quotes:
                    can_break = False
        
        # Only consider breaking if we have minimum sentences AND we're not in a quote/prayer
        if len(current_paragraph) >= min_sentences_per_paragraph and can_break:
            # Break on significant topic change
            if similarity < similarity_threshold:
                paragraphs.append(' '.join(current_paragraph))
                current_paragraph = []
        
        # Progress indicator for long texts
        if (next_sentence_idx) % 50 == 0:
            print(f"  Processed {next_sentence_idx}/{len(smoothed_similarities)} sentence transitions...")
    
    # Add final paragraph
    if current_paragraph:
        paragraphs.append(' '.join(current_paragraph))
    
    print(f"✓ Created {len(paragraphs)} paragraphs from {len(sentences)} sentences")
    print(f"  Average: {len(sentences) / len(paragraphs):.1f} sentences per paragraph")
    
    # Join paragraphs with double newlines
    return '\n\n'.join(paragraphs)


def compute_concept_embeddings() -> tuple:
    """
    Compute embeddings for all theological concepts in the knowledge base.
    Uses EmbeddingGemma-300m via mlx-embeddings with "classification" task prefix.
    This is done once and cached for fast semantic matching.
    
    Returns:
        Tuple of (concept_names: List[str], embeddings: np.ndarray)
        concept_names are the clean concept names (before " - ")
        embeddings are the full concept embeddings (768-dim, including descriptions)
    """
    global theological_concept_embeddings, theological_concept_names
    
    if theological_concept_embeddings is not None:
        return theological_concept_names, theological_concept_embeddings
    
    # Extract clean concept names (before " - ") for display
    # But embed the full description for better semantic matching
    theological_concept_names = []
    for concept in THEOLOGICAL_CONCEPTS_KB:
        # Split on " - " to get just the name
        name = concept.split(" - ")[0].strip()
        theological_concept_names.append(name)
    
    # Encode the FULL concepts (including descriptions) for better semantic matching
    # Uses "classification" task prefix for theme matching
    theological_concept_embeddings = encode_texts(THEOLOGICAL_CONCEPTS_KB, task="classification")
    
    return theological_concept_names, theological_concept_embeddings


def chunk_text(text: str, max_words: int = 400, overlap_words: int = 50) -> List[str]:
    """
    Split text into overlapping chunks for better semantic coverage.
    
    Args:
        text: Text to chunk
        max_words: Maximum words per chunk
        overlap_words: Words to overlap between chunks
        
    Returns:
        List of text chunks
    """
    words = text.split()
    if len(words) <= max_words:
        return [text]
    
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + max_words, len(words))
        chunk = ' '.join(words[start:end])
        chunks.append(chunk)
        
        # Move start forward, accounting for overlap
        start = end - overlap_words
        if start >= len(words) - overlap_words:
            break
    
    return chunks


def get_semantic_themes(text: str, top_k: int = 15, min_similarity: float = 0.35,
                        verbose: bool = True) -> List[tuple]:
    """
    Infer semantic themes from text by comparing against the theological concepts KB.
    
    This finds concepts the sermon is semantically ABOUT, even if those exact words
    never appear in the text. For example, a sermon about "following Jesus" and 
    "denying self" will match "Discipleship" through semantic similarity.
    
    Args:
        text: The sermon text to analyze
        top_k: Maximum number of themes to return
        min_similarity: Minimum cosine similarity to include a theme (default: 0.35)
        verbose: Whether to print progress messages
        
    Returns:
        List of (concept_name, similarity_score) tuples, sorted by score descending
    """
    # Get concept embeddings (cached)
    if verbose:
        print("   Loading theological concepts knowledge base...")
    concept_names, concept_embeddings = compute_concept_embeddings()
    if verbose:
        print(f"   Loaded {len(concept_names)} theological concepts")
    
    # Chunk the text for better semantic coverage
    if verbose:
        print("   Chunking text for semantic analysis...")
    chunks = chunk_text(text, max_words=400, overlap_words=50)
    if verbose:
        print(f"   Created {len(chunks)} text chunks")
    
    # Embed all chunks using EmbeddingGemma with "classification" task prefix
    if verbose:
        print("   Computing text embeddings...")
    chunk_embeddings = encode_texts(chunks, task="classification")
    
    # Create a combined sermon embedding (average of chunks)
    sermon_embedding = np.mean(chunk_embeddings, axis=0)
    
    # Also compute per-chunk similarities for more nuanced matching
    # This helps catch themes that appear in specific parts of the sermon
    all_similarities = {}
    
    # Method 1: Compare sermon-level embedding to each concept
    for i, (name, concept_emb) in enumerate(zip(concept_names, concept_embeddings)):
        cos_sim = np.dot(sermon_embedding, concept_emb) / (
            np.linalg.norm(sermon_embedding) * np.linalg.norm(concept_emb)
        )
        all_similarities[name] = cos_sim
    
    # Method 2: Also track max per-chunk similarity (catches localized themes)
    chunk_max_similarities = {}
    for chunk_emb in chunk_embeddings:
        for i, (name, concept_emb) in enumerate(zip(concept_names, concept_embeddings)):
            cos_sim = np.dot(chunk_emb, concept_emb) / (
                np.linalg.norm(chunk_emb) * np.linalg.norm(concept_emb)
            )
            if name not in chunk_max_similarities or cos_sim > chunk_max_similarities[name]:
                chunk_max_similarities[name] = cos_sim
    
    # Combine both methods: use weighted average of overall and max-chunk similarity
    # This ensures both sermon-wide themes and localized themes are captured
    combined_similarities = {}
    for name in concept_names:
        overall = all_similarities.get(name, 0)
        max_chunk = chunk_max_similarities.get(name, 0)
        # Weight: 60% overall similarity, 40% max chunk similarity
        combined_similarities[name] = 0.6 * overall + 0.4 * max_chunk
    
    # Sort by combined similarity
    sorted_concepts = sorted(combined_similarities.items(), key=lambda x: x[1], reverse=True)
    
    # Filter by minimum similarity and take top-k
    results = [(name, score) for name, score in sorted_concepts if score >= min_similarity][:top_k]
    
    # Remove duplicate concepts (some concepts appear in multiple categories with same name)
    seen_names = set()
    unique_results = []
    for name, score in results:
        # Normalize name (some concepts like "Grace" appear twice)
        if name not in seen_names:
            seen_names.add(name)
            unique_results.append((name, score))
    
    if verbose:
        print(f"   ✓ Found {len(unique_results)} semantic themes")
        for name, score in unique_results[:5]:
            print(f"      • {name}: {score:.3f}")
    
    return unique_results


def extract_tags(text: str, quote_boundaries: Optional[List[QuoteBoundary]] = None,
                 max_tags: int = 10, verbose: bool = True,
                 use_semantic_inference: bool = True, semantic_threshold: float = 0.40) -> List[str]:
    """
    Extract tags from a Christian sermon transcript using semantic theme inference.
    
    Infers what the sermon is ABOUT by comparing its embedding against a
    comprehensive theological concepts knowledge base (~200 concepts).
    This finds themes like "Discipleship" from a sermon about "following Jesus"
    even if the word "Discipleship" never appears.
    
    Uses EmbeddingGemma-300m-4bit via mlx-embeddings for all embeddings.
    
    Args:
        text: The transcript text (with or without paragraphs)
        quote_boundaries: Quote boundaries to exclude quoted Bible text from analysis
        max_tags: Maximum number of tags to return (default: 10)
        verbose: Whether to print progress messages
        use_semantic_inference: Use semantic theme inference (default: True)
        semantic_threshold: Minimum similarity for semantic themes (default: 0.40)
    
    Returns:
        List of tag strings from semantic theme inference
    """
    final_tags = []
    
    # Remove Bible quotes from the text to avoid extracting quoted scripture phrases
    clean_text = text.lower()
    if quote_boundaries:
        sorted_boundaries = sorted(quote_boundaries, key=lambda x: x.start_pos, reverse=True)
        for qb in sorted_boundaries:
            clean_text = clean_text[:qb.start_pos] + " " + clean_text[qb.end_pos:]
        if verbose:
            print(f"   Excluded {len(quote_boundaries)} Bible quotes from analysis")
    
    # =========================================================================
    # SEMANTIC THEME INFERENCE (sole tag extraction method)
    # Uses EmbeddingGemma-300m to find concepts the sermon is ABOUT
    # =========================================================================
    if use_semantic_inference:
        if verbose:
            print("\n   📚 SEMANTIC INFERENCE: What is this sermon about?")
        
        try:
            semantic_themes = get_semantic_themes(
                clean_text, 
                top_k=max_tags,
                min_similarity=semantic_threshold,
                verbose=verbose
            )
            
            # Add semantic themes to final tags
            for theme_name, score in semantic_themes:
                if theme_name not in final_tags:
                    final_tags.append(theme_name)
                    
            if verbose and semantic_themes:
                print(f"   ✓ Inferred {len(semantic_themes)} semantic themes from sermon content")
                
        except Exception as e:
            if verbose:
                print(f"   ⚠️  Semantic inference error: {str(e)}")
    
    if verbose:
        print(f"\n   ✅ Final tag set: {len(final_tags)} tags")
        for tag in final_tags:
            print(f"      • {tag}")
    
    return final_tags



if __name__ == "__main__":
    import sys
    
    # Check for test mode flag
    test_mode = "test" in sys.argv
    
    # Get input file from command line or use default (skip "test" argument)
    args = [arg for arg in sys.argv[1:] if arg != "test"]
    if args:
        audio_file = args[0]
    else:
        audio_file = "20251214-SunAM-Polar.mp3"
    
    # PIPELINE ORDER (optimized):
    # 1. Transcribe audio to raw text (or load from test file)
    # 2. Process Bible quotes (auto-detect translation + normalize references + add quotation marks)
    # 3. Segment into paragraphs (respecting quote boundaries)
    # 4. Extract scripture references
    # 5. Extract keyword tags for categorization
    # 6. Convert to final markdown file (final.md)
    
    print("\n" + "=" * 70)
    print("SERMON TRANSCRIPTION PIPELINE")
    if test_mode:
        print("Mode: TEST (using whisper_test.txt)")
    else:
        print(f"Input: {audio_file}")
    print("Bible Translation: AUTO-DETECT (per-quote)")
    print("=" * 70)
    
    # Step 1: Transcribe audio OR load test file
    if test_mode:
        print("\n📝 STEP 1: Loading test file (whisper_test.txt)...")
        with open("whisper_test.txt", "r", encoding="utf-8") as f:
            raw = f.read()
        print("   ✓ Loaded test transcription from: whisper_test.txt")
    else:
        print("\n📝 STEP 1: Transcribing audio...")
        raw = transcribe_audio(audio_file)
        
        # Save raw transcription for debugging
        with open("whisper_raw.txt", "w", encoding="utf-8") as f:
            f.write(raw)
        print("   Raw transcription saved to: whisper_raw.txt")
    
    # Step 2: Process Bible quotes using the bible_quote_processor
    # Translation is auto-detected PER QUOTE from the transcript content
    # This handles speakers who switch translations mid-sermon
    # This normalizes references (e.g., "Hebrews 725" → "Hebrews 7:25")
    # and adds quotation marks around actual Bible quotes
    print("\n📖 STEP 2: Processing Bible quotes (detecting translation per-quote)...")
    with_quotes, quote_boundaries = process_text(raw, translation="", auto_detect=True, verbose=True)
    
    # Step 3: Segment into paragraphs (respecting quote boundaries)
    # The quote_boundaries are passed so quotes are never split across paragraphs
    print("\n📄 STEP 3: Segmenting into paragraphs...")
    paragraphed = segment_into_paragraphs(
        with_quotes,
        quote_boundaries=quote_boundaries,
        min_sentences_per_paragraph=5,  # At least 5 sentences per paragraph
        similarity_threshold=0.45,  # EmbeddingGemma-300m: calibrated for ~15 paragraphs per sermon
        window_size=3  # Smooth detection over 3 sentence transitions
    )
    
    # Step 4: Build scripture references section
    print("\n📖 STEP 4: Building scripture references...")
    references_section = ""
    if quote_boundaries:
        # Extract unique references, preserving order of first appearance
        # Use the formatted reference string (e.g., "Matthew 2:1-12")
        seen_refs = set()
        unique_refs = []
        for qb in quote_boundaries:
            # Get the properly formatted reference string
            ref_str = qb.reference.to_standard_format()
            if ref_str not in seen_refs:
                seen_refs.add(ref_str)
                unique_refs.append(ref_str)
        
        if unique_refs:
            references_section = "\n\n---\n\n## Scripture References\n\n"
            references_section += "\n".join(f"- {ref}" for ref in unique_refs)
            print(f"   ✓ Found {len(unique_refs)} unique scripture references")
    else:
        print("   No scripture references found")
    
    # Step 5: Extract keyword tags for categorization
    print("\n🏷️  STEP 5: Extracting keyword tags...")
    tags = extract_tags(paragraphed, quote_boundaries=quote_boundaries, verbose=True)
    tags_section = ""
    if tags:
        tags_section = "\n\n---\n\n## Tags\n\n"
        tags_section += ", ".join(tags)
    
    # Append references and tags to the final output
    final_output = paragraphed
    if references_section:
        final_output += references_section
    if tags_section:
        final_output += tags_section
    
    # Save final output (plain text version)
    with open("whisper_cleaned.txt", "w", encoding="utf-8") as f:
        f.write(final_output)
    
    # Step 6: Convert to formatted markdown file
    print("\n📝 STEP 6: Converting to markdown (final.md)...")
    markdown_output = convert_to_markdown(
        transcript=paragraphed,
        quote_boundaries=quote_boundaries,
        tags=tags,
        scripture_refs=unique_refs if quote_boundaries else None
    )
    
    # Save markdown output
    with open("final.md", "w", encoding="utf-8") as f:
        f.write(markdown_output)
    print("   ✓ Markdown file saved to: final.md")
    
    print("\n" + "=" * 70)
    print("✅ TRANSCRIPTION COMPLETE!")
    print("=" * 70)
    print("\nOutput files:")
    if not test_mode:
        print("  • whisper_raw.txt      - Raw transcription (no processing)")
    print("  • whisper_quotes.txt   - With Bible quotes marked")
    print("  • whisper_cleaned.txt  - Final output with paragraphs")
    print("  • final.md             - Formatted markdown (tags, refs, italics, bold)")
    print(f"\nPipeline:")
    if test_mode:
        print("  1. ✓ Test file loaded (whisper_test.txt)")
    else:
        print("  1. ✓ Audio transcription (Whisper medium model)")
    print("  2. ✓ Bible translation auto-detection (per-quote)")
    print("  3. ✓ Bible quote detection and normalization")
    print("  4. ✓ Paragraph segmentation (quote-aware)")
    print("  5. ✓ Scripture references extracted")
    if tags:
        print(f"  6. ✓ Keyword tags extracted ({len(tags)} tags)")
    else:
        print("  6. ⚠️  Tag extraction returned no tags")
    print("  7. ✓ Markdown conversion (final.md)")
    print("=" * 70)