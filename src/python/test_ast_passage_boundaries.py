#!/usr/bin/env python3
"""
Test script for AST passage boundary detection fixes.

This script tests the AST builder's handling of passage boundaries to ensure:
1. Passages are correctly mapped to paragraphs based on START position
2. Passages do NOT span multiple paragraphs (single-paragraph constraint)
3. Passage content is extracted correctly (actual verse text, not trailing text)

Run with: python test_ast_passage_boundaries.py
"""

import sys
import json
from pathlib import Path
from dataclasses import dataclass
from typing import List, Tuple, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import (
    QuoteBoundary,
    BibleReference,
    process_text
)
from ast_builder import (
    ASTBuilder,
    build_ast,
    ASTBuilderConfig
)


# ============================================================================
# TEST DATA
# ============================================================================

TEST_TRANSCRIPT_1 = """This is the first paragraph with some introductory content.

Now let me read from Romans 12:1 which says I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service. That's what Paul tells us.

After the scripture, we continue with more regular text and teaching."""


TEST_TRANSCRIPT_2 = """The sermon begins with a simple introduction about faith.

Let's look at John 3:16 For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life.

And then we see in Romans 8:28 And we know that all things work together for good to them that love God to them who are the called according to his purpose.

In conclusion, these two passages show us the heart of the gospel."""


TEST_TRANSCRIPT_EDGE_CASE = """This is a short paragraph.

John 3:16 For God so loved the world.

More text after."""


def create_mock_quote_boundary(
    start: int, 
    end: int, 
    book: str, 
    chapter: int, 
    verse_start: int, 
    verse_end: Optional[int] = None,
    verse_text: str = "",
    confidence: float = 0.95
) -> QuoteBoundary:
    """Create a mock QuoteBoundary for testing."""
    ref = BibleReference(
        book=book,
        chapter=chapter,
        verse_start=verse_start,
        verse_end=verse_end,
        original_text=f"{book} {chapter}:{verse_start}"
    )
    return QuoteBoundary(
        start_pos=start,
        end_pos=end,
        reference=ref,
        verse_text=verse_text,
        confidence=confidence,
        translation="KJV"
    )


# ============================================================================
# TESTS
# ============================================================================

def get_passage_content(passage_node) -> str:
    """Extract the full text content from a PassageNode's children."""
    content = ""
    for child in passage_node.children:
        if hasattr(child, 'content'):
            content += child.content
    return content


def test_passage_mapping_by_start_position():
    """Test that passages are mapped to paragraphs based on START position."""
    print("=" * 70)
    print("TEST 1: Passage mapping by START position")
    print("=" * 70)
    
    transcript = TEST_TRANSCRIPT_1
    print(f"Transcript length: {len(transcript)} chars")
    
    # Find where the actual Bible verse text starts
    verse_start = transcript.find("I beseech you therefore")
    verse_text = "I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service"
    verse_end = verse_start + len(verse_text)
    
    print(f"\nPassage boundaries: [{verse_start}, {verse_end}]")
    print(f"Expected passage content: '{verse_text[:60]}...'")
    
    # Create quote boundary
    quote = create_mock_quote_boundary(
        start=verse_start,
        end=verse_end,
        book="Romans",
        chapter=12,
        verse_start=1,
        verse_text=verse_text,
        confidence=0.9
    )
    
    # Build AST with debug enabled
    result = build_ast(
        paragraphed_text=transcript,
        quote_boundaries=[quote],
        title="Test Sermon",
        debug=True
    )
    
    # Check the result
    doc_state = result.document_state
    root = doc_state.root
    
    print(f"\n--- RESULT ---")
    print(f"Document has {len(root.children)} children")
    
    passage_found = False
    for i, child in enumerate(root.children):
        print(f"\nChild {i}: type={child.type}")
        if child.type == 'paragraph':
            # Check children for passage nodes
            for j, sub in enumerate(child.children):
                if sub.type == 'passage':
                    passage_found = True
                    passage_content = get_passage_content(sub)
                    ref_str = sub.metadata.reference.normalized_reference
                    print(f"  Found PASSAGE node at paragraph {i}, child {j}")
                    print(f"  Reference: {ref_str}")
                    print(f"  Content (first 80 chars): '{passage_content[:80]}...'")
                    
                    # CRITICAL CHECK: Content should be verse text, NOT trailing text
                    if "That's what Paul" in passage_content:
                        print(f"  ❌ FAIL: Passage contains TRAILING text (after quote)")
                        return False
                    if "beseech" in passage_content.lower():
                        print(f"  ✓ PASS: Passage contains expected verse text")
                    else:
                        print(f"  ❌ FAIL: Passage missing expected verse text")
                        return False
                elif sub.type == 'text':
                    preview = sub.content[:50].replace('\n', ' ') if hasattr(sub, 'content') else str(sub)[:50]
                    print(f"  Text node: '{preview}...'")
    
    if not passage_found:
        print("  ❌ FAIL: No passage node found in AST")
        return False
    
    return True


def test_single_paragraph_constraint():
    """Test that passages do NOT span multiple paragraphs."""
    print("\n" + "=" * 70)
    print("TEST 2: Single-paragraph constraint")
    print("=" * 70)
    
    # Create a transcript where a passage would naturally span paragraphs
    transcript = """First paragraph before the quote.

Romans 12:1 I beseech you therefore brethren by the mercies of God

that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service.

Text after the quote."""
    
    # The passage "spans" from the verse start across paragraphs
    verse_start = transcript.find("I beseech")
    verse_end = transcript.find("reasonable service.") + len("reasonable service.")
    
    print(f"\nPassage boundaries: [{verse_start}, {verse_end}]")
    print(f"This passage would span across paragraph boundaries!")
    
    # Create quote boundary that spans paragraphs
    quote = create_mock_quote_boundary(
        start=verse_start,
        end=verse_end,
        book="Romans",
        chapter=12,
        verse_start=1,
        verse_text="I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service",
        confidence=0.9
    )
    
    # Build AST with debug enabled
    result = build_ast(
        paragraphed_text=transcript,
        quote_boundaries=[quote],
        title="Test Sermon",
        debug=True
    )
    
    # Check that the passage is contained within a single paragraph
    doc_state = result.document_state
    root = doc_state.root
    
    print(f"\n--- RESULT ---")
    print(f"Document has {len(root.children)} children")
    
    for i, child in enumerate(root.children):
        print(f"\nChild {i}: type={child.type}")
        if child.type == 'paragraph':
            for j, sub in enumerate(child.children):
                if sub.type == 'passage':
                    passage_content = get_passage_content(sub)
                    print(f"  Found PASSAGE in paragraph {i}")
                    print(f"  Content: '{passage_content}'")
                    # Passage should not contain paragraph break
                    if '\n\n' in passage_content:
                        print(f"  ❌ FAIL: Passage spans paragraph boundary!")
                        return False
                    else:
                        print(f"  ✓ PASS: Passage contained in single paragraph")
    
    return True


def test_multiple_passages_in_document():
    """Test document with multiple passages."""
    print("\n" + "=" * 70)
    print("TEST 3: Multiple passages in document")
    print("=" * 70)
    
    transcript = TEST_TRANSCRIPT_2
    print(f"Transcript length: {len(transcript)} chars")
    
    # Find passage boundaries
    john_start = transcript.find("For God so loved")
    john_verse = "For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life"
    john_end = john_start + len(john_verse)
    
    romans_start = transcript.find("And we know that all things")
    romans_verse = "And we know that all things work together for good to them that love God to them who are the called according to his purpose"
    romans_end = romans_start + len(romans_verse)
    
    print(f"\nJohn 3:16 boundaries: [{john_start}, {john_end}]")
    print(f"Romans 8:28 boundaries: [{romans_start}, {romans_end}]")
    
    quotes = [
        create_mock_quote_boundary(
            start=john_start,
            end=john_end,
            book="John",
            chapter=3,
            verse_start=16,
            verse_text=john_verse,
            confidence=0.95
        ),
        create_mock_quote_boundary(
            start=romans_start,
            end=romans_end,
            book="Romans",
            chapter=8,
            verse_start=28,
            verse_text=romans_verse,
            confidence=0.92
        )
    ]
    
    # Build AST with debug enabled
    result = build_ast(
        paragraphed_text=transcript,
        quote_boundaries=quotes,
        title="Test Sermon",
        debug=True
    )
    
    # Check the result
    doc_state = result.document_state
    root = doc_state.root
    
    print(f"\n--- RESULT ---")
    print(f"Document has {len(root.children)} children")
    
    passages_found = []
    for i, child in enumerate(root.children):
        if child.type == 'paragraph':
            for sub in child.children:
                if sub.type == 'passage':
                    ref_str = sub.metadata.reference.normalized_reference
                    passage_content = get_passage_content(sub)
                    passages_found.append(ref_str)
                    print(f"  Found passage: {ref_str}")
                    print(f"  Content preview: '{passage_content[:60]}...'")
    
    if len(passages_found) == 2:
        print(f"\n  ✓ PASS: Found all 2 passages")
        return True
    else:
        print(f"\n  ❌ FAIL: Expected 2 passages, found {len(passages_found)}")
        return False


def test_real_transcript_processing():
    """Test with full pipeline (process_text + build_ast)."""
    print("\n" + "=" * 70)
    print("TEST 4: Full pipeline integration")
    print("=" * 70)
    
    transcript = """Good morning everyone. Today we're going to look at one of the most famous verses in the Bible.

John 3:16 For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life.

This verse tells us everything about God's love. Now let's also consider what Romans 8:28 says. And we know that all things work together for good to them that love God to them who are the called according to his purpose.

What a wonderful promise from God."""
    
    print(f"Running full text processing pipeline...")
    
    # Process text (this runs Bible quote detection)
    try:
        processed_text, quote_boundaries = process_text(
            transcript, 
            translation="KJV",
            auto_detect=True,
            verbose=True
        )
        
        print(f"\nText processed. Found {len(quote_boundaries)} passages.")
        for qb in quote_boundaries:
            print(f"  - {qb.reference.to_standard_format()}: [{qb.start_pos}, {qb.end_pos}]")
        
        # Build AST
        result = build_ast(
            paragraphed_text=processed_text,
            quote_boundaries=quote_boundaries,
            title="Integration Test Sermon",
            debug=True
        )
        
        print(f"\nAST built successfully!")
        print(f"Paragraphs: {result.processing_metadata.paragraph_count}")
        print(f"Passages: {result.processing_metadata.passage_count}")
        
        return True
        
    except Exception as e:
        print(f"\n  ❌ FAIL: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all tests."""
    print("\n" + "=" * 70)
    print("AST PASSAGE BOUNDARY TESTS")
    print("=" * 70)
    
    results = []
    
    # Test 1
    results.append(("Passage mapping by START position", test_passage_mapping_by_start_position()))
    
    # Test 2
    results.append(("Single-paragraph constraint", test_single_paragraph_constraint()))
    
    # Test 3
    results.append(("Multiple passages in document", test_multiple_passages_in_document()))
    
    # Test 4 (optional - requires API)
    try:
        results.append(("Full pipeline integration", test_real_transcript_processing()))
    except Exception as e:
        print(f"\nSkipping integration test (API may be unavailable): {e}")
    
    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓ PASS" if result else "❌ FAIL"
        print(f"  {status}: {name}")
    
    print(f"\nResults: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✅ All tests passed!")
        return 0
    else:
        print("\n❌ Some tests failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
