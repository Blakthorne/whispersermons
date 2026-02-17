#!/usr/bin/env python3
"""
Test script for interjection boundary detection within Bible passages.

Focuses on the specific bug where:
1. An interjection like "who?" is correctly detected
2. But the interjection boundary extends too far, swallowing verse text that
   follows the interjection AND commentary text after the verse
3. The passage end boundary extends beyond actual verse content

The fix involves:
- Leading verse alignment check in detect_commentary_blocks
- Trailing commentary trimming from passage boundaries
- Proper separation of interjection vs. commentary vs. verse text

Run with: python test_interjection_boundaries.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import (
    QuoteBoundary, BibleReference,
    detect_interjections,
    detect_commentary_blocks,
    trim_trailing_exclusions,
    get_words,
)
from ast_builder import build_ast, _build_passage_node


# ============================================================================
# TEST DATA
# ============================================================================

# 1 Timothy 6:3 (KJV):
VERSE_1TIM_6_3 = (
    "If any man teach otherwise, and consent not to wholesome words, "
    "even the words of our Lord Jesus Christ, and to the doctrine "
    "which is according to godliness;"
)

# Simulated transcript for this verse with an interjection "who?" followed
# by verse resumption "Our Lord Jesus Christ." and then commentary.
TRANSCRIPT_WITH_INTERJECTION = (
    "and so Paul is saying here in first Timothy chapter six verse three "
    "if any man teach otherwise consent not to wholesome words or even "
    "the words of who? Our Lord Jesus Christ. So if they teach something "
    "contrary to what I have been teaching then you know they are wrong."
)


def create_test_quote(text, verse_text, start, end, book, chapter, verse_start, verse_end=None, confidence=0.85):
    """Create a QuoteBoundary for testing."""
    ref = BibleReference(
        book=book, chapter=chapter,
        verse_start=verse_start, verse_end=verse_end,
        original_text=f"{book} {chapter}:{verse_start}"
    )
    return QuoteBoundary(
        start_pos=start, end_pos=end,
        reference=ref,
        verse_text=verse_text,
        confidence=confidence,
        translation="KJV"
    )


# ============================================================================
# TEST: detect_interjections only finds "who?"
# ============================================================================

def test_interjection_detection_scope():
    """Verify detect_interjections finds only the 'who?' pattern, not the entire tail."""
    print("\n" + "=" * 70)
    print("TEST: Interjection detection scope")
    print("=" * 70)

    text = TRANSCRIPT_WITH_INTERJECTION
    # Find the verse portion in the transcript
    verse_start = text.find("if any man teach otherwise")
    # Extend end past the verse to include trailing commentary
    verse_end_approx = text.find("contrary to what I") + len("contrary to what I")

    interjections = detect_interjections(text, verse_start, verse_end_approx)

    print(f"  Passage region: [{verse_start}:{verse_end_approx}]")
    print(f"  Passage text: '{text[verse_start:verse_end_approx]}'")
    print(f"  Found {len(interjections)} interjection(s)")

    if not interjections:
        print("  FAIL: No interjections detected (expected 'who?')")
        return False

    for i, (s, e) in enumerate(interjections):
        interj_text = text[s:e]
        print(f"  Interjection {i}: [{s}:{e}] = '{interj_text}'")
        # Verify it's just "who?" (possibly with surrounding whitespace)
        if "who?" not in interj_text:
            print(f"  FAIL: Interjection doesn't contain 'who?'")
            return False
        if len(interj_text.strip()) > 10:
            print(f"  FAIL: Interjection is too long ({len(interj_text.strip())} chars)")
            return False

    print("  PASS: Interjection detection correctly scopes to 'who?' only")
    return True


# ============================================================================
# TEST: detect_commentary_blocks doesn't flag verse text after interjection
# ============================================================================

def test_commentary_not_after_interjection():
    """
    Verify detect_commentary_blocks doesn't flag verse text that resumes
    after an interjection (e.g., "Our Lord Jesus Christ." after "who?").
    """
    print("\n" + "=" * 70)
    print("TEST: Commentary detection respects verse resumption after interjection")
    print("=" * 70)

    text = TRANSCRIPT_WITH_INTERJECTION
    verse_start = text.find("if any man teach otherwise")
    verse_end_approx = text.find("contrary to what I") + len("contrary to what I")

    commentary_blocks = detect_commentary_blocks(
        text, verse_start, verse_end_approx, VERSE_1TIM_6_3
    )

    print(f"  Passage region: [{verse_start}:{verse_end_approx}]")
    print(f"  Found {len(commentary_blocks)} commentary block(s)")

    for i, (s, e) in enumerate(commentary_blocks):
        comm_text = text[s:e]
        print(f"  Commentary {i}: [{s}:{e}] = '{comm_text[:60]}...'")

        # Verify "Our Lord Jesus Christ" is NOT inside any commentary block
        if "Our Lord Jesus Christ" in comm_text[:30]:
            print(f"  FAIL: Commentary block incorrectly includes verse text 'Our Lord Jesus Christ'")
            return False

    print("  PASS: Commentary detection does not swallow verse text after interjection")
    return True


# ============================================================================
# TEST: trim_trailing_exclusions trims trailing commentary
# ============================================================================

def test_trailing_commentary_trim():
    """
    Verify trim_trailing_exclusions removes trailing commentary and adjusts end_pos.
    """
    print("\n" + "=" * 70)
    print("TEST: Trailing commentary trimming")
    print("=" * 70)

    text = TRANSCRIPT_WITH_INTERJECTION
    verse_start = text.find("if any man teach otherwise")

    # Simulated: interjection at "who?" and commentary at "So if they teach..."
    who_start = text.find("who?", verse_start)
    who_end = who_start + len("who?") + 1  # include trailing space
    while who_start > 0 and text[who_start - 1] in ' \t':
        who_start -= 1

    so_start = text.find("So if they teach", verse_start)
    end_approx = text.find("contrary to what I") + len("contrary to what I")

    exclusions = [(who_start, who_end), (so_start, end_approx)]
    print(f"  Exclusions before trim: {exclusions}")
    print(f"  Original end: {end_approx}")

    new_end, new_exclusions = trim_trailing_exclusions(
        text, verse_start, end_approx, exclusions, verbose=True
    )

    print(f"  New end: {new_end}")
    print(f"  Exclusions after trim: {new_exclusions}")

    # The trailing commentary should be trimmed
    if new_end >= end_approx:
        print("  FAIL: End was not trimmed")
        return False

    # "So if they teach..." should be removed from exclusions
    if len(new_exclusions) != 1:
        print(f"  FAIL: Expected 1 exclusion after trim, got {len(new_exclusions)}")
        return False

    # Remaining exclusion should be the interjection
    remaining_text = text[new_exclusions[0][0]:new_exclusions[0][1]]
    if "who?" not in remaining_text:
        print(f"  FAIL: Remaining exclusion should be 'who?', got '{remaining_text}'")
        return False

    # New end should be before "So if..."
    passage_text = text[verse_start:new_end]
    if "So if they teach" in passage_text:
        print(f"  FAIL: Passage text still includes commentary")
        return False

    print("  PASS: Trailing commentary correctly trimmed")
    return True


# ============================================================================
# TEST: Full pipeline produces correct passage structure
# ============================================================================

def test_passage_children_with_interjection():
    """
    End-to-end test: build a passage node with interjection and verify
    the children are [TextNode, InterjectionNode, TextNode] —
    NOT [TextNode, InterjectionNode(with verse+commentary text)].
    """
    print("\n" + "=" * 70)
    print("TEST: Passage node children with interjection")
    print("=" * 70)

    text = TRANSCRIPT_WITH_INTERJECTION
    verse_start = text.find("if any man teach otherwise")
    verse_end_with_commentary = text.find("contrary to what I") + len("contrary to what I")

    # Create quote with interjection positions
    interjections = detect_interjections(text, verse_start, verse_end_with_commentary)
    commentary_blocks = detect_commentary_blocks(text, verse_start, verse_end_with_commentary, VERSE_1TIM_6_3)

    all_exclusions = interjections + commentary_blocks
    all_exclusions.sort()

    # Merge overlapping exclusions
    if all_exclusions:
        merged = [all_exclusions[0]]
        for s, e in all_exclusions[1:]:
            if s <= merged[-1][1] + 5:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        all_exclusions = merged

    # Trim trailing commentary
    end = verse_end_with_commentary
    end, all_exclusions = trim_trailing_exclusions(
        text, verse_start, end, all_exclusions, verbose=True
    )

    print(f"  Final passage region: [{verse_start}:{end}]")
    print(f"  Final exclusions: {all_exclusions}")
    print(f"  Passage text: '{text[verse_start:end]}'")

    # Create mock quote boundary
    quote = create_test_quote(
        text, VERSE_1TIM_6_3,
        start=verse_start, end=end,
        book="1 Timothy", chapter=6, verse_start=3
    )
    quote.has_interjection = bool(all_exclusions)
    quote.interjection_positions = all_exclusions

    # Import for normalization
    import re
    content = text[verse_start:end]
    content_normalized = re.sub(r'\s+', ' ', content).strip()

    # Build passage node
    passage_node = _build_passage_node(quote, content_normalized)

    print(f"\n  Passage node children ({len(passage_node.children)}):")
    all_ok = True

    for i, child in enumerate(passage_node.children):
        label = child.type.upper()
        child_text = child.content if hasattr(child, 'content') else '(no content)'
        print(f"    [{i}] {label}: '{child_text}'")

    # Verify structure
    child_types = [c.type for c in passage_node.children]
    print(f"\n  Child types: {child_types}")

    # Check: should have at least TextNode, InterjectionNode, TextNode
    if child_types.count('interjection') < 1:
        print("  FAIL: No interjection node found")
        all_ok = False
    elif child_types.count('interjection') > 1:
        print("  FAIL: Multiple interjection nodes found (commentary not trimmed?)")
        all_ok = False

    if child_types.count('text') < 2:
        print("  FAIL: Expected at least 2 text nodes (before and after interjection)")
        all_ok = False

    # Check: interjection should only contain "who?"
    for child in passage_node.children:
        if child.type == 'interjection':
            stripped = child.content.strip()
            if len(stripped) > 10:
                print(f"  FAIL: Interjection too long: '{stripped}'")
                all_ok = False

    # Check: verse text "Our Lord Jesus Christ" should be in a text node
    text_contents = ' '.join(c.content for c in passage_node.children if c.type == 'text')
    if "Lord Jesus Christ" not in text_contents:
        print(f"  FAIL: 'Lord Jesus Christ' not found in text nodes")
        all_ok = False

    # Check: commentary text should NOT be in any node
    all_content = ' '.join(c.content for c in passage_node.children if hasattr(c, 'content'))
    if "So if they teach" in all_content:
        print(f"  FAIL: Commentary text 'So if they teach' found in passage nodes")
        all_ok = False

    if all_ok:
        print("  PASS: Passage has correct structure [Text, Interjection(who?), Text(Our Lord Jesus Christ)]")
    return all_ok


# ============================================================================
# TEST: Full AST build produces correct structure
# ============================================================================

def test_full_ast_build():
    """
    Full end-to-end test using build_ast to verify the passage and
    following paragraph are structured correctly.
    """
    print("\n" + "=" * 70)
    print("TEST: Full AST build with interjection boundary handling")
    print("=" * 70)

    text = TRANSCRIPT_WITH_INTERJECTION
    verse_start = text.find("if any man teach otherwise")
    verse_end_with_commentary = text.find("contrary to what I") + len("contrary to what I")

    # Detect interjections and commentary, apply fixes
    interjections = detect_interjections(text, verse_start, verse_end_with_commentary)
    commentary_blocks = detect_commentary_blocks(text, verse_start, verse_end_with_commentary, VERSE_1TIM_6_3)

    all_exclusions = interjections + commentary_blocks
    all_exclusions.sort()
    if all_exclusions:
        merged = [all_exclusions[0]]
        for s, e in all_exclusions[1:]:
            if s <= merged[-1][1] + 5:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        all_exclusions = merged

    end = verse_end_with_commentary
    end, all_exclusions = trim_trailing_exclusions(
        text, verse_start, end, all_exclusions, verbose=True
    )

    quote = create_test_quote(
        text, VERSE_1TIM_6_3,
        start=verse_start, end=end,
        book="1 Timothy", chapter=6, verse_start=3,
        confidence=0.85
    )
    quote.has_interjection = bool(all_exclusions)
    quote.interjection_positions = all_exclusions

    result = build_ast(
        raw_text=text,
        quote_boundaries=[quote],
        title="Interjection Boundary Test",
        debug=True
    )

    root = result.document_state.root
    print(f"\n  AST: {len(root.children)} paragraph(s)")

    all_ok = True
    found_passage = False
    found_following_text = False

    for i, para in enumerate(root.children):
        child_types = [c.type for c in para.children]
        print(f"  Paragraph {i}: {child_types}")

        for child in para.children:
            if child.type == 'passage':
                found_passage = True
                passage_child_types = [c.type for c in child.children]
                print(f"    Passage children: {passage_child_types}")

                # Verify interjection is only "who?"
                for pc in child.children:
                    if pc.type == 'interjection':
                        if "who?" not in pc.content:
                            print(f"    FAIL: Interjection should contain 'who?', got '{pc.content}'")
                            all_ok = False
                        if len(pc.content.strip()) > 10:
                            print(f"    FAIL: Interjection too long ({len(pc.content.strip())} chars)")
                            all_ok = False

                # Verify "Our Lord Jesus Christ" in text nodes
                text_parts = [c.content for c in child.children if c.type == 'text']
                all_text = ' '.join(text_parts)
                if "Lord Jesus Christ" not in all_text:
                    print(f"    FAIL: 'Lord Jesus Christ' not found in passage text nodes")
                    all_ok = False

                # Verify commentary not in passage
                passage_full = ' '.join(c.content for c in child.children if hasattr(c, 'content'))
                if "So if they teach" in passage_full:
                    print(f"    FAIL: Commentary 'So if they teach' found in passage")
                    all_ok = False

            elif child.type == 'text':
                if "So if they teach" in child.content or "contrary to what" in child.content:
                    found_following_text = True
                    print(f"    Text (following paragraph): '{child.content[:60]}...'")

    if not found_passage:
        print("  FAIL: No passage node found in AST")
        all_ok = False

    if not found_following_text:
        print("  WARN: Commentary text 'So if they teach' not found in any text paragraph")
        # This is a warning; the text might be too short for paragraph segmentation

    if all_ok:
        print("  PASS: Full AST correctly separates passage, interjection, and commentary")
    return all_ok


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    print("Interjection Boundary Detection Tests")
    print("=" * 70)

    results = []
    results.append(("Interjection detection scope", test_interjection_detection_scope()))
    results.append(("Commentary after interjection", test_commentary_not_after_interjection()))
    results.append(("Trailing commentary trim", test_trailing_commentary_trim()))
    results.append(("Passage children structure", test_passage_children_with_interjection()))
    results.append(("Full AST build", test_full_ast_build()))

    print("\n" + "=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)

    passed = 0
    failed = 0
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"  {status}: {name}")
        if result:
            passed += 1
        else:
            failed += 1

    print(f"\n  {passed}/{len(results)} tests passed")
    if failed > 0:
        print(f"  {failed} test(s) FAILED")
        sys.exit(1)
    else:
        print("  All tests passed!")
        sys.exit(0)
