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
    process_text
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


if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("Bible Passage Boundary Detection Tests")
    print("=" * 60 + "\n")
    
    # Run unit tests (no API calls)
    test_intro_phrase_detection()
    test_bidirectional_search()
    
    # Run integration test with test transcript
    test_with_test_transcript()
    
    # Optionally run full pipeline (makes API calls)
    if len(sys.argv) > 1 and sys.argv[1] == '--full':
        test_full_pipeline()
    else:
        print("Tip: Run with --full to test the complete processing pipeline (requires API)")
    
    print("\n" + "=" * 60)
    print("Tests Complete")
    print("=" * 60)
