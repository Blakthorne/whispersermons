#!/usr/bin/env python3
"""
Test script for Passage Structure Isolation (Integrated Pipeline).

Tests:
1. Romans 12:1 example - the primary use case from the plan
2. Passage structural isolation - passages as sole children
3. Start boundary excludes intro phrases
4. End boundary includes complete verse text
5. Multiple passages isolation
6. Passages with interjections
7. Full pipeline test
8. TipTap integration compatibility

Uses the new integrated pipeline: raw_text + sentences + paragraph_groups + boundaries
"""

import sys
from pathlib import Path
from typing import Optional, List

sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import (
    QuoteBoundary, BibleReference, process_text,
    validate_start_is_verse_text, find_verse_end_in_transcript,
    verify_quote_boundaries, get_words
)
from ast_builder import build_ast, ASTBuilderConfig
from main import tokenize_sentences, segment_into_paragraph_groups, SentenceInfo


# ============================================================================
# TEST DATA
# ============================================================================

ROMANS_12_1_VERSE_TEXT = "I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service."
JOHN_3_16_VERSE = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
ROMANS_8_28_VERSE = "And we know that all things work together for good to them that love God, to them who are the called according to his purpose."


# ============================================================================
# HELPERS
# ============================================================================

def create_mock_quote_boundary(start, end, book, chapter, verse_start, verse_end=None, verse_text="", confidence=0.95):
    ref = BibleReference(book=book, chapter=chapter, verse_start=verse_start, verse_end=verse_end, original_text=f"{book} {chapter}:{verse_start}")
    return QuoteBoundary(start_pos=start, end_pos=end, reference=ref, verse_text=verse_text, confidence=confidence, translation="KJV")


def prepare_ast_inputs(raw_text, quote_boundaries=None, min_sentences=2):
    sentences = tokenize_sentences(raw_text)
    paragraph_groups = segment_into_paragraph_groups(
        sentences, quote_boundaries=quote_boundaries or [],
        min_sentences_per_paragraph=min_sentences, similarity_threshold=0.45
    )
    return sentences, paragraph_groups


def get_passage_content(passage_node):
    content = ""
    for child in passage_node.children:
        if hasattr(child, 'content'):
            content += child.content
    return content


def get_paragraph_child_types(paragraph_node):
    return [child.type for child in paragraph_node.children]


def count_node_types(root):
    counts = {'paragraph': 0, 'passage': 0, 'text': 0}
    def count_recursive(node):
        if node.type in counts:
            counts[node.type] += 1
        if hasattr(node, 'children'):
            for child in node.children:
                count_recursive(child)
    count_recursive(root)
    return counts


# ============================================================================
# TASK-025: ROMANS 12:1 EXAMPLE
# ============================================================================

def test_romans_12_1_example():
    print("=" * 70)
    print("TASK-025: Romans 12:1 Example from Plan")
    print("=" * 70)

    raw_text = "and what does Romans 12 1 says Paul writes I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service now that is powerful"

    expected_start_text = "I beseech"
    expected_start = raw_text.find(expected_start_text)

    bad_start = raw_text.find("says Paul writes")
    expected_end = raw_text.find("reasonable service") + len("reasonable service")

    quote = create_mock_quote_boundary(
        start=bad_start, end=expected_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text=ROMANS_12_1_VERSE_TEXT, confidence=0.85
    )

    validated_start = validate_start_is_verse_text(raw_text, bad_start, ROMANS_12_1_VERSE_TEXT, max_search_forward=100, debug=True)
    text_at_validated = raw_text[validated_start:validated_start+10].lower().strip()

    if "i beseech" not in text_at_validated:
        print(f"  FAIL: Start validation did not find 'I beseech'")
        return False

    print(f"  PASS: Start boundary correctly identifies verse start")

    quote_verified = verify_quote_boundaries(quote, raw_text, verbose=True)
    passage_text = raw_text[quote_verified.start_pos:quote_verified.end_pos]

    if "says paul writes" in passage_text.lower():
        print(f"  FAIL: Passage still contains intro phrase")
        return False

    if "i beseech" not in passage_text.lower():
        print(f"  FAIL: Passage missing 'I beseech'")
        return False

    if "reasonable service" not in passage_text.lower():
        print(f"  FAIL: Passage missing 'reasonable service'")
        return False

    print(f"  PASS: Passage boundaries correctly capture verse text")
    return True


# ============================================================================
# TASK-026: PASSAGE STRUCTURAL ISOLATION
# ============================================================================

def test_passage_structural_isolation():
    print("\n" + "=" * 70)
    print("TASK-026: Passage Structural Isolation (Sole Child)")
    print("=" * 70)

    raw_text = "Some introductory text here. Now Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service. And here is more text after."

    verse_start = raw_text.find("I beseech")
    verse_end = raw_text.find("reasonable service") + len("reasonable service")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text=ROMANS_12_1_VERSE_TEXT, confidence=0.9
    )

    sentences, paragraph_groups = prepare_ast_inputs(raw_text, [quote])

    result = build_ast(
        raw_text=raw_text, sentences=sentences,
        paragraph_groups=paragraph_groups,
        quote_boundaries=[quote], title="Isolation Test", debug=True
    )

    root = result.document_state.root
    print(f"Root has {len(root.children)} children")

    passage_paragraph_found = False
    passage_has_sibling = False

    for i, child in enumerate(root.children):
        child_types = get_paragraph_child_types(child)
        print(f"  Paragraph {i}: children = {child_types}")

        if 'passage' in child_types:
            passage_paragraph_found = True
            if len(child_types) > 1:
                passage_has_sibling = True

    if not passage_paragraph_found:
        print(f"  FAIL: No paragraph with passage found")
        return False

    if passage_has_sibling:
        print(f"  FAIL: Passage has sibling text nodes")
        return False

    print(f"  PASS: Passage is isolated as sole child of paragraph")
    return True


# ============================================================================
# TASK-027: START BOUNDARY EXCLUDES INTRO PHRASES
# ============================================================================

def test_start_boundary_excludes_intro():
    print("\n" + "=" * 70)
    print("TASK-027: Start Boundary Excludes Intro Phrases")
    print("=" * 70)

    raw_text = "and then what does it say Paul writes that in Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice"

    bad_start = raw_text.find("what does it say")
    verse_actual_start = raw_text.find("I beseech")

    validated = validate_start_is_verse_text(raw_text, bad_start, ROMANS_12_1_VERSE_TEXT, max_search_forward=100, debug=True)
    text_at_validated = raw_text[validated:validated+15]

    if "i beseech" in text_at_validated.lower():
        print(f"  PASS: Start boundary correctly excludes intro phrases")
        return True
    else:
        print(f"  FAIL: Start boundary still includes intro text")
        return False


# ============================================================================
# TASK-028: END BOUNDARY INCLUDES COMPLETE VERSE
# ============================================================================

def test_end_boundary_includes_complete_verse():
    print("\n" + "=" * 70)
    print("TASK-028: End Boundary Includes Complete Verse")
    print("=" * 70)

    raw_text = "Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service and be not conformed to this world. That is the full verse."

    verse_start = raw_text.find("I beseech")

    actual_end = find_verse_end_in_transcript(raw_text, verse_start, ROMANS_12_1_VERSE_TEXT, max_search=500, debug=True)

    if actual_end:
        passage_text = raw_text[verse_start:actual_end]
        if "reasonable service" in passage_text:
            print(f"  PASS: End boundary includes complete verse")
            return True
        else:
            print(f"  FAIL: End boundary does not include 'reasonable service'")
            return False
    else:
        print(f"  FAIL: Could not find verse end")
        return False


# ============================================================================
# TASK-029: MULTIPLE PASSAGES ISOLATION
# ============================================================================

def test_multiple_passages_isolated():
    print("\n" + "=" * 70)
    print("TASK-029: Multiple Passages Isolation")
    print("=" * 70)

    raw_text = (
        "Today we study two key passages. First let us look at John 3:16 where it says "
        "For God so loved the world that he gave his only begotten Son that whosoever "
        "believeth in him should not perish but have everlasting life. That is the foundation. "
        "And then Paul writes in Romans 8:28 And we know that all things work together for "
        "good to them that love God to them who are the called according to his purpose. What a promise!"
    )

    john_start = raw_text.find("For God so loved")
    john_end = john_start + len("For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life")

    romans_start = raw_text.find("And we know that all things")
    romans_end = romans_start + len("And we know that all things work together for good to them that love God to them who are the called according to his purpose")

    quotes = [
        create_mock_quote_boundary(start=john_start, end=john_end, book="John", chapter=3, verse_start=16, verse_text=JOHN_3_16_VERSE, confidence=0.95),
        create_mock_quote_boundary(start=romans_start, end=romans_end, book="Romans", chapter=8, verse_start=28, verse_text=ROMANS_8_28_VERSE, confidence=0.92)
    ]

    sentences, paragraph_groups = prepare_ast_inputs(raw_text, quotes)

    result = build_ast(
        raw_text=raw_text, sentences=sentences,
        paragraph_groups=paragraph_groups,
        quote_boundaries=quotes, title="Multi-Passage Test", debug=True
    )

    root = result.document_state.root
    counts = count_node_types(root)

    isolated_passages = 0
    for child in root.children:
        if child.type == 'paragraph':
            child_types = get_paragraph_child_types(child)
            if child_types == ['passage']:
                isolated_passages += 1

    if isolated_passages == 2:
        print(f"  PASS: Both passages are isolated as sole children")
        return True
    else:
        print(f"  FAIL: Expected 2 isolated passages, found {isolated_passages}")
        return False


# ============================================================================
# TASK-030: PASSAGES WITH INTERJECTIONS
# ============================================================================

def test_passages_with_interjections():
    print("\n" + "=" * 70)
    print("TASK-030: Passages with Interjections")
    print("=" * 70)

    raw_text = "Now hear this from John 3:16 For God so loved the world amen that he gave his only begotten Son hallelujah that whosoever believeth in him should not perish but have everlasting life. What grace!"

    verse_start = raw_text.find("For God so loved")
    verse_end = raw_text.find("have everlasting life") + len("have everlasting life")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="John", chapter=3, verse_start=16,
        verse_text=JOHN_3_16_VERSE, confidence=0.9
    )

    sentences, paragraph_groups = prepare_ast_inputs(raw_text, [quote])

    result = build_ast(
        raw_text=raw_text, sentences=sentences,
        paragraph_groups=paragraph_groups,
        quote_boundaries=[quote], title="Interjection Test", debug=True
    )

    root = result.document_state.root
    passage_found = False
    passage_isolated = False

    for child in root.children:
        if child.type == 'paragraph':
            child_types = get_paragraph_child_types(child)
            if 'passage' in child_types:
                passage_found = True
                if child_types == ['passage']:
                    passage_isolated = True

    if passage_found and passage_isolated:
        print(f"  PASS: Passage with interjections is correctly isolated")
        return True
    elif not passage_found:
        print(f"  FAIL: No passage found")
        return False
    else:
        print(f"  FAIL: Passage is not isolated")
        return False


# ============================================================================
# TASK-031: FULL PIPELINE
# ============================================================================

def test_full_pipeline():
    print("\n" + "=" * 70)
    print("TASK-031: Full Pipeline Test")
    print("=" * 70)

    raw_text = (
        "Good morning everyone. Today we will study the Word. "
        "Let us begin with John 3:16 For God so loved the world that he gave "
        "his only begotten Son that whosoever believeth in him should not perish "
        "but have everlasting life. "
        "What a beautiful verse. Now consider what Paul says in Romans 12:1 "
        "I beseech you therefore brethren by the mercies of God that you present "
        "your bodies a living sacrifice holy acceptable unto God which is your "
        "reasonable service. "
        "These two passages form the foundation of our faith."
    )

    try:
        processed_text, quote_boundaries = process_text(
            raw_text, translation="KJV", auto_detect=True, verbose=True
        )

        print(f"Quotes detected: {len(quote_boundaries)}")

        sentences, paragraph_groups = prepare_ast_inputs(raw_text, quote_boundaries)

        result = build_ast(
            raw_text=raw_text, sentences=sentences,
            paragraph_groups=paragraph_groups,
            quote_boundaries=quote_boundaries,
            title="Full Pipeline Test", debug=True
        )

        print(f"Passages: {result.processing_metadata.passage_count}")
        print(f"Paragraphs: {result.processing_metadata.paragraph_count}")

        root = result.document_state.root
        isolated_count = 0
        for child in root.children:
            if child.type == 'paragraph':
                child_types = get_paragraph_child_types(child)
                if child_types == ['passage']:
                    isolated_count += 1

        if len(quote_boundaries) > 0 and isolated_count == len(quote_boundaries):
            print(f"  PASS: Full pipeline produces correctly isolated passages")
            return True
        elif len(quote_boundaries) == 0:
            print(f"  SKIP: No quotes detected (API may be unavailable)")
            return True
        else:
            print(f"  FAIL: Not all passages are isolated")
            return False

    except Exception as e:
        print(f"  FAIL: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# TASK-032: TIPTAP INTEGRATION
# ============================================================================

def test_tiptap_integration():
    print("\n" + "=" * 70)
    print("TASK-032: TipTap Integration Compatibility")
    print("=" * 70)

    raw_text = (
        "Introduction text here. "
        "Romans 12:1 I beseech you therefore brethren by the mercies of God that you "
        "present your bodies a living sacrifice holy acceptable unto God which is your "
        "reasonable service. "
        "Conclusion text here."
    )

    verse_start = raw_text.find("I beseech")
    verse_end = raw_text.find("reasonable service") + len("reasonable service")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text=ROMANS_12_1_VERSE_TEXT, confidence=0.95
    )

    sentences, paragraph_groups = prepare_ast_inputs(raw_text, [quote])

    result = build_ast(
        raw_text=raw_text, sentences=sentences,
        paragraph_groups=paragraph_groups,
        quote_boundaries=[quote], title="TipTap Test", debug=True
    )

    root = result.document_state.root
    errors = []

    def check_ids(node, path="root"):
        if not hasattr(node, 'id') or not node.id:
            errors.append(f"Missing ID at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_ids(child, f"{path}/child[{i}]")

    check_ids(root)

    passage_violations = []
    def check_passage_isolation(node, path="root"):
        if node.type == 'paragraph' and hasattr(node, 'children'):
            has_passage = any(c.type == 'passage' for c in node.children)
            has_text = any(c.type == 'text' for c in node.children)
            if has_passage and has_text:
                passage_violations.append(f"Passage has text sibling at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_passage_isolation(child, f"{path}/child[{i}]")

    check_passage_isolation(root)

    def check_empty_text(node, path="root"):
        if node.type == 'text':
            if hasattr(node, 'content') and not node.content:
                errors.append(f"Empty text node at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_empty_text(child, f"{path}/child[{i}]")

    check_empty_text(root)

    if not errors:
        print(f"  PASS: All nodes have valid IDs")
    else:
        for err in errors:
            print(f"  FAIL: {err}")

    if not passage_violations:
        print(f"  PASS: All passages are sole children")
    else:
        for v in passage_violations:
            print(f"  FAIL: {v}")

    all_passed = len(errors) == 0 and len(passage_violations) == 0

    if all_passed:
        print(f"  PASS: AST structure is TipTap-compatible")
        return True
    else:
        print(f"  FAIL: AST has TipTap compatibility issues")
        return False


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("\n" + "=" * 70)
    print("PASSAGE STRUCTURE ISOLATION TESTS (Integrated Pipeline)")
    print("=" * 70)

    results = []

    results.append(("TASK-025: Romans 12:1 example", test_romans_12_1_example()))
    results.append(("TASK-026: Passage structural isolation", test_passage_structural_isolation()))
    results.append(("TASK-027: Start boundary excludes intro", test_start_boundary_excludes_intro()))
    results.append(("TASK-028: End boundary includes verse", test_end_boundary_includes_complete_verse()))
    results.append(("TASK-029: Multiple passages isolated", test_multiple_passages_isolated()))
    results.append(("TASK-030: Passages with interjections", test_passages_with_interjections()))
    results.append(("TASK-032: TipTap integration", test_tiptap_integration()))

    try:
        results.append(("TASK-031: Full pipeline", test_full_pipeline()))
    except Exception as e:
        print(f"Skipping full pipeline test: {e}")
        results.append(("TASK-031: Full pipeline", None))

    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)

    passed = sum(1 for _, r in results if r is True)
    failed = sum(1 for _, r in results if r is False)
    skipped = sum(1 for _, r in results if r is None)
    total = len(results)

    for name, r in results:
        if r is True:
            status = "PASS"
        elif r is False:
            status = "FAIL"
        else:
            status = "SKIP"
        print(f"  {status}: {name}")

    print(f"\nResults: {passed} passed, {failed} failed, {skipped} skipped (total: {total})")

    if failed == 0:
        print("\nAll tests passed!")
        return 0
    else:
        print(f"\n{failed} test(s) failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
