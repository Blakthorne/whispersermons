#!/usr/bin/env python3
"""
End-to-end test simulating the full pipeline with semantic paragraph breaks.

This test reproduces the original bug where passage boundaries were correct
when calculated from raw text, but became incorrect after paragraph breaks
were added by segment_paragraphs().
"""

import sys
import json

# The scenario: 
# 1. Whisper produces raw transcript (no paragraph breaks)
# 2. Bible quote processor finds passage boundaries in raw text
# 3. segment_paragraphs() adds paragraph breaks (changes character positions)
# 4. AST builder should use REMAPPED boundaries to extract correct content

def test_full_pipeline():
    """Simulate the full whisper_bridge pipeline."""
    print("="*70)
    print("END-TO-END PASSAGE BOUNDARY TEST")
    print("="*70)
    print()
    
    # Step 1: Raw transcript (as Whisper would produce it)
    raw_transcript = (
        "You have much to give that metaphorically will put a smile on his face. "
        "Romans 12 one says Paul writes I beseech you therefore brethren by the "
        "mercies of God that you present your bodies a living sacrifice wholly "
        "acceptable unto God which is your reasonable service. What is Paul saying "
        "here? He's telling us to offer ourselves completely to God."
    )
    
    print(f"Step 1: Raw transcript length = {len(raw_transcript)} chars")
    print()
    
    # Step 2: Bible quote processor detects quote boundaries in RAW text
    # The verse starts at "I beseech" and ends at "service."
    import re
    start_match = re.search(r'I beseech', raw_transcript)
    end_match = re.search(r'reasonable service\.', raw_transcript)
    
    if not start_match or not end_match:
        print("ERROR: Could not find verse in raw transcript")
        return False
    
    raw_start = start_match.start()
    raw_end = end_match.end()
    
    from bible_quote_processor import QuoteBoundary, BibleReference
    
    ref = BibleReference(
        book='Romans', 
        chapter=12, 
        verse_start=1, 
        original_text='Romans 12 one', 
        position=70
    )
    
    quote = QuoteBoundary(
        start_pos=raw_start,
        end_pos=raw_end,
        reference=ref,
        verse_text="I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service.",
        confidence=0.97
    )
    
    print(f"Step 2: Quote boundary in RAW text = [{quote.start_pos}, {quote.end_pos}]")
    print(f"  Content: '{raw_transcript[quote.start_pos:quote.end_pos]}'")
    print()
    
    # Step 3: Paragraph segmentation adds breaks
    # Simulating what segment_paragraphs would do:
    # It adds \n\n between semantic units (typically after sentence-ending periods)
    paragraphed_transcript = (
        "You have much to give that metaphorically will put a smile on his face.\n\n"
        "Romans 12 one says Paul writes I beseech you therefore brethren by the "
        "mercies of God that you present your bodies a living sacrifice wholly "
        "acceptable unto God which is your reasonable service.\n\n"
        "What is Paul saying here?\n\n"
        "He's telling us to offer ourselves completely to God."
    )
    
    print(f"Step 3: Paragraphed transcript length = {len(paragraphed_transcript)} chars")
    print(f"  (Added {len(paragraphed_transcript) - len(raw_transcript)} chars for paragraph breaks)")
    print()
    
    # Step 4: Remap quote boundaries
    from whisper_bridge import remap_quote_boundaries_for_paragraphed_text
    
    remapped = remap_quote_boundaries_for_paragraphed_text(
        raw_transcript,
        paragraphed_transcript,
        [quote]
    )
    
    new_quote = remapped[0]
    
    print(f"Step 4: Remapped quote boundary = [{new_quote.start_pos}, {new_quote.end_pos}]")
    extracted = paragraphed_transcript[new_quote.start_pos:new_quote.end_pos]
    print(f"  Extracted content: '{extracted}'")
    print()
    
    # Verification
    print("="*70)
    print("VERIFICATION")
    print("="*70)
    
    expected_content = (
        "I beseech you therefore brethren by the mercies of God that you present "
        "your bodies a living sacrifice wholly acceptable unto God which is your "
        "reasonable service."
    )
    
    # Check 1: Does extracted text start with "I beseech"?
    if extracted.startswith("I beseech"):
        print("✅ PASS: Extracted text starts with 'I beseech'")
        start_ok = True
    else:
        print(f"❌ FAIL: Extracted text does NOT start with 'I beseech'")
        print(f"         Starts with: '{extracted[:30]}...'")
        start_ok = False
    
    # Check 2: Does extracted text end with "reasonable service."?
    if extracted.rstrip().endswith("reasonable service."):
        print("✅ PASS: Extracted text ends with 'reasonable service.'")
        end_ok = True
    else:
        print(f"❌ FAIL: Extracted text does NOT end with 'reasonable service.'")
        print(f"         Ends with: '...{extracted[-40:]}'")
        end_ok = False
    
    # Check 3: Does extracted text contain "his face"? (It should NOT)
    if "his face" in extracted:
        print("❌ FAIL: Extracted text INCORRECTLY includes 'his face'")
        no_preceding = False
    else:
        print("✅ PASS: Extracted text does NOT include preceding text 'his face'")
        no_preceding = True
    
    # Check 4: Does extracted text contain "What is Paul"? (It should NOT)
    if "What is Paul" in extracted:
        print("❌ FAIL: Extracted text INCORRECTLY includes 'What is Paul'")
        no_following = False
    else:
        print("✅ PASS: Extracted text does NOT include following text 'What is Paul'")
        no_following = True
    
    print()
    
    all_passed = start_ok and end_ok and no_preceding and no_following
    if all_passed:
        print("🎉 ALL CHECKS PASSED! The boundary remapping fix is working correctly.")
    else:
        print("💥 SOME CHECKS FAILED. The fix needs more work.")
    
    return all_passed


if __name__ == "__main__":
    success = test_full_pipeline()
    sys.exit(0 if success else 1)
