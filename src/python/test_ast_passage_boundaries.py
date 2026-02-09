#!/usr/bin/env python3
"""
Test script for AST passage boundary detection in the integrated pipeline.

Tests that:
1. Passages are correctly mapped to paragraphs based on START position
2. Passages do NOT span multiple paragraphs (single-paragraph constraint)
3. Passage content is extracted correctly (actual verse text, not trailing text)
4. Full pipeline integration works end-to-end

Uses the new integrated pipeline: raw_text + sentences + paragraph_groups + boundaries
"""

import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import QuoteBoundary, BibleReference, process_text
from ast_builder import build_ast, ASTBuilderConfig
from main import tokenize_sentences, segment_into_paragraph_groups, SentenceInfo


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


def prepare_ast_inputs(raw_text, quote_boundaries=None, min_sentences=2):
    """Prepare inputs for build_ast from raw text."""
    sentences = tokenize_sentences(raw_text)
    paragraph_groups = segment_into_paragraph_groups(
        sentences,
        quote_boundaries=quote_boundaries or [],
        min_sentences_per_paragraph=min_sentences,
        similarity_threshold=0.45
    )
    return sentences, paragraph_groups


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

    sentences, paragraph_groups = prepare_ast_inputs(raw_text, [quote])

    result = build_ast(
        raw_text=raw_text, sentences=sentences,
        paragraph_groups=paragraph_groups,
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

    sentences, paragraph_groups = prepare_ast_inputs(raw_text, [quote])

    result = build_ast(
        raw_text=raw_text, sentences=sentences,
        paragraph_groups=paragraph_groups,
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

    sentences, paragraph_groups = prepare_ast_inputs(raw_text, quotes)

    result = build_ast(
        raw_text=raw_text, sentences=sentences,
        paragraph_groups=paragraph_groups,
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

        # Prepare integrated pipeline inputs
        sentences, paragraph_groups = prepare_ast_inputs(raw_text, quote_boundaries)

        # Build AST using the new integrated approach
        result = build_ast(
            raw_text=raw_text, sentences=sentences,
            paragraph_groups=paragraph_groups,
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
