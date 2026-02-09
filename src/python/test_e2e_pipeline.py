#!/usr/bin/env python3
"""
End-to-end test for the integrated pipeline.

Tests that the new pipeline correctly:
1. Tokenizes raw text into sentences with character positions
2. Groups sentences into paragraph groups
3. Maps passage boundaries to paragraph groups (no remapping needed)
4. Builds the AST with correct passage content

All positions reference the immutable raw_text. No remapping needed.
"""

import sys
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from main import tokenize_sentences, segment_into_paragraph_groups, SentenceInfo
from bible_quote_processor import QuoteBoundary, BibleReference
from ast_builder import build_ast


def create_quote(raw_text, verse_pattern, book, chapter, verse_start, verse_text, confidence=0.97):
    """Helper to create a QuoteBoundary from a raw_text pattern match."""
    match = re.search(verse_pattern, raw_text)
    if not match:
        raise ValueError(f"Pattern '{verse_pattern}' not found in text")

    ref = BibleReference(
        book=book,
        chapter=chapter,
        verse_start=verse_start,
        original_text=f'{book} {chapter}:{verse_start}'
    )

    return QuoteBoundary(
        start_pos=match.start(),
        end_pos=match.end(),
        reference=ref,
        verse_text=verse_text,
        confidence=confidence
    )


def test_integrated_pipeline():
    """Test the full integrated pipeline with no text mutation."""
    print("=" * 70)
    print("END-TO-END INTEGRATED PIPELINE TEST")
    print("=" * 70)
    print()

    # Raw transcript (as Whisper would produce - no paragraph breaks)
    raw_text = (
        "You have much to give that metaphorically will put a smile on his face. "
        "Romans 12 one says Paul writes I beseech you therefore brethren by the "
        "mercies of God that you present your bodies a living sacrifice wholly "
        "acceptable unto God which is your reasonable service. What is Paul saying "
        "here? He is telling us to offer ourselves completely to God."
    )

    print(f"Step 1: Raw text length = {len(raw_text)} chars")

    # Step 2: Tokenize into sentences
    sentences = tokenize_sentences(raw_text)
    print(f"Step 2: Tokenized into {len(sentences)} sentences")
    for s in sentences:
        preview = s.text[:50] + '...' if len(s.text) > 50 else s.text
        print(f"  [{s.start_pos}-{s.end_pos}] '{preview}'")
    print()

    # Step 3: Create quote boundary (positions in raw_text)
    verse_pattern = r'I beseech you therefore brethren.*?reasonable service\.'
    quote = create_quote(
        raw_text, verse_pattern,
        book='Romans', chapter=12, verse_start=1,
        verse_text="I beseech you therefore brethren by the mercies of God",
        confidence=0.97
    )

    print(f"Step 3: Quote boundary = [{quote.start_pos}, {quote.end_pos}]")
    print(f"  Content: '{raw_text[quote.start_pos:quote.end_pos][:60]}...'")
    print()

    # Step 4: Segment into paragraph groups
    paragraph_groups = segment_into_paragraph_groups(
        sentences,
        quote_boundaries=[quote],
        min_sentences_per_paragraph=2,
        similarity_threshold=0.45
    )

    print(f"Step 4: {len(paragraph_groups)} paragraph groups")
    for i, group in enumerate(paragraph_groups):
        group_text = ' '.join(sentences[idx].text for idx in group)
        preview = group_text[:60] + '...' if len(group_text) > 60 else group_text
        print(f"  Group {i}: sentences {group} -> '{preview}'")
    print()

    # Step 5: Build AST (no remapping needed!)
    result = build_ast(
        raw_text=raw_text,
        sentences=sentences,
        paragraph_groups=paragraph_groups,
        quote_boundaries=[quote],
        title="E2E Test Sermon",
        debug=True
    )

    print(f"Step 5: AST built - {result.processing_metadata.paragraph_count} paragraphs, "
          f"{result.processing_metadata.passage_count} passages")

    print()
    print("=" * 70)
    print("VERIFICATION")
    print("=" * 70)

    root = result.document_state.root
    passage_content = None
    for child in root.children:
        if child.type == 'paragraph':
            for sub in child.children:
                if sub.type == 'passage':
                    passage_content = ""
                    for text_child in sub.children:
                        if hasattr(text_child, 'content'):
                            passage_content += text_child.content

    if passage_content is None:
        print("FAIL: No passage found in AST")
        return False

    print(f"Passage content: '{passage_content[:80]}...'")

    all_passed = True

    if passage_content.startswith("I beseech"):
        print("PASS: Passage starts with 'I beseech'")
    else:
        print(f"FAIL: Passage starts with '{passage_content[:30]}'")
        all_passed = False

    if "reasonable service." in passage_content:
        print("PASS: Passage contains 'reasonable service.'")
    else:
        print("FAIL: Passage does not contain 'reasonable service.'")
        all_passed = False

    if "his face" not in passage_content:
        print("PASS: Passage does NOT include preceding text")
    else:
        print("FAIL: Passage incorrectly includes 'his face'")
        all_passed = False

    if "What is Paul" not in passage_content:
        print("PASS: Passage does NOT include following text")
    else:
        print("FAIL: Passage incorrectly includes 'What is Paul'")
        all_passed = False

    if all_passed:
        print("\nALL CHECKS PASSED!")
    else:
        print("\nSOME CHECKS FAILED.")

    return all_passed


if __name__ == "__main__":
    success = test_integrated_pipeline()
    sys.exit(0 if success else 1)
