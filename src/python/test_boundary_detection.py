#!/usr/bin/env python3
"""
Test script for Bible passage boundary detection improvements.

This script tests the bidirectional search and introductory phrase detection
to ensure the boundary detection correctly identifies quote boundaries.

Run with: python test_boundary_detection.py
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import (
    find_quote_boundaries_improved,
    extract_reference_intro_length,
    BibleAPIClient,
    detect_bible_references,
    process_text,
    compute_sequential_alignment,
    find_verse_resumption_point,
    find_verse_end_in_transcript,
    detect_commentary_blocks,
    get_words,
    normalize_for_comparison,
)


def test_intro_phrase_detection():
    """Test that introductory phrases are correctly detected and skipped."""
    print("=" * 60)
    print("Testing Introductory Phrase Detection")
    print("=" * 60)
    
    test_cases = [
        # (transcript, ref_position, ref_length, expected_extra_skip)
        ("Romans 12:1 says I beseech you", 0, 11, " says"),
        ("Romans 12:1 Paul writes I beseech you", 0, 11, " Paul writes"),
        ("Let's look at Romans 12:1 it says I beseech you", 15, 11, " it says"),
        ("Romans 12:1 I beseech you", 0, 11, ""),  # No intro phrase
        ("The Bible tells us in Romans 12:1 that we should present", 18, 11, " that"),
    ]
    
    for transcript, ref_pos, ref_len, expected_extra in test_cases:
        result = extract_reference_intro_length(transcript, ref_pos, ref_len)
        extra_skip = result - ref_len
        if extra_skip > 0:
            actual_extra = transcript[ref_pos + ref_len:ref_pos + result]
        else:
            actual_extra = ""
        
        status = "✓" if actual_extra.strip() == expected_extra.strip() else "✗"
        print(f"{status} '{transcript[:50]}...'")
        print(f"   Expected extra: '{expected_extra.strip()}', Got: '{actual_extra.strip()}'")
    
    print()


def test_bidirectional_search():
    """Test that bidirectional search finds quotes in both directions."""
    print("=" * 60)
    print("Testing Bidirectional Search")
    print("=" * 60)
    
    # Romans 12:1 KJV: "I beseech you therefore, brethren, by the mercies of God, 
    # that ye present your bodies a living sacrifice, holy, acceptable unto God, 
    # which is your reasonable service."
    verse_text = "I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service."
    
    # Test case 1: Quote AFTER reference (most common pattern)
    transcript1 = "put a smile on his face. Romans 12:1 says Paul writes I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice wholly acceptable unto God which is your reasonable service. What is Paul saying."
    ref_position1 = transcript1.find("Romans 12:1")
    ref_length1 = len("Romans 12:1")
    
    print(f"Test 1: Quote AFTER reference")
    print(f"   Ref position: {ref_position1}")
    result1 = find_quote_boundaries_improved(verse_text, transcript1, ref_position1, ref_length1, debug=True)
    if result1:
        start, end, confidence = result1
        quote_text = transcript1[start:end]
        print(f"   ✓ Found quote at {start}-{end} (conf: {confidence:.2f})")
        print(f"   Quote: '{quote_text[:100]}...'")
        # Verify it doesn't include "his face" (text before reference)
        if "his face" in quote_text.lower():
            print(f"   ✗ ERROR: Quote incorrectly includes text BEFORE reference!")
        else:
            print(f"   ✓ Quote correctly excludes text before reference")
    else:
        print(f"   ✗ Failed to find quote")
    
    print()
    
    # Test case 2: Quote mentioned at end of quote (less common)
    transcript2 = "I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service. That's what Romans 12:1 tells us."
    ref_position2 = transcript2.find("Romans 12:1")
    ref_length2 = len("Romans 12:1")
    
    print(f"Test 2: Quote BEFORE reference (backward search)")
    print(f"   Ref position: {ref_position2}")
    result2 = find_quote_boundaries_improved(verse_text, transcript2, ref_position2, ref_length2, debug=True)
    if result2:
        start, end, confidence = result2
        quote_text = transcript2[start:end]
        print(f"   ✓ Found quote at {start}-{end} (conf: {confidence:.2f})")
        print(f"   Quote: '{quote_text[:100]}...'")
    else:
        print(f"   ✗ Failed to find quote (may be expected for backward-only case)")
    
    print()


def test_with_test_transcript():
    """Test with the actual test_mode_transcript.txt file."""
    print("=" * 60)
    print("Testing with test_mode_transcript.txt")
    print("=" * 60)
    
    transcript_file = Path(__file__).parent / "test_mode_transcript.txt"
    if not transcript_file.exists():
        print(f"   ⚠ Test transcript not found at {transcript_file}")
        return
    
    with open(transcript_file, 'r', encoding='utf-8') as f:
        transcript = f.read()
    
    print(f"   Loaded transcript: {len(transcript)} chars")
    
    # Find Romans 12:1 in the transcript
    romans_pos = transcript.find("Romans 12")
    if romans_pos == -1:
        print(f"   ⚠ Could not find Romans 12 in transcript")
        return
    
    print(f"   Found Romans 12 at position: {romans_pos}")
    
    # Show context around the reference
    context_start = max(0, romans_pos - 50)
    context_end = min(len(transcript), romans_pos + 200)
    context = transcript[context_start:context_end]
    print(f"   Context: '...{context}...'")
    
    # Test boundary detection
    verse_text = "I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service."
    
    # The reference in the transcript is "Romans 12 one" (spoken numbers)
    # After normalization it would be "Romans 12:1" - let's find the normalized position
    # For testing, let's use the original position
    ref_length = len("Romans 12 one says Paul writes")  # Full intro in transcript
    
    print(f"\n   Testing boundary detection with debug=True:")
    result = find_quote_boundaries_improved(verse_text, transcript, romans_pos, ref_length, debug=True)
    
    if result:
        start, end, confidence = result
        quote_text = transcript[start:end]
        print(f"\n   ✓ Result: positions {start}-{end}, confidence {confidence:.2f}")
        print(f"   Quote text: '{quote_text[:150]}...'")
        
        # Verify the quote contains expected text
        if "I beseech you" in quote_text.lower() or "beseech you" in quote_text.lower():
            print(f"   ✓ Quote contains expected 'beseech' text")
        else:
            print(f"   ✗ Quote missing expected 'beseech' text")
        
        # Verify the quote doesn't include "smile on his face" (text before)
        if "smile on his face" in quote_text.lower() or "his face" in quote_text.lower():
            print(f"   ✗ ERROR: Quote incorrectly includes text BEFORE reference!")
        else:
            print(f"   ✓ Quote correctly excludes text before reference")
    else:
        print(f"   ✗ Failed to detect quote")
    
    print()


def test_full_pipeline():
    """Test the full processing pipeline with the test transcript."""
    print("=" * 60)
    print("Testing Full Processing Pipeline")
    print("=" * 60)
    
    transcript_file = Path(__file__).parent / "test_mode_transcript.txt"
    if not transcript_file.exists():
        print(f"   ⚠ Test transcript not found at {transcript_file}")
        return
    
    with open(transcript_file, 'r', encoding='utf-8') as f:
        transcript = f.read()
    
    print(f"   Processing transcript ({len(transcript)} chars)...")
    print(f"   This may take a minute due to API calls...")
    
    try:
        processed_text, quotes = process_text(transcript, verbose=True)
        
        print(f"\n   Results:")
        print(f"   - Found {len(quotes)} quotes")
        
        # Look for Romans 12:1 specifically
        romans_quotes = [q for q in quotes if "Romans 12" in q.reference.to_standard_format()]
        print(f"   - Romans 12 quotes: {len(romans_quotes)}")
        
        for q in romans_quotes:
            ref = q.reference.to_standard_format()
            content = processed_text[q.start_pos:q.end_pos][:100]
            print(f"\n   {ref} (conf: {q.confidence:.2f}):")
            print(f"   Content: '{content}...'")
            
            # Verify content
            if "beseech" in content.lower():
                print(f"   ✓ Contains expected 'beseech' text")
            if "his face" in content.lower():
                print(f"   ✗ ERROR: Contains text from BEFORE reference!")
        
    except Exception as e:
        print(f"   ✗ Error during processing: {e}")
        import traceback
        traceback.print_exc()
    
    print()


# ============================================================================
# NEW TESTS: Sequential alignment, verse resumption, trailing punctuation,
#             and Galatians commentary detection integration test
# ============================================================================


def test_sequential_alignment_exact_verse():
    """Chunk contains exact verse words in order → high alignment ratio."""
    print("=" * 60)
    print("Testing Sequential Alignment: Exact Verse Match")
    print("=" * 60)

    verse_words = get_words(
        "I marvel that ye are so soon removed from him that called you"
    )
    # Transcript uses modern English but same order
    chunk_words = get_words(
        "I marvel that you are so soon removed from him that called you"
    )

    ratio, aligned, gaps = compute_sequential_alignment(chunk_words, verse_words)
    status = "✓" if ratio >= 0.8 else "✗"
    print(f"  {status} Alignment ratio: {ratio:.2f} (expected >= 0.80)")
    assert ratio >= 0.8, f"Expected high alignment for exact verse, got {ratio:.2f}"
    print()


def test_sequential_alignment_paraphrase():
    """Chunk contains same words in different order → low alignment ratio.

    This is the core test for Bug 2/3: paraphrases that reuse verse vocabulary
    in a different sequence should NOT be treated as verse text.
    """
    print("=" * 60)
    print("Testing Sequential Alignment: Paraphrase (different order)")
    print("=" * 60)

    verse_words = get_words(
        "I marvel that ye are so soon removed from him that called you "
        "into the grace of Christ unto another gospel Which is not another "
        "but there be some that trouble you and would pervert the gospel of Christ"
    )

    # Speaker says same words in totally different order (paraphrase)
    chunk_words = get_words(
        "Is there actually another gospel that you would pervert No theres "
        "really only one gospel but there are those that teach something that is "
        "different Similar but different Paul writes"
    )

    ratio, aligned, gaps = compute_sequential_alignment(chunk_words, verse_words)
    status = "✓" if ratio < 0.45 else "✗"
    print(f"  {status} Alignment ratio: {ratio:.2f} (expected < 0.45)")
    assert ratio < 0.45, f"Expected low alignment for paraphrase, got {ratio:.2f}"
    print()


def test_sequential_alignment_mixed():
    """Chunk is half verse, half commentary → medium alignment with gap regions."""
    print("=" * 60)
    print("Testing Sequential Alignment: Mixed verse + commentary")
    print("=" * 60)

    verse_words = get_words(
        "But though we or an angel from heaven preach any other gospel "
        "unto you than that which we have preached unto you let him be accursed"
    )

    # First half is verse, second half is commentary
    chunk_words = get_words(
        "but though we or an angel from heaven preach any other gospel "
        "so even if an angel comes down and says something different"
    )

    ratio, aligned, gaps = compute_sequential_alignment(chunk_words, verse_words)
    print(f"  Alignment ratio: {ratio:.2f}")
    print(f"  Gap regions: {gaps}")
    # Should have some aligned words and some gaps
    assert len(gaps) > 0, "Expected gap regions in mixed content"
    print(f"  ✓ Found {len(gaps)} gap region(s)")
    print()


def test_verse_resumption_with_punctuation():
    """Raw text has commas/periods that differ from verse → correct resumption point.

    This is the core test for Bug 1: word-level matching should be immune to
    punctuation differences between verse and transcript.
    """
    print("=" * 60)
    print("Testing Verse Resumption: Punctuation differences")
    print("=" * 60)

    verse_words = get_words(
        "But I certify you brethren that the gospel which was preached of me "
        "is not after man"
    )

    # Raw text has commas that differ from verse
    remaining = (
        "Paul says, I'm not here pushing my own opinion. "
        "But I certify, you brethren, that the gospel which was preached of me "
        "is not after man."
    )

    result = find_verse_resumption_point(remaining, verse_words, offset=0, min_run_length=3)
    assert result is not None, "Should find verse resumption point"

    resumed_text = remaining[result:]
    assert "certify" in resumed_text.lower(), f"Resumption should start at 'certify', got: '{resumed_text[:40]}'"
    # The resumed text should NOT include the commentary
    assert "pushing my own" not in resumed_text, "Resumption should not include commentary"
    print(f"  ✓ Resumption found at offset {result}: '{resumed_text[:50]}...'")
    print()


def test_verse_resumption_no_match():
    """No verse text after commentary → returns None."""
    print("=" * 60)
    print("Testing Verse Resumption: No match (all commentary)")
    print("=" * 60)

    verse_words = get_words("For God so loved the world that he gave his only begotten son")
    remaining = "This is completely unrelated commentary about something else entirely."

    result = find_verse_resumption_point(remaining, verse_words, offset=0, min_run_length=3)
    status = "✓" if result is None else "✗"
    print(f"  {status} Result: {result} (expected None)")
    assert result is None, f"Expected None for unrelated text, got {result}"
    print()


def test_trailing_punctuation_period():
    """Verse ends with 'Christ.' → end_pos includes the period."""
    print("=" * 60)
    print("Testing Trailing Punctuation: Period")
    print("=" * 60)

    transcript = "but by the revelation of Jesus Christ. And then he continued."
    verse_text = "but by the revelation of Jesus Christ."

    end_pos = find_verse_end_in_transcript(transcript, 0, verse_text)
    assert end_pos is not None, "Should find verse end"

    # The end position should include the period
    end_char = transcript[end_pos - 1] if end_pos > 0 else ''
    status = "✓" if end_char == '.' else "✗"
    print(f"  {status} End char: '{end_char}' at pos {end_pos} (expected '.')")
    print(f"  Extracted: '{transcript[:end_pos]}'")
    assert end_char == '.', f"Expected end_pos to include trailing period, got char '{end_char}'"
    print()


def test_trailing_punctuation_colon():
    """Verse ends with 'gospel:' → end_pos includes the colon."""
    print("=" * 60)
    print("Testing Trailing Punctuation: Colon")
    print("=" * 60)

    transcript = "unto another gospel: Which is not another but there be some"
    verse_text = "unto another gospel:"

    end_pos = find_verse_end_in_transcript(transcript, 0, verse_text)
    assert end_pos is not None, "Should find verse end"

    end_char = transcript[end_pos - 1] if end_pos > 0 else ''
    status = "✓" if end_char == ':' else "✗"
    print(f"  {status} End char: '{end_char}' at pos {end_pos} (expected ':')")
    assert end_char == ':', f"Expected end_pos to include trailing colon, got char '{end_char}'"
    print()


def test_trailing_punctuation_none():
    """Verse ends mid-sentence (no trailing punct) → end_pos unchanged."""
    print("=" * 60)
    print("Testing Trailing Punctuation: None (mid-sentence)")
    print("=" * 60)

    transcript = "I marvel that you are so soon removed from him that called you into the grace"
    verse_text = "I marvel that ye are so soon removed from him that called you"

    end_pos = find_verse_end_in_transcript(transcript, 0, verse_text)
    assert end_pos is not None, "Should find verse end"

    # "you" ends without punctuation, so no extension
    end_text = transcript[:end_pos]
    assert end_text.rstrip().endswith("you"), f"Should end at 'you', got: '{end_text[-20:]}'"
    print(f"  ✓ End at: '{end_text[-30:]}'")
    print()


def test_galatians_commentary_detection():
    """Verify all 3 commentary blocks in Galatians 1:6-12 are detected."""
    print("=" * 60)
    print("Testing Galatians 1:6-12 Commentary Detection (Integration)")
    print("=" * 60)

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

    print(f"  Found {len(blocks)} commentary block(s):")
    for idx, (bs, be) in enumerate(blocks):
        block_text = transcript[bs:be]
        print(f"  Block {idx + 1} [{bs}:{be}]: '{block_text[:60]}...'")

    # Should detect 3 commentary blocks
    assert len(blocks) == 3, f"Expected 3 commentary blocks, got {len(blocks)}"
    print(f"  ✓ Correct count: 3 blocks")

    # Block 1: "Is there actually another gospel..."
    block1_text = transcript[blocks[0][0]:blocks[0][1]]
    assert "Is there actually" in block1_text, f"Block 1 should contain 'Is there actually': '{block1_text[:60]}'"
    assert "but though we" not in block1_text, f"Block 1 should NOT include next verse start"
    print(f"  ✓ Block 1 correctly bounded")

    # Block 2: "So Paul says, even if I come back..."
    block2_text = transcript[blocks[1][0]:blocks[1][1]]
    assert "So Paul says" in block2_text or "Paul says, even" in block2_text, \
        f"Block 2 should contain 'So Paul says': '{block2_text[:60]}'"
    assert "As we said before" not in block2_text, f"Block 2 should NOT include next verse"
    print(f"  ✓ Block 2 correctly bounded")

    # Block 3: "Paul says, I'm not here pushing..."
    block3_text = transcript[blocks[2][0]:blocks[2][1]]
    assert "not here pushing" in block3_text or "my own opinion" in block3_text, \
        f"Block 3 should contain commentary: '{block3_text[:60]}'"
    assert "But I certify" not in block3_text, f"Block 3 should NOT include verse 11 start (Bug 1)"
    print(f"  ✓ Block 3 correctly bounded (Bug 1 verified)")

    print()


def test_no_false_positives_on_clean_verse():
    """Verse quoted with no commentary → zero commentary blocks detected."""
    print("=" * 60)
    print("Testing No False Positives: Clean verse quoting")
    print("=" * 60)

    verse_text = (
        "For God so loved the world, that he gave his only begotten Son, "
        "that whosoever believeth in him should not perish, but have everlasting life."
    )

    # Clean quoting — minor transcription variations but no commentary
    transcript = (
        "For God so loved the world that he gave his only begotten Son "
        "that whosoever believes in him should not perish but have everlasting life."
    )

    blocks = detect_commentary_blocks(transcript, 0, len(transcript), verse_text)
    status = "✓" if len(blocks) == 0 else "✗"
    print(f"  {status} Commentary blocks: {len(blocks)} (expected 0)")
    assert len(blocks) == 0, f"Expected 0 commentary blocks for clean verse, got {len(blocks)}"
    print()


def test_trailing_punctuation_in_end_pos():
    """Integration test: find_verse_end_in_transcript includes trailing period for full verse."""
    print("=" * 60)
    print("Testing Trailing Punctuation in End Position (Bug 4)")
    print("=" * 60)

    verse_text = (
        "But I certify you, brethren, that the gospel which was preached of me "
        "is not after man. For I neither received it of man, neither was I taught it, "
        "but by the revelation of Jesus Christ."
    )

    transcript = (
        "But I certify, you brethren, that the gospel which was preached of me "
        "is not after man, for I neither received it of man, nor was I taught it, "
        "but by the revelation of Jesus Christ."
    )

    end_pos = find_verse_end_in_transcript(transcript, 0, verse_text)
    assert end_pos is not None, "Should find verse end"

    extracted = transcript[:end_pos]
    status = "✓" if extracted.endswith('.') else "✗"
    print(f"  {status} Extracted text ends with: '{extracted[-20:]}'")
    assert extracted.endswith('.'), f"Expected trailing period, got: '{extracted[-5:]}'"
    print()


if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("Bible Passage Boundary Detection Tests")
    print("=" * 60 + "\n")
    
    # Run unit tests (no API calls)
    test_intro_phrase_detection()
    test_bidirectional_search()
    
    # Run integration test with test transcript
    test_with_test_transcript()

    # New unit tests for interjection/commentary detection fixes
    print("\n" + "=" * 60)
    print("Interjection/Commentary Detection Fix Tests")
    print("=" * 60 + "\n")

    test_sequential_alignment_exact_verse()
    test_sequential_alignment_paraphrase()
    test_sequential_alignment_mixed()
    test_verse_resumption_with_punctuation()
    test_verse_resumption_no_match()
    test_trailing_punctuation_period()
    test_trailing_punctuation_colon()
    test_trailing_punctuation_none()
    test_no_false_positives_on_clean_verse()
    test_trailing_punctuation_in_end_pos()
    test_galatians_commentary_detection()
    
    # Optionally run full pipeline (makes API calls)
    if len(sys.argv) > 1 and sys.argv[1] == '--full':
        test_full_pipeline()
    else:
        print("Tip: Run with --full to test the complete processing pipeline (requires API)")
    
    print("\n" + "=" * 60)
    print("Tests Complete")
    print("=" * 60)
