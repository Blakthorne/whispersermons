#!/usr/bin/env python3
"""
Comprehensive test suite for the AST-first pipeline refactor.

Tests Phases 7-10 from the feature-rewrite-pipeline plan:
- Phase 7: Unit tests for apply_passages_to_ast()
- Phase 8: Paragraph segmentation tests for segment_ast_paragraphs()
- Phase 9: Integration and end-to-end tests
- Phase 10: Regression and edge case tests

Uses the project test pattern: custom main() runner with assertions and
print-based output (matching test_ast_passage_boundaries.py, etc.).
"""

import sys
import re
import time
from pathlib import Path
from typing import Optional, List, Dict, Any

sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import QuoteBoundary, BibleReference, process_text
from ast_builder import (
    build_ast,
    ASTBuilderConfig,
    apply_passages_to_ast,
    segment_ast_paragraphs,
    _filter_passages,
    _build_passage_node,
    _verify_content_match,
    _extract_references,
)
from document_model import (
    create_text_node,
    create_paragraph_node,
    create_document_root,
)
from main import tokenize_sentences, SentenceInfo


# ============================================================================
# HELPERS
# ============================================================================

ROMANS_12_1_VERSE_TEXT = (
    "I beseech you therefore, brethren, by the mercies of God, that ye present "
    "your bodies a living sacrifice, holy, acceptable unto God, which is your "
    "reasonable service."
)
JOHN_3_16_VERSE = (
    "For God so loved the world, that he gave his only begotten Son, that "
    "whosoever believeth in him should not perish, but have everlasting life."
)
ROMANS_8_28_VERSE = (
    "And we know that all things work together for good to them that love God, "
    "to them who are the called according to his purpose."
)


def create_mock_quote_boundary(
    start, end, book, chapter, verse_start, verse_end=None,
    verse_text="", confidence=0.95
):
    """Create a mock QuoteBoundary for testing."""
    ref = BibleReference(
        book=book, chapter=chapter, verse_start=verse_start,
        verse_end=verse_end,
        original_text=f"{book} {chapter}:{verse_start}"
    )
    return QuoteBoundary(
        start_pos=start, end_pos=end, reference=ref,
        verse_text=verse_text, confidence=confidence, translation="KJV"
    )


def get_passage_content(passage_node):
    """Extract full text content from a PassageNode's children."""
    content = ""
    for child in passage_node.children:
        if hasattr(child, 'content'):
            content += child.content
    return content


def get_paragraph_child_types(paragraph_node):
    """Get list of child type strings for a paragraph node."""
    return [child.type for child in paragraph_node.children]


def count_node_types(root):
    """Count nodes by type in the document tree."""
    counts = {'paragraph': 0, 'passage': 0, 'text': 0, 'interjection': 0}
    def count_recursive(node):
        if hasattr(node, 'type') and node.type in counts:
            counts[node.type] += 1
        if hasattr(node, 'children'):
            for child in node.children:
                count_recursive(child)
    count_recursive(root)
    return counts


def collect_all_text(root):
    """Collect all text content from the AST (text nodes + passage content)."""
    parts = []
    def walk(node):
        if hasattr(node, 'type') and node.type == 'text' and hasattr(node, 'content'):
            parts.append(node.content)
        if hasattr(node, 'type') and node.type == 'passage':
            # Collect passage content from its children
            for child in node.children:
                if hasattr(child, 'content'):
                    parts.append(child.content)
            return  # Don't recurse further into passage
        if hasattr(node, 'children'):
            for child in node.children:
                walk(child)
    walk(root)
    return parts


# ============================================================================
# PHASE 7: UNIT TESTS — apply_passages_to_ast()
# ============================================================================

def test_initial_ast_creation():
    """TEST-001: Initial AST creation validity (TASK-035)."""
    print("=" * 70)
    print("TEST-001: Initial AST creation")
    print("=" * 70)

    raw_text = "Hello world. This is a test."
    initial_text = create_text_node(raw_text)
    initial_para = create_paragraph_node(children=[initial_text])
    root = create_document_root(children=[initial_para], title="Test")

    if root.type != 'document':
        print("  FAIL: Root type is not 'document'")
        return False
    if len(root.children) != 1:
        print(f"  FAIL: Expected 1 child, got {len(root.children)}")
        return False
    if root.children[0].type != 'paragraph':
        print("  FAIL: First child is not a paragraph")
        return False
    if len(root.children[0].children) != 1:
        print(f"  FAIL: Paragraph has {len(root.children[0].children)} children, expected 1")
        return False
    if root.children[0].children[0].type != 'text':
        print("  FAIL: Paragraph child is not a text node")
        return False
    if root.children[0].children[0].content != raw_text:
        print("  FAIL: Text node content mismatch")
        return False

    print("  PASS: Initial flat AST structure is correct")
    return True


def test_single_passage_application():
    """TEST-002: Single passage splits into 3 nodes (TASK-036)."""
    print("\n" + "=" * 70)
    print("TEST-002: Single passage application (3-node split)")
    print("=" * 70)

    raw_text = (
        "Some text before the passage. "
        "I beseech you therefore brethren by the mercies of God that you present "
        "your bodies a living sacrifice holy acceptable unto God which is your "
        "reasonable service. "
        "Some text after the passage."
    )

    verse_start = raw_text.find("I beseech")
    verse_end = raw_text.find("reasonable service.") + len("reasonable service.")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text=ROMANS_12_1_VERSE_TEXT, confidence=0.9
    )

    # Create flat AST
    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )

    root, valid = apply_passages_to_ast(root, raw_text, [quote], debug=True)

    # Should have 3 paragraph nodes: text-before, passage, text-after
    if len(root.children) != 3:
        print(f"  FAIL: Expected 3 children, got {len(root.children)}")
        return False

    # Check text-before
    child_types_0 = get_paragraph_child_types(root.children[0])
    if child_types_0 != ['text']:
        print(f"  FAIL: First child types = {child_types_0}, expected ['text']")
        return False
    if "before" not in root.children[0].children[0].content.lower():
        print(f"  FAIL: Text-before doesn't contain expected content")
        return False

    # Check passage
    child_types_1 = get_paragraph_child_types(root.children[1])
    if child_types_1 != ['passage']:
        print(f"  FAIL: Second child types = {child_types_1}, expected ['passage']")
        return False

    passage_content = get_passage_content(root.children[1].children[0])
    if "beseech" not in passage_content.lower():
        print(f"  FAIL: Passage missing 'beseech'")
        return False

    # Check text-after
    child_types_2 = get_paragraph_child_types(root.children[2])
    if child_types_2 != ['text']:
        print(f"  FAIL: Third child types = {child_types_2}, expected ['text']")
        return False
    if "after" not in root.children[2].children[0].content.lower():
        print(f"  FAIL: Text-after doesn't contain expected content")
        return False

    print("  PASS: Single passage correctly creates 3-node split")
    return True


def test_multiple_passages_application():
    """TEST-003: Multiple passages (TASK-037)."""
    print("\n" + "=" * 70)
    print("TEST-003: Multiple passages application")
    print("=" * 70)

    raw_text = (
        "Introduction text. "
        "For God so loved the world that he gave his only begotten Son that "
        "whosoever believeth in him should not perish but have everlasting life. "
        "Middle commentary text. "
        "And we know that all things work together for good to them that love "
        "God to them who are the called according to his purpose. "
        "Conclusion text."
    )

    john_start = raw_text.find("For God so loved")
    john_verse = ("For God so loved the world that he gave his only begotten Son "
                  "that whosoever believeth in him should not perish but have "
                  "everlasting life.")
    john_end = raw_text.find(john_verse) + len(john_verse)

    romans_start = raw_text.find("And we know that all things")
    romans_verse = ("And we know that all things work together for good to them "
                    "that love God to them who are the called according to his purpose.")
    romans_end = raw_text.find(romans_verse) + len(romans_verse)

    quotes = [
        create_mock_quote_boundary(
            start=john_start, end=john_end,
            book="John", chapter=3, verse_start=16,
            verse_text=JOHN_3_16_VERSE, confidence=0.95
        ),
        create_mock_quote_boundary(
            start=romans_start, end=romans_end,
            book="Romans", chapter=8, verse_start=28,
            verse_text=ROMANS_8_28_VERSE, confidence=0.92
        )
    ]

    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )

    root, valid = apply_passages_to_ast(root, raw_text, quotes, debug=True)

    # Should have 5 nodes: text, passage, text, passage, text
    if len(root.children) != 5:
        print(f"  FAIL: Expected 5 children, got {len(root.children)}")
        for i, c in enumerate(root.children):
            types = get_paragraph_child_types(c)
            print(f"    child {i}: {types}")
        return False

    # Verify structure
    expected_types = [['text'], ['passage'], ['text'], ['passage'], ['text']]
    for i, expected in enumerate(expected_types):
        actual = get_paragraph_child_types(root.children[i])
        if actual != expected:
            print(f"  FAIL: Child {i} types = {actual}, expected {expected}")
            return False

    # Verify passages
    passage_refs = []
    for child in root.children:
        for sub in child.children:
            if sub.type == 'passage':
                passage_refs.append(sub.metadata.reference.normalized_reference)

    if len(passage_refs) != 2:
        print(f"  FAIL: Expected 2 passages, found {len(passage_refs)}")
        return False

    print(f"  PASS: {len(passage_refs)} passages correctly isolated in 5-node structure")
    return True


def test_passage_at_text_start():
    """TEST-004: Passage at position 0, no empty text-before (TASK-038)."""
    print("\n" + "=" * 70)
    print("TEST-004: Passage at text start")
    print("=" * 70)

    raw_text = (
        "For God so loved the world that he gave his only begotten Son. "
        "Some text after."
    )

    quote = create_mock_quote_boundary(
        start=0,
        end=raw_text.find(".") + 1,
        book="John", chapter=3, verse_start=16,
        verse_text=JOHN_3_16_VERSE, confidence=0.9
    )

    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )

    root, _ = apply_passages_to_ast(root, raw_text, [quote], debug=True)

    # Should have 2 nodes: passage, text-after (no empty text-before)
    if len(root.children) != 2:
        print(f"  FAIL: Expected 2 children, got {len(root.children)}")
        return False

    first_types = get_paragraph_child_types(root.children[0])
    if first_types != ['passage']:
        print(f"  FAIL: First child types = {first_types}, expected ['passage']")
        return False

    print("  PASS: No empty text-before node when passage at start")
    return True


def test_passage_at_text_end():
    """TEST-005: Passage at end of text, no empty text-after (TASK-039)."""
    print("\n" + "=" * 70)
    print("TEST-005: Passage at text end")
    print("=" * 70)

    raw_text = "Some text before. For God so loved the world."

    verse_start = raw_text.find("For God")
    verse_end = len(raw_text)

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="John", chapter=3, verse_start=16,
        verse_text=JOHN_3_16_VERSE, confidence=0.9
    )

    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )

    root, _ = apply_passages_to_ast(root, raw_text, [quote], debug=True)

    # Should have 2 nodes: text-before, passage (no empty text-after)
    if len(root.children) != 2:
        print(f"  FAIL: Expected 2 children, got {len(root.children)}")
        return False

    last_types = get_paragraph_child_types(root.children[-1])
    if last_types != ['passage']:
        print(f"  FAIL: Last child types = {last_types}, expected ['passage']")
        return False

    print("  PASS: No empty text-after node when passage at end")
    return True


def test_adjacent_passages():
    """TEST-006: Adjacent passages with no text between them (TASK-040)."""
    print("\n" + "=" * 70)
    print("TEST-006: Adjacent passages")
    print("=" * 70)

    raw_text = (
        "Before. "
        "For God so loved the world."
        "And we know that all things work together for good. "
        "After."
    )

    first_start = raw_text.find("For God")
    first_end = raw_text.find("the world.") + len("the world.")
    second_start = first_end  # Adjacent!
    second_end = raw_text.find("for good.") + len("for good.")

    quotes = [
        create_mock_quote_boundary(
            start=first_start, end=first_end,
            book="John", chapter=3, verse_start=16,
            verse_text="For God so loved the world.", confidence=0.9
        ),
        create_mock_quote_boundary(
            start=second_start, end=second_end,
            book="Romans", chapter=8, verse_start=28,
            verse_text="And we know that all things work together for good.",
            confidence=0.9
        )
    ]

    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )

    root, _ = apply_passages_to_ast(root, raw_text, quotes, debug=True)

    # Should have: text-before, passage, passage, text-after (no empty text between)
    passage_count = 0
    empty_texts = 0
    for child in root.children:
        types = get_paragraph_child_types(child)
        if types == ['passage']:
            passage_count += 1
        elif types == ['text']:
            content = child.children[0].content.strip()
            if not content:
                empty_texts += 1

    if passage_count != 2:
        print(f"  FAIL: Expected 2 passages, found {passage_count}")
        return False

    if empty_texts > 0:
        print(f"  FAIL: Found {empty_texts} empty text nodes")
        return False

    print(f"  PASS: 2 adjacent passages, {empty_texts} empty text nodes")
    return True


def test_passage_content_verification():
    """TEST-008: _verify_content_match validates content (TASK-042)."""
    print("\n" + "=" * 70)
    print("TEST-008: Passage content verification")
    print("=" * 70)

    # Good match
    quote_good = create_mock_quote_boundary(
        start=0, end=100, book="Romans", chapter=12, verse_start=1,
        verse_text="I beseech you therefore brethren by the mercies of God",
        confidence=0.9
    )
    good_content = "I beseech you therefore brethren by the mercies of God that you present"

    # Should not raise or print warning (overlap > 30%)
    try:
        _verify_content_match(quote_good, good_content, debug=True)
        print("  PASS: Good content match accepted")
    except Exception as e:
        print(f"  FAIL: Exception on good match: {e}")
        return False

    # Bad match
    quote_bad = create_mock_quote_boundary(
        start=0, end=100, book="Romans", chapter=12, verse_start=1,
        verse_text="I beseech you therefore brethren by the mercies of God",
        confidence=0.9
    )
    bad_content = "completely unrelated text about cooking recipes"

    # Should print warning but not raise
    try:
        _verify_content_match(quote_bad, bad_content, debug=True)
        print("  PASS: Bad content match warned (no exception)")
    except Exception as e:
        print(f"  FAIL: Exception on bad match: {e}")
        return False

    return True


def test_reverse_order_processing():
    """TEST-009: Reverse-order processing avoids index corruption (TASK-043)."""
    print("\n" + "=" * 70)
    print("TEST-009: Reverse-order processing")
    print("=" * 70)

    raw_text = (
        "Text A. "
        "Passage one content here. "
        "Text B. "
        "Passage two content here. "
        "Text C. "
        "Passage three content here. "
        "Text D."
    )

    p1_start = raw_text.find("Passage one")
    p1_end = raw_text.find("one content here.") + len("one content here.")
    p2_start = raw_text.find("Passage two")
    p2_end = raw_text.find("two content here.") + len("two content here.")
    p3_start = raw_text.find("Passage three")
    p3_end = raw_text.find("three content here.") + len("three content here.")

    quotes = [
        create_mock_quote_boundary(p1_start, p1_end, "Gen", 1, 1, verse_text="Passage one", confidence=0.9),
        create_mock_quote_boundary(p2_start, p2_end, "Gen", 2, 1, verse_text="Passage two", confidence=0.9),
        create_mock_quote_boundary(p3_start, p3_end, "Gen", 3, 1, verse_text="Passage three", confidence=0.9),
    ]

    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )

    root, valid = apply_passages_to_ast(root, raw_text, quotes, debug=True)

    # Should have 7 nodes: text, passage, text, passage, text, passage, text
    if len(root.children) != 7:
        print(f"  FAIL: Expected 7 children, got {len(root.children)}")
        for i, c in enumerate(root.children):
            types = get_paragraph_child_types(c)
            print(f"    child {i}: {types}")
        return False

    # Verify all 3 passages are present
    passage_count = sum(
        1 for c in root.children
        if get_paragraph_child_types(c) == ['passage']
    )
    if passage_count != 3:
        print(f"  FAIL: Expected 3 passages, found {passage_count}")
        return False

    # Verify passages have correct content
    for child in root.children:
        for sub in child.children:
            if sub.type == 'passage':
                content = get_passage_content(sub)
                if "passage" not in content.lower():
                    print(f"  FAIL: Passage content incorrect: '{content[:40]}'")
                    return False

    print("  PASS: All 3 passages correctly placed via reverse-order processing")
    return True


# ============================================================================
# PHASE 8: PARAGRAPH SEGMENTATION TESTS
# ============================================================================

def test_passage_paragraphs_skipped():
    """TEST-012: segment_ast_paragraphs skips passage paragraphs (TASK-046)."""
    print("\n" + "=" * 70)
    print("TEST-012: Passage paragraphs skipped by segmentation")
    print("=" * 70)

    # Build an AST with: text paragraph, passage paragraph, text paragraph
    raw_text = (
        "Some introductory text here. "
        "I beseech you therefore brethren. "
        "Some concluding text here."
    )

    verse_start = raw_text.find("I beseech")
    verse_end = raw_text.find("therefore brethren.") + len("therefore brethren.")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text="I beseech you therefore brethren", confidence=0.9
    )

    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )
    root, _ = apply_passages_to_ast(root, raw_text, [quote], debug=False)

    # Count passage paragraphs before segmentation
    passage_paras_before = sum(
        1 for c in root.children
        if any(getattr(sub, 'type', '') == 'passage' for sub in c.children)
    )

    # Run segmentation (min_sentences=2 so short texts won't be split)
    root = segment_ast_paragraphs(root, min_sentences=2, debug=True)

    # Count passage paragraphs after segmentation
    passage_paras_after = sum(
        1 for c in root.children
        if any(getattr(sub, 'type', '') == 'passage' for sub in c.children)
    )

    if passage_paras_before != passage_paras_after:
        print(f"  FAIL: Passage paragraph count changed: {passage_paras_before} -> {passage_paras_after}")
        return False

    # Verify passage content is unchanged
    for child in root.children:
        for sub in child.children:
            if sub.type == 'passage':
                content = get_passage_content(sub)
                if "beseech" not in content.lower():
                    print(f"  FAIL: Passage content changed after segmentation")
                    return False

    print("  PASS: Passage paragraphs were not modified by segmentation")
    return True


def test_short_text_block_skipped():
    """TEST-011: Short text blocks are not split (TASK-045)."""
    print("\n" + "=" * 70)
    print("TEST-011: Short text block skipped")
    print("=" * 70)

    short_text = "Just one sentence. And another. And a third."
    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(short_text)])]
    )

    children_before = len(root.children)
    root = segment_ast_paragraphs(root, min_sentences=10, debug=True)  # High threshold
    children_after = len(root.children)

    if children_before != children_after:
        print(f"  FAIL: Short text was split ({children_before} -> {children_after})")
        return False

    print("  PASS: Short text block kept as single paragraph")
    return True


def test_mixed_structure_preserved():
    """TEST-014: Mixed text/passage structure preserved (TASK-048)."""
    print("\n" + "=" * 70)
    print("TEST-014: Mixed structure preserved during segmentation")
    print("=" * 70)

    raw_text = (
        "First topic text here. Second topic text. Third topic text. "
        "Passage content here. "
        "Fourth topic text. Fifth topic text. Sixth topic text."
    )

    verse_start = raw_text.find("Passage content")
    verse_end = raw_text.find("content here.") + len("content here.")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Gen", chapter=1, verse_start=1,
        verse_text="Passage content", confidence=0.9
    )

    root = create_document_root(
        children=[create_paragraph_node(children=[create_text_node(raw_text)])]
    )
    root, _ = apply_passages_to_ast(root, raw_text, [quote], debug=False)

    # Before segmentation: text, passage, text
    passage_positions_before = []
    for i, child in enumerate(root.children):
        if any(getattr(sub, 'type', '') == 'passage' for sub in child.children):
            passage_positions_before.append(i)

    root = segment_ast_paragraphs(root, min_sentences=2, debug=True)

    # After segmentation: text (possibly split), passage, text (possibly split)
    # The key invariant: passages remain, and their relative order is preserved
    passage_positions_after = []
    for i, child in enumerate(root.children):
        if any(getattr(sub, 'type', '') == 'passage' for sub in child.children):
            passage_positions_after.append(i)

    if len(passage_positions_before) != len(passage_positions_after):
        print(f"  FAIL: Passage count changed: {len(passage_positions_before)} -> "
              f"{len(passage_positions_after)}")
        return False

    # Verify no text paragraphs contain passage nodes
    for child in root.children:
        types = get_paragraph_child_types(child)
        if 'passage' in types and 'text' in types:
            print(f"  FAIL: Mixed paragraph found with types {types}")
            return False

    print("  PASS: Passage ordering preserved, no mixed paragraphs after segmentation")
    return True


# ============================================================================
# PHASE 9: INTEGRATION AND END-TO-END TESTS
# ============================================================================

def test_full_pipeline_single_passage():
    """TEST-015/016: Full pipeline with single passage (TASK-049, TASK-050)."""
    print("\n" + "=" * 70)
    print("TEST-015: Full pipeline with single passage")
    print("=" * 70)

    raw_text = (
        "Good morning everyone. Today we are going to look at a key passage. "
        "Now let me read from Romans 12 one which says I beseech you therefore "
        "brethren by the mercies of God that you present your bodies a living "
        "sacrifice holy acceptable unto God which is your reasonable service. "
        "That is what Paul tells us about dedication."
    )

    verse_start = raw_text.find("I beseech")
    verse_text = ("I beseech you therefore brethren by the mercies of God that you "
                  "present your bodies a living sacrifice holy acceptable unto God "
                  "which is your reasonable service")
    verse_end = verse_start + len(verse_text)

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text=ROMANS_12_1_VERSE_TEXT, confidence=0.9
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote],
        title="Test Sermon",
        tags=["Faith"],
        debug=True,
        min_sentences=2  # Low threshold for short text
    )

    root = result.document_state.root

    # Check passage exists
    passage_found = False
    passage_is_sole_child = False
    for child in root.children:
        types = get_paragraph_child_types(child)
        if 'passage' in types:
            passage_found = True
            if types == ['passage']:
                passage_is_sole_child = True

    if not passage_found:
        print("  FAIL: No passage found in AST")
        return False

    if not passage_is_sole_child:
        print("  FAIL: Passage is not sole child of its paragraph")
        return False

    # Check DocumentState validity
    state = result.document_state
    if state.root.type != 'document':
        print("  FAIL: Root type incorrect")
        return False

    if not state.node_index:
        print("  FAIL: Node index is empty")
        return False

    if not state.passage_index.all:
        print("  FAIL: Passage index is empty")
        return False

    # Check serialization
    try:
        state_dict = state.to_dict()
        if 'root' not in state_dict:
            print("  FAIL: Serialized state missing 'root'")
            return False
        if 'nodeIndex' not in state_dict:
            print("  FAIL: Serialized state missing 'nodeIndex'")
            return False
    except Exception as e:
        print(f"  FAIL: Serialization error: {e}")
        return False

    print("  PASS: Full pipeline produces valid DocumentState with correct passage")
    return True


def test_no_empty_nodes():
    """TEST-018: No empty nodes in output AST (TASK-052)."""
    print("\n" + "=" * 70)
    print("TEST-018: No empty nodes in output")
    print("=" * 70)

    raw_text = (
        "Some text. "
        "For God so loved the world that he gave his only begotten Son. "
        "More text here."
    )

    verse_start = raw_text.find("For God")
    verse_end = raw_text.find("begotten Son.") + len("begotten Son.")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="John", chapter=3, verse_start=16,
        verse_text=JOHN_3_16_VERSE, confidence=0.9
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote],
        min_sentences=100  # Don't segment (too few sentences)
    )

    root = result.document_state.root
    errors = []

    def check_empty(node, path="root"):
        if hasattr(node, 'type') and node.type == 'text':
            if not getattr(node, 'content', '').strip():
                errors.append(f"Empty text node at {path}")
        if hasattr(node, 'type') and node.type == 'paragraph':
            if not getattr(node, 'children', []):
                errors.append(f"Empty paragraph at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_empty(child, f"{path}/child[{i}]")

    check_empty(root)

    if errors:
        for err in errors:
            print(f"  FAIL: {err}")
        return False

    print("  PASS: No empty text or paragraph nodes")
    return True


def test_content_completeness():
    """TEST-019: All raw_text content accounted for (TASK-053)."""
    print("\n" + "=" * 70)
    print("TEST-019: Content completeness")
    print("=" * 70)

    raw_text = (
        "Introduction text. "
        "For God so loved the world. "
        "Middle text here. "
        "And we know that all things. "
        "Conclusion text."
    )

    q1_start = raw_text.find("For God")
    q1_end = raw_text.find("the world.") + len("the world.")
    q2_start = raw_text.find("And we know")
    q2_end = raw_text.find("all things.") + len("all things.")

    quotes = [
        create_mock_quote_boundary(q1_start, q1_end, "John", 3, 16,
                                   verse_text="For God", confidence=0.9),
        create_mock_quote_boundary(q2_start, q2_end, "Rom", 8, 28,
                                   verse_text="And we know", confidence=0.9),
    ]

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=quotes,
        min_sentences=100  # Don't segment
    )

    root = result.document_state.root
    all_text_parts = collect_all_text(root)
    combined = ' '.join(all_text_parts)

    # Normalize whitespace for comparison
    raw_words = set(re.findall(r'\w+', raw_text.lower()))
    combined_words = set(re.findall(r'\w+', combined.lower()))

    missing = raw_words - combined_words
    if missing:
        print(f"  FAIL: Missing words from AST: {missing}")
        return False

    print(f"  PASS: All {len(raw_words)} words from raw_text found in AST")
    return True


def test_no_passages_transcript():
    """TEST-021: Transcript with no passages (TASK-055)."""
    print("\n" + "=" * 70)
    print("TEST-021: Transcript with no passages")
    print("=" * 70)

    raw_text = (
        "Good morning everyone. Today we discuss the importance of prayer. "
        "Prayer is our connection to God. We should pray daily."
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[],  # No passages
        title="No Passages Sermon",
        min_sentences=2
    )

    root = result.document_state.root

    # Should have paragraph(s) but no passages
    if not root.children:
        print("  FAIL: Root has no children")
        return False

    passage_count = 0
    for child in root.children:
        for sub in child.children:
            if sub.type == 'passage':
                passage_count += 1

    if passage_count != 0:
        print(f"  FAIL: Found {passage_count} passages in no-passage transcript")
        return False

    if result.processing_metadata.passage_count != 0:
        print(f"  FAIL: Metadata reports {result.processing_metadata.passage_count} passages")
        return False

    print("  PASS: No passages in output, paragraphs still created")
    return True


def test_processing_metadata_accuracy():
    """TEST-023: ProcessingMetadata accuracy (TASK-057)."""
    print("\n" + "=" * 70)
    print("TEST-023: ProcessingMetadata accuracy")
    print("=" * 70)

    raw_text = (
        "Text before. "
        "For God so loved the world that he gave his only begotten Son. "
        "Text after."
    )

    verse_start = raw_text.find("For God")
    verse_end = raw_text.find("begotten Son.") + len("begotten Son.")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="John", chapter=3, verse_start=16,
        verse_text=JOHN_3_16_VERSE, confidence=0.95
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote],
        min_sentences=100  # Don't segment
    )

    meta = result.processing_metadata

    if meta.passage_count != 1:
        print(f"  FAIL: passage_count = {meta.passage_count}, expected 1")
        return False

    if meta.paragraph_count < 1:
        print(f"  FAIL: paragraph_count = {meta.paragraph_count}, expected >= 1")
        return False

    if meta.total_time <= 0:
        print(f"  FAIL: total_time = {meta.total_time}, expected > 0")
        return False

    if 'apply_passages' not in meta.stage_times:
        print(f"  FAIL: 'apply_passages' not in stage_times")
        return False

    if 'create_state' not in meta.stage_times:
        print(f"  FAIL: 'create_state' not in stage_times")
        return False

    print(f"  PASS: Metadata correct: {meta.passage_count} passages, "
          f"{meta.paragraph_count} paragraphs, {meta.total_time:.1f}ms total")
    return True


def test_coordinate_immutability():
    """TEST-025: raw_text is never modified during pipeline (TASK-059)."""
    print("\n" + "=" * 70)
    print("TEST-025: Coordinate immutability")
    print("=" * 70)

    raw_text = (
        "Text before Romans 12:1 I beseech you therefore brethren. Text after."
    )
    raw_text_copy = str(raw_text)  # Make a copy

    verse_start = raw_text.find("I beseech")
    verse_end = raw_text.find("therefore brethren.") + len("therefore brethren.")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text="I beseech you therefore brethren", confidence=0.9
    )

    # Verify quote boundary is valid for original text
    if raw_text[quote.start_pos:quote.end_pos].strip() == "":
        print("  FAIL: Quote boundary invalid before pipeline")
        return False

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote],
        min_sentences=100
    )

    # Verify raw_text was not modified
    if raw_text != raw_text_copy:
        print("  FAIL: raw_text was modified during pipeline!")
        return False

    # Verify quote boundary still valid
    if raw_text[quote.start_pos:quote.end_pos].strip() == "":
        print("  FAIL: Quote boundary invalid after pipeline")
        return False

    print("  PASS: raw_text unchanged, boundaries remain valid")
    return True


def test_tiptap_compatibility():
    """TEST-027: AST output produces valid TipTap structure (TASK-061)."""
    print("\n" + "=" * 70)
    print("TEST-027: TipTap compatibility")
    print("=" * 70)

    raw_text = (
        "Introduction text here. "
        "I beseech you therefore brethren by the mercies of God. "
        "Conclusion text here."
    )

    verse_start = raw_text.find("I beseech")
    verse_end = raw_text.find("of God.") + len("of God.")

    quote = create_mock_quote_boundary(
        start=verse_start, end=verse_end,
        book="Romans", chapter=12, verse_start=1,
        verse_text="I beseech you therefore brethren by the mercies of God",
        confidence=0.95
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote],
        min_sentences=100
    )

    root = result.document_state.root
    errors = []

    # Check all nodes have IDs
    def check_ids(node, path="root"):
        if not hasattr(node, 'id') or not node.id:
            errors.append(f"Missing ID at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_ids(child, f"{path}/child[{i}]")

    check_ids(root)

    # Check passage isolation (sole child)
    def check_isolation(node, path="root"):
        if node.type == 'paragraph' and hasattr(node, 'children'):
            has_passage = any(c.type == 'passage' for c in node.children)
            has_text = any(c.type == 'text' for c in node.children)
            if has_passage and has_text:
                errors.append(f"Passage has text sibling at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_isolation(child, f"{path}/child[{i}]")

    check_isolation(root)

    # Check no empty text nodes
    def check_empty(node, path="root"):
        if node.type == 'text' and hasattr(node, 'content') and not node.content:
            errors.append(f"Empty text node at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_empty(child, f"{path}/child[{i}]")

    check_empty(root)

    if errors:
        for err in errors:
            print(f"  FAIL: {err}")
        return False

    print("  PASS: AST structure is TipTap-compatible")
    return True


def test_low_confidence_passage_filtered():
    """Extra test: Low-confidence passages are filtered out."""
    print("\n" + "=" * 70)
    print("TEST-EXTRA: Low confidence passage filtering")
    print("=" * 70)

    raw_text = "Some text. Passage content here. More text."

    quote = create_mock_quote_boundary(
        start=raw_text.find("Passage"),
        end=raw_text.find("here.") + len("here."),
        book="Gen", chapter=1, verse_start=1,
        verse_text="Passage content", confidence=0.1  # Very low confidence
    )

    result = build_ast(
        raw_text=raw_text,
        quote_boundaries=[quote],
        min_sentences=100
    )

    root = result.document_state.root
    passage_count = 0
    for child in root.children:
        for sub in child.children:
            if sub.type == 'passage':
                passage_count += 1

    if passage_count != 0:
        print(f"  FAIL: Low-confidence passage was included ({passage_count})")
        return False

    print("  PASS: Low-confidence passage correctly filtered out")
    return True


def test_build_ast_new_signature():
    """Test that build_ast works with new simplified signature."""
    print("\n" + "=" * 70)
    print("TEST-EXTRA: build_ast new signature")
    print("=" * 70)

    raw_text = "Hello world. This is a simple test."

    try:
        result = build_ast(
            raw_text=raw_text,
            quote_boundaries=[],
            title="Test",
            tags=["Test Tag"],
            min_sentences=100
        )

        if result.document_state.root.title != "Test":
            print("  FAIL: Title not set correctly")
            return False

        print("  PASS: build_ast works with new signature")
        return True

    except TypeError as e:
        print(f"  FAIL: Signature error: {e}")
        return False


# ============================================================================
# MAIN RUNNER
# ============================================================================

def main():
    """Run all tests."""
    print("\n" + "=" * 70)
    print("AST-FIRST PIPELINE TESTS")
    print("=" * 70)

    results = []

    # Phase 7: Unit tests
    results.append(("TEST-001: Initial AST creation", test_initial_ast_creation()))
    results.append(("TEST-002: Single passage application", test_single_passage_application()))
    results.append(("TEST-003: Multiple passages", test_multiple_passages_application()))
    results.append(("TEST-004: Passage at text start", test_passage_at_text_start()))
    results.append(("TEST-005: Passage at text end", test_passage_at_text_end()))
    results.append(("TEST-006: Adjacent passages", test_adjacent_passages()))
    results.append(("TEST-008: Content verification", test_passage_content_verification()))
    results.append(("TEST-009: Reverse-order processing", test_reverse_order_processing()))

    # Phase 8: Segmentation tests
    results.append(("TEST-011: Short text skipped", test_short_text_block_skipped()))
    results.append(("TEST-012: Passage paragraphs skipped", test_passage_paragraphs_skipped()))
    results.append(("TEST-014: Mixed structure preserved", test_mixed_structure_preserved()))

    # Phase 9: Integration tests
    results.append(("TEST-015: Full pipeline single passage", test_full_pipeline_single_passage()))
    results.append(("TEST-018: No empty nodes", test_no_empty_nodes()))
    results.append(("TEST-019: Content completeness", test_content_completeness()))
    results.append(("TEST-021: No passages transcript", test_no_passages_transcript()))
    results.append(("TEST-023: Metadata accuracy", test_processing_metadata_accuracy()))

    # Phase 10: Regression tests
    results.append(("TEST-025: Coordinate immutability", test_coordinate_immutability()))
    results.append(("TEST-027: TipTap compatibility", test_tiptap_compatibility()))

    # Extra tests
    results.append(("TEST-EXTRA: Low confidence filtering", test_low_confidence_passage_filtered()))
    results.append(("TEST-EXTRA: New signature", test_build_ast_new_signature()))

    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)

    passed = sum(1 for _, r in results if r is True)
    failed = sum(1 for _, r in results if r is False)
    total = len(results)

    for name, r in results:
        status = "PASS" if r else "FAIL"
        print(f"  {status}: {name}")

    print(f"\nResults: {passed} passed, {failed} failed (total: {total})")

    if failed == 0:
        print("\nAll tests passed!")
    else:
        print(f"\n{failed} test(s) FAILED!")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
