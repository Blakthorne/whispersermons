#!/usr/bin/env python3
"""
Test script for verifying the quote boundary remapping fix.

This tests that QuoteBoundary positions are correctly remapped after
paragraph segmentation inserts '\n\n' breaks.
"""

import sys
import re
from whisper_bridge import remap_quote_boundaries_for_paragraphed_text
from bible_quote_processor import QuoteBoundary, BibleReference

def test_remap_simple():
    """Test basic remapping with one paragraph break."""
    print("Test 1: Simple remapping with one paragraph break")
    print("="*60)
    
    # Original text: "Hello world. This is a test."
    # Paragraphed text: "Hello world.\n\nThis is a test."
    original = "Hello world. This is a test."
    paragraphed = "Hello world.\n\nThis is a test."
    
    # Quote at position 13-28 in original ("This is a test")
    ref = BibleReference(book='Test', chapter=1, verse_start=1, original_text='Test 1:1', position=0)
    quote = QuoteBoundary(
        start_pos=13,  # "This" in original
        end_pos=28,    # End of "test."
        reference=ref,
        verse_text="This is a test.",
        confidence=0.9
    )
    
    print(f"Original text: '{original}'")
    print(f"Paragraphed text: '{paragraphed}'")
    print(f"Original quote position: [{quote.start_pos}, {quote.end_pos}]")
    print(f"Text at original position: '{original[quote.start_pos:quote.end_pos]}'")
    
    # Remap
    remapped = remap_quote_boundaries_for_paragraphed_text(original, paragraphed, [quote])
    new_quote = remapped[0]
    
    print(f"\nRemapped quote position: [{new_quote.start_pos}, {new_quote.end_pos}]")
    print(f"Text at remapped position: '{paragraphed[new_quote.start_pos:new_quote.end_pos]}'")
    
    # The remapped position should correctly point to "This is a test." in paragraphed text
    expected_start = 14  # After "Hello world.\n\n" (12 + 2 = 14, but space is replaced so 13 + 1)
    extracted = paragraphed[new_quote.start_pos:new_quote.end_pos]
    print(f"\nExpected text: 'This is a test.'")
    print(f"Got text: '{extracted}'")
    
    if "This is a test" in extracted:
        print("✅ PASS: Remapping correctly extracts quote content")
    else:
        print("❌ FAIL: Remapping did not correctly extract quote content")
    print()


def test_remap_realistic():
    """Test remapping with realistic sermon text."""
    print("\nTest 2: Realistic sermon text with Romans 12:1")
    print("="*60)
    
    # Simulate the real issue from the user's report
    original = """You have much to give that metaphorically will put a smile on his face. Romans 12 one says Paul writes I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice wholly acceptable unto God which is your reasonable service. What is Paul saying."""
    
    # After paragraph segmentation (spaces between sentences become \n\n)
    paragraphed = """You have much to give that metaphorically will put a smile on his face.

Romans 12 one says Paul writes I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice wholly acceptable unto God which is your reasonable service.

What is Paul saying."""
    
    # Find position of "I beseech" in original
    verse_text = "I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice wholly acceptable unto God which is your reasonable service."
    
    import re
    # Find "I beseech" in original
    match = re.search(r'I beseech', original)
    if match:
        verse_start = match.start()
        # Find end of verse (period after "service")
        end_match = re.search(r'reasonable service\.', original)
        if end_match:
            verse_end = end_match.end()
            
            print(f"Original text length: {len(original)}")
            print(f"Paragraphed text length: {len(paragraphed)}")
            print(f"Verse position in original: [{verse_start}, {verse_end}]")
            print(f"Text at original position: '{original[verse_start:verse_end]}'")
            
            # Create quote boundary
            ref = BibleReference(book='Romans', chapter=12, verse_start=1, original_text='Romans 12:1', position=0)
            quote = QuoteBoundary(
                start_pos=verse_start,
                end_pos=verse_end,
                reference=ref,
                verse_text=verse_text,
                confidence=0.97
            )
            
            # Remap
            remapped = remap_quote_boundaries_for_paragraphed_text(original, paragraphed, [quote])
            new_quote = remapped[0]
            
            print(f"\nRemapped quote position: [{new_quote.start_pos}, {new_quote.end_pos}]")
            
            # Check bounds
            if new_quote.start_pos < 0 or new_quote.end_pos > len(paragraphed):
                print(f"❌ FAIL: Position out of bounds!")
            else:
                extracted = paragraphed[new_quote.start_pos:new_quote.end_pos]
                print(f"Text at remapped position: '{extracted}'")
                
                # Verify the extracted text matches expected verse content
                if "I beseech" in extracted and "reasonable service" in extracted:
                    print("\n✅ PASS: Remapping correctly extracts verse content")
                    
                    # Additional check: make sure "his face" is NOT in the extracted text
                    if "his face" in extracted:
                        print("❌ FAIL: Extracted text incorrectly includes 'his face'")
                    else:
                        print("✅ PASS: Extracted text does NOT include preceding text 'his face'")
                else:
                    print("\n❌ FAIL: Remapping did not correctly extract verse content")
    print()


def test_remap_multiple_breaks():
    """Test remapping with multiple paragraph breaks."""
    print("\nTest 3: Multiple paragraph breaks")
    print("="*60)
    
    original = "First sentence. Second sentence. Third sentence. Fourth sentence."
    paragraphed = "First sentence.\n\nSecond sentence.\n\nThird sentence.\n\nFourth sentence."
    
    # Quote at "Third sentence."
    match = re.search(r'Third sentence\.', original)
    if match:
        ref = BibleReference(book='Test', chapter=1, verse_start=1, original_text='Test 1:1', position=0)
        quote = QuoteBoundary(
            start_pos=match.start(),
            end_pos=match.end(),
            reference=ref,
            verse_text="Third sentence.",
            confidence=0.9
        )
        
        print(f"Quote in original: [{quote.start_pos}, {quote.end_pos}] = '{original[quote.start_pos:quote.end_pos]}'")
        
        remapped = remap_quote_boundaries_for_paragraphed_text(original, paragraphed, [quote])
        new_quote = remapped[0]
        
        extracted = paragraphed[new_quote.start_pos:new_quote.end_pos]
        print(f"Quote in paragraphed: [{new_quote.start_pos}, {new_quote.end_pos}] = '{extracted}'")
        
        if extracted == "Third sentence.":
            print("✅ PASS: Multiple breaks handled correctly")
        else:
            print(f"❌ FAIL: Expected 'Third sentence.', got '{extracted}'")
    print()


if __name__ == "__main__":
    test_remap_simple()
    test_remap_realistic()
    test_remap_multiple_breaks()
    
    print("\n" + "="*60)
    print("All tests complete!")
