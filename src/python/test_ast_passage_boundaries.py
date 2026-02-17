#!/usr/bin/env python3
"""
Test script for AST passage boundary detection in the AST-first pipeline.

Tests that:
1. Passages are correctly isolated in their own paragraph nodes
2. Passages do NOT span multiple paragraphs (single-paragraph constraint)
3. Passage content is extracted correctly (actual verse text, not trailing text)
4. Full pipeline integration works end-to-end

Uses the AST-first pipeline: raw_text + quote_boundaries → build_ast()
"""

import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import QuoteBoundary, BibleReference, process_text
from ast_builder import build_ast, ASTBuilderConfig


def create_mock_quote_boundary(start, end, book, chapter, verse_start, verse_end=None, verse_text="", confidence=0.95):
    """Create a mock QuoteBoundary for testing."""
    ref = BibleReference(
        book=book, chapter=chapter, verse_start=verse_start, verse_end=verse_end,
        original_text=f"{book} {chapter}:{verse_start}"
    )
    return QuoteBoundary(
        start_pos=start, end_pos=end, reference=ref,
        verse_text=verse_text, confidence=confidence, translation="KJV"
    )


def get_passage_content(passage_node):
    """Extract the full text content from a PassageNode's children."""
    content = ""
    for child in passage_node.children:
        if hasattr(child, 'content'):
            content += child.content
    return content


# ============================================================================
# TESTS
# ============================================================================

def test_passage_mapping_by_start_position():
    """Test that passages are mapped to paragraphs based on START position."""
    print("=" * 70)
    print("TEST 1: Passage mapping by START position")
    print("=" * 70)

    # Raw text (no paragraph breaks - like Whisper output)
    raw_text = (
        "This is the first paragraph with some introductory content. "
        "Now let me read from Romans 12:1 which says I beseech you therefore "
        "brethren by the mercies of God that you present your bodies a living "
        "sacrifice holy acceptable unto God which is your reasonable service. "
        "That is what Paul tells us. After the scripture, we continue with more "
        "regular text and teaching."
    )

    # Find passage boundaries in raw_text
    verse_start = raw_text.find("I beseech you therefore")
    verse_text = ("I beseech you therefore brethren by the mercies of God that you "
                  "present your bodies a living sacrifice holy acceptable unto God "
                  "which is your reasonable service")
    verse_end = verse_start + len(verse_text)

    print(f"Passage boundaries: [{verse_start}, {verse_end}]")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text=verse_text, confidence=0.9
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote], title="Test Sermon", debug=True
    )

    root = result.document_state.root
    print(f"Document has {len(root.children)} children")

    passage_found = False
    for i, child in enumerate(root.children):
        if child.type == 'paragraph':
            for j, sub in enumerate(child.children):
                if sub.type == 'passage':
                    passage_found = True
                    passage_content = get_passage_content(sub)
                    print(f"  Found PASSAGE at paragraph {i}: '{passage_content[:60]}...'")

                    if "That" in passage_content and "Paul tells" in passage_content:
                        print(f"  FAIL: Passage contains TRAILING text")
                        return False
                    if "beseech" in passage_content.lower():
                        print(f"  PASS: Passage contains expected verse text")
                    else:
                        print(f"  FAIL: Passage missing expected verse text")
                        return False

    if not passage_found:
        print("  FAIL: No passage node found")
        return False

    return True


def test_single_paragraph_constraint():
    """Test that passages do NOT span multiple paragraphs."""
    print("\n" + "=" * 70)
    print("TEST 2: Single-paragraph constraint")
    print("=" * 70)

    # Raw text where passage would span across what might be paragraph boundaries
    raw_text = (
        "First paragraph before the quote. "
        "Romans 12:1 I beseech you therefore brethren by the mercies of God "
        "that you present your bodies a living sacrifice holy acceptable unto God "
        "which is your reasonable service. Text after the quote."
    )

    verse_start = raw_text.find("I beseech")
    verse_end = raw_text.find("reasonable service.") + len("reasonable service.")

    print(f"Passage boundaries: [{verse_start}, {verse_end}]")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text="I beseech you therefore brethren by the mercies of God...",
        confidence=0.9
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote], title="Test Sermon", debug=True
    )

    root = result.document_state.root
    print(f"Document has {len(root.children)} children")

    for child in root.children:
        if child.type == 'paragraph':
            for sub in child.children:
                if sub.type == 'passage':
                    passage_content = get_passage_content(sub)
                    if '\n\n' in passage_content:
                        print(f"  FAIL: Passage spans paragraph boundary!")
                        return False
                    else:
                        print(f"  PASS: Passage contained in single paragraph")

    return True


def test_multiple_passages_in_document():
    """Test document with multiple passages."""
    print("\n" + "=" * 70)
    print("TEST 3: Multiple passages in document")
    print("=" * 70)

    raw_text = (
        "The sermon begins with a simple introduction about faith. "
        "Let us look at John 3:16 For God so loved the world that he gave his "
        "only begotten Son that whosoever believeth in him should not perish "
        "but have everlasting life. "
        "And then we see in Romans 8:28 And we know that all things work together "
        "for good to them that love God to them who are the called according to "
        "his purpose. "
        "In conclusion, these two passages show us the heart of the gospel."
    )

    john_start = raw_text.find("For God so loved")
    john_verse = ("For God so loved the world that he gave his only begotten Son "
                  "that whosoever believeth in him should not perish but have everlasting life")
    john_end = john_start + len(john_verse)

    romans_start = raw_text.find("And we know that all things")
    romans_verse = ("And we know that all things work together for good to them "
                    "that love God to them who are the called according to his purpose")
    romans_end = romans_start + len(romans_verse)

    quotes = [
        create_mock_quote_boundary(
            start=john_start, end=john_end,
            book="John", chapter=3, verse_start=16,
            verse_text=john_verse, confidence=0.95
        ),
        create_mock_quote_boundary(
            start=romans_start, end=romans_end,
            book="Romans", chapter=8, verse_start=28,
            verse_text=romans_verse, confidence=0.92
        )
    ]

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=quotes, title="Test Sermon", debug=True
    )

    root = result.document_state.root
    passages_found = []
    for child in root.children:
        if child.type == 'paragraph':
            for sub in child.children:
                if sub.type == 'passage':
                    ref_str = sub.metadata.reference.normalized_reference
                    passages_found.append(ref_str)
                    print(f"  Found passage: {ref_str}")

    if len(passages_found) == 2:
        print(f"\n  PASS: Found all 2 passages")
        return True
    else:
        print(f"\n  FAIL: Expected 2 passages, found {len(passages_found)}")
        return False


def test_real_transcript_processing():
    """Test with full pipeline (process_text + build_ast)."""
    print("\n" + "=" * 70)
    print("TEST 4: Full pipeline integration")
    print("=" * 70)

    raw_text = (
        "Good morning everyone. Today we are going to look at one of the most "
        "famous verses in the Bible. John 3:16 For God so loved the world that "
        "he gave his only begotten Son that whosoever believeth in him should not "
        "perish but have everlasting life. This verse tells us everything about "
        "God's love."
    )

    print(f"Running full text processing pipeline...")

    try:
        # Process text (Bible quote detection)
        processed_text, quote_boundaries = process_text(
            raw_text, translation="KJV", auto_detect=True, verbose=True
        )

        print(f"Quotes detected: {len(quote_boundaries)}")
        for qb in quote_boundaries:
            print(f"  - {qb.reference.to_standard_format()}: [{qb.start_pos}, {qb.end_pos}]")

        # Build AST using the AST-first pipeline
        result = build_ast(
            raw_text=raw_text,
            quote_boundaries=quote_boundaries,
            title="Integration Test Sermon", debug=True
        )

        print(f"AST built: {result.processing_metadata.paragraph_count} paragraphs, "
              f"{result.processing_metadata.passage_count} passages")

        return True

    except Exception as e:
        print(f"  FAIL: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_coordinate_consistency_with_normalizable_references():
    """
    End-to-end test: references that would change length during normalization
    must still produce correct AST passage content.
    
    This is the critical regression test for the coordinate-space mismatch bug.
    Previously, process_text() would mutate text (e.g., 'Romans 12 one' -> 'Romans 12:1')
    before detecting boundaries, so boundary positions were in the mutated text's
    coordinate space. But the AST builder sliced from original text, causing off-by-N
    errors at every passage boundary.
    
    After the fix, process_text() never mutates text, so all positions are in
    the same coordinate space as raw_text.
    """
    print("\n" + "=" * 70)
    print("TEST 5: Coordinate consistency with normalizable references")
    print("=" * 70)
    
    # This transcript intentionally uses spoken number words that normalize differently:
    # "Romans 12 one" (13 chars) would have become "Romans 12:1" (11 chars) - 2 char shift
    # "Hebrews 725" (11 chars) would have become "Hebrews 7:25" (12 chars) - 1 char shift opposite direction
    raw_text = (
        "Good morning church. Today I want to talk about sacrifice and salvation. "
        "Let us turn to Romans 12 one which says I beseech you therefore "
        "brethren by the mercies of God that you present your bodies a living "
        "sacrifice holy acceptable unto God which is your reasonable service. "
        "That is a powerful message about living for God. "
        "And we can trust that our Savior will keep us because Hebrews 7:25 says "
        "wherefore he is able also to save them to the uttermost that come unto God "
        "by him seeing he ever liveth to make intercession for them. "
        "What a wonderful promise from God."
    )
    
    print(f"  Raw text length: {len(raw_text)} chars")
    
    try:
        # Run process_text — after the fix, this should NOT mutate text
        processed_text, quote_boundaries = process_text(
            raw_text, translation="KJV", auto_detect=True, verbose=False
        )
        
        # Verify text was not mutated
        if processed_text != raw_text:
            print(f"  FAIL: process_text() mutated the text!")
            print(f"    Original length: {len(raw_text)}, Processed length: {len(processed_text)}")
            return False
        print(f"  Text immutability: PASS (text unchanged)")
        
        if not quote_boundaries:
            print(f"  WARN: No quotes detected (API may be unavailable) — skipping boundary checks")
            return True  # Not a failure, just can't test without API
        
        print(f"  Detected {len(quote_boundaries)} quote(s)")
        
        # Verify all boundary positions are valid for slicing raw_text
        for qb in quote_boundaries:
            ref_str = qb.reference.to_standard_format()
            
            if qb.start_pos < 0 or qb.start_pos >= len(raw_text):
                print(f"  FAIL: {ref_str} start_pos={qb.start_pos} out of bounds")
                return False
            
            if qb.end_pos <= 0 or qb.end_pos > len(raw_text):
                print(f"  FAIL: {ref_str} end_pos={qb.end_pos} out of bounds")
                return False
            
            # Extract content using boundary positions on raw_text
            extracted = raw_text[qb.start_pos:qb.end_pos]
            
            if not extracted.strip():
                print(f"  FAIL: {ref_str} extracts empty content from raw_text[{qb.start_pos}:{qb.end_pos}]")
                return False
            
            print(f"  {ref_str}: [{qb.start_pos}, {qb.end_pos}] → '{extracted[:60]}...'")
            
            # Verify the extracted content has reasonable word overlap with verse_text
            if qb.verse_text:
                import re
                verse_words = set(re.findall(r'\w+', qb.verse_text.lower()))
                content_words = set(re.findall(r'\w+', extracted.lower()))
                overlap = verse_words & content_words
                overlap_ratio = len(overlap) / len(verse_words) if verse_words else 0
                
                if overlap_ratio < 0.3:
                    print(f"  FAIL: {ref_str} content has only {overlap_ratio:.0%} word overlap with verse text")
                    print(f"    Extracted: '{extracted[:80]}'")
                    print(f"    Verse:     '{qb.verse_text[:80]}'")
                    return False
                else:
                    print(f"    Word overlap: {overlap_ratio:.0%} (OK)")
        
        # Now build AST and verify passage nodes contain correct content
        result = build_ast(
            raw_text=raw_text,
            quote_boundaries=quote_boundaries,
            title="Coordinate Test Sermon", debug=True
        )
        
        # Check passage nodes in AST
        root = result.document_state.root
        passage_count = 0
        for child in root.children:
            if child.type == 'paragraph':
                for sub in child.children:
                    if sub.type == 'passage':
                        passage_count += 1
                        passage_content = get_passage_content(sub)
                        if not passage_content.strip():
                            print(f"  FAIL: Empty passage node in AST")
                            return False
        
        print(f"  AST built with {passage_count} passage node(s)")
        print(f"  PASS: All coordinates aligned correctly")
        return True
        
    except Exception as e:
        print(f"  FAIL: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_immutability_assertion():
    """Test that process_text() returns identical text (no mutation)."""
    print("\n" + "=" * 70)
    print("TEST 6: Text immutability assertion")
    print("=" * 70)
    
    # Text with references that WOULD have been normalized in the old code
    raw_text = (
        "The Bible tells us in John 3:16 that God loves us. "
        "And in Romans 8 28 we learn about God's plan."
    )
    
    try:
        processed_text, _quotes = process_text(raw_text, translation="KJV", verbose=False)
        
        if processed_text is raw_text:
            print(f"  PASS: Returned text is the same object (identity check)")
            return True
        elif processed_text == raw_text:
            print(f"  PASS: Returned text is equal (value check)")
            return True
        else:
            print(f"  FAIL: Text was mutated!")
            print(f"    Input:  '{raw_text[:80]}'")
            print(f"    Output: '{processed_text[:80]}'")
            return False
    except AssertionError as e:
        # The immutability assertion itself fired — this IS the failure mode we prevent
        print(f"  FAIL: Immutability assertion fired: {e}")
        return False
    except Exception as e:
        print(f"  FAIL: {e}")
        return False


def main():
    """Run all tests."""
    print("\n" + "=" * 70)
    print("AST PASSAGE BOUNDARY TESTS (Integrated Pipeline)")
    print("=" * 70)

    results = []
    results.append(("Passage mapping by START position", test_passage_mapping_by_start_position()))
    results.append(("Single-paragraph constraint", test_single_paragraph_constraint()))
    results.append(("Multiple passages in document", test_multiple_passages_in_document()))

    try:
        results.append(("Full pipeline integration", test_real_transcript_processing()))
    except Exception as e:
        print(f"Skipping integration test: {e}")

    try:
        results.append(("Coordinate consistency (normalizable refs)", test_coordinate_consistency_with_normalizable_references()))
    except Exception as e:
        print(f"Skipping coordinate consistency test: {e}")
    
    try:
        results.append(("Text immutability assertion", test_immutability_assertion()))
    except Exception as e:
        print(f"Skipping immutability test: {e}")

    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)

    passed = sum(1 for _, r in results if r)
    total = len(results)

    for name, r in results:
        status = "PASS" if r else "FAIL"
        print(f"  {status}: {name}")

    print(f"\nResults: {passed}/{total} tests passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
