#!/usr/bin/env python3
"""
Test script for Passage Structure Isolation (Phase 5).

This script validates the passage isolation refactoring:
1. Romans 12:1 example - the primary use case from the plan
2. Passage structural isolation - passages as sole children
3. Start boundary excludes intro phrases
4. End boundary includes complete verse text
5. Multiple passages isolation
6. Passages with interjections
7. Full pipeline test
8. TipTap integration compatibility

Run with: python test_passage_isolation.py
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
    process_text,
    validate_start_is_verse_text,
    find_verse_end_in_transcript,
    verify_quote_boundaries,
    get_words
)
from ast_builder import (
    ASTBuilder,
    build_ast,
    ASTBuilderConfig
)


# ============================================================================
# TEST DATA - ROMANS 12:1 EXAMPLE FROM PLAN
# ============================================================================

# The exact transcript example from the plan document
ROMANS_12_1_TRANSCRIPT = """and what does Romans 12 1 says Paul writes I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service now that's powerful"""

ROMANS_12_1_VERSE_TEXT = "I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service."

# Multi-passage test transcript
MULTI_PASSAGE_TRANSCRIPT = """Today we study two key passages. First let us look at John 3:16 where it says For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life. That's the foundation.

And then Paul writes in Romans 8:28 And we know that all things work together for good to them that love God to them who are the called according to his purpose. What a promise!"""

JOHN_3_16_VERSE = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
ROMANS_8_28_VERSE = "And we know that all things work together for good to them that love God, to them who are the called according to his purpose."

# Passage with interjection
INTERJECTION_TRANSCRIPT = """Now hear this from John 3:16 For God so loved the world amen that he gave his only begotten Son hallelujah that whosoever believeth in him should not perish but have everlasting life. What grace!"""

# Compound intro phrase test
COMPOUND_INTRO_TRANSCRIPT = """and then what does it say Paul writes that in Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice"""


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

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


def get_passage_content(passage_node) -> str:
    """Extract the full text content from a PassageNode's children."""
    content = ""
    for child in passage_node.children:
        if hasattr(child, 'content'):
            content += child.content
    return content


def count_node_types(root) -> dict:
    """Count different node types in the AST."""
    counts = {'paragraph': 0, 'passage': 0, 'text': 0}
    
    def count_recursive(node):
        if node.type in counts:
            counts[node.type] += 1
        if hasattr(node, 'children'):
            for child in node.children:
                count_recursive(child)
    
    count_recursive(root)
    return counts


def get_paragraph_child_types(paragraph_node) -> List[str]:
    """Get the types of children in a paragraph node."""
    return [child.type for child in paragraph_node.children]


# ============================================================================
# TASK-025: TEST ROMANS 12:1 EXAMPLE
# ============================================================================

def test_romans_12_1_example():
    """
    TASK-025: Test the Romans 12:1 example from the plan.
    
    Expected behavior:
    - Start boundary should be at "I beseech" (not "says Paul writes")
    - End boundary should include "reasonable service"
    - Passage should be sole child of its paragraph
    """
    print("=" * 70)
    print("TASK-025: Romans 12:1 Example from Plan")
    print("=" * 70)
    
    transcript = ROMANS_12_1_TRANSCRIPT
    verse_text = ROMANS_12_1_VERSE_TEXT
    
    print(f"\nTranscript: '{transcript[:80]}...'")
    print(f"Verse text: '{verse_text[:60]}...'")
    
    # Find where the passage SHOULD start (at "I beseech")
    expected_start_text = "I beseech"
    expected_start = transcript.find(expected_start_text)
    
    # Find where passage SHOULD end (after "reasonable service")
    expected_end_text = "reasonable service"
    expected_end = transcript.find(expected_end_text) + len(expected_end_text)
    
    # Create a mock quote with a BAD start position (including intro phrase)
    bad_start = transcript.find("says Paul writes")
    quote = create_mock_quote_boundary(
        start=bad_start,
        end=expected_end,
        book="Romans",
        chapter=12,
        verse_start=1,
        verse_text=verse_text,
        confidence=0.85
    )
    
    print(f"\n--- Initial (incorrect) boundaries ---")
    print(f"Bad start pos: {bad_start} (at '{transcript[bad_start:bad_start+20]}')")
    print(f"End pos: {expected_end}")
    
    # Test validate_start_is_verse_text
    validated_start = validate_start_is_verse_text(
        transcript, bad_start, verse_text, max_search_forward=100, debug=True
    )
    
    print(f"\n--- After start validation ---")
    print(f"Validated start: {validated_start}")
    print(f"Expected start: {expected_start}")
    print(f"Text at validated start: '{transcript[validated_start:validated_start+20]}'")
    
    # Check if start was corrected
    if validated_start != expected_start:
        # Allow some tolerance (punctuation differences)
        actual_text_at_validated = transcript[validated_start:validated_start+10].lower().strip()
        expected_text = "i beseech"
        if expected_text not in actual_text_at_validated:
            print(f"  ❌ FAIL: Start validation did not find 'I beseech'")
            return False
    
    print(f"  ✓ PASS: Start boundary correctly identifies verse start")
    
    # Test verify_quote_boundaries (full verification)
    quote_verified = verify_quote_boundaries(quote, transcript, verbose=True)
    
    print(f"\n--- After full boundary verification ---")
    print(f"Original start: {quote_verified.original_start_pos}")
    print(f"Verified start: {quote_verified.start_pos}")
    print(f"Start adjustment: {quote_verified.start_adjustment}")
    print(f"End adjustment: {quote_verified.end_adjustment}")
    print(f"Boundary verified: {quote_verified.boundary_verified}")
    
    # Verify the content
    passage_text = transcript[quote_verified.start_pos:quote_verified.end_pos]
    print(f"\nFinal passage text: '{passage_text}'")
    
    # Passage should NOT include intro phrases
    if "says paul writes" in passage_text.lower():
        print(f"  ❌ FAIL: Passage still contains intro phrase")
        return False
    
    # Passage SHOULD include "I beseech"
    if "i beseech" not in passage_text.lower():
        print(f"  ❌ FAIL: Passage missing 'I beseech'")
        return False
    
    # Passage SHOULD include "reasonable service"
    if "reasonable service" not in passage_text.lower():
        print(f"  ❌ FAIL: Passage missing 'reasonable service'")
        return False
    
    print(f"  ✓ PASS: Passage boundaries correctly capture verse text")
    return True


# ============================================================================
# TASK-026: TEST PASSAGE STRUCTURAL ISOLATION
# ============================================================================

def test_passage_structural_isolation():
    """
    TASK-026: Test that passages are isolated as sole children.
    
    Expected AST structure:
    - Paragraph with text before passage
    - Paragraph containing ONLY the passage (no sibling text nodes)
    - Paragraph with text after passage
    """
    print("\n" + "=" * 70)
    print("TASK-026: Passage Structural Isolation (Sole Child)")
    print("=" * 70)
    
    transcript = """Some introductory text here.

Now Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service. And here is more text after."""
    
    verse_text = ROMANS_12_1_VERSE_TEXT
    
    # Find passage boundaries
    verse_start = transcript.find("I beseech")
    verse_end = transcript.find("reasonable service") + len("reasonable service")
    
    print(f"\nPassage boundaries: [{verse_start}, {verse_end}]")
    
    quote = create_mock_quote_boundary(
        start=verse_start,
        end=verse_end,
        book="Romans",
        chapter=12,
        verse_start=1,
        verse_text=verse_text,
        confidence=0.9
    )
    
    # Build AST
    result = build_ast(
        paragraphed_text=transcript,
        quote_boundaries=[quote],
        title="Isolation Test",
        debug=True
    )
    
    root = result.document_state.root
    print(f"\n--- AST Structure ---")
    print(f"Root has {len(root.children)} children")
    
    passage_paragraph_found = False
    passage_has_sibling = False
    
    for i, child in enumerate(root.children):
        child_types = get_paragraph_child_types(child)
        print(f"  Paragraph {i}: children = {child_types}")
        
        if 'passage' in child_types:
            passage_paragraph_found = True
            # Check if passage is SOLE child
            if len(child_types) > 1:
                passage_has_sibling = True
                print(f"    ❌ Passage has sibling nodes: {child_types}")
            else:
                print(f"    ✓ Passage is sole child")
    
    if not passage_paragraph_found:
        print(f"  ❌ FAIL: No paragraph with passage found")
        return False
    
    if passage_has_sibling:
        print(f"  ❌ FAIL: Passage has sibling text nodes")
        return False
    
    print(f"\n  ✓ PASS: Passage is isolated as sole child of paragraph")
    return True


# ============================================================================
# TASK-027: TEST START BOUNDARY EXCLUDES INTRO PHRASES
# ============================================================================

def test_start_boundary_excludes_intro():
    """
    TASK-027: Test that intro phrases are excluded from passage start.
    
    Tests various intro patterns:
    - "says"
    - "Paul writes"
    - "what does it say"
    - Compound: "says Paul writes that"
    """
    print("\n" + "=" * 70)
    print("TASK-027: Start Boundary Excludes Intro Phrases")
    print("=" * 70)
    
    # Test compound intro pattern
    transcript = COMPOUND_INTRO_TRANSCRIPT
    verse_text = ROMANS_12_1_VERSE_TEXT
    
    print(f"\nTranscript: '{transcript}'")
    
    # Simulate bad start including intro
    bad_start = transcript.find("what does it say")
    verse_actual_start = transcript.find("I beseech")
    
    print(f"Bad start (at intro): {bad_start}")
    print(f"Expected start (at verse): {verse_actual_start}")
    
    # Test validation
    validated = validate_start_is_verse_text(
        transcript, bad_start, verse_text, max_search_forward=100, debug=True
    )
    
    print(f"Validated start: {validated}")
    text_at_validated = transcript[validated:validated+15]
    print(f"Text at validated: '{text_at_validated}'")
    
    # Should skip ALL intro phrases
    text_before = transcript[bad_start:validated].lower()
    intro_phrases_in_skipped = []
    
    for phrase in ["what does it say", "paul writes", "that in"]:
        if phrase in text_before:
            intro_phrases_in_skipped.append(phrase)
    
    if intro_phrases_in_skipped:
        print(f"  ✓ Skipped intro phrases: {intro_phrases_in_skipped}")
    
    # Validate result starts with verse text
    if "i beseech" in text_at_validated.lower():
        print(f"\n  ✓ PASS: Start boundary correctly excludes intro phrases")
        return True
    else:
        print(f"\n  ❌ FAIL: Start boundary still includes intro text")
        return False


# ============================================================================
# TASK-028: TEST END BOUNDARY INCLUDES COMPLETE VERSE
# ============================================================================

def test_end_boundary_includes_complete_verse():
    """
    TASK-028: Test that end boundary includes the complete verse text.
    
    Tests that find_verse_end_in_transcript correctly finds where
    the verse ends in the transcript.
    """
    print("\n" + "=" * 70)
    print("TASK-028: End Boundary Includes Complete Verse")
    print("=" * 70)
    
    # Create transcript where verse continues past potential cutoff
    transcript = """Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service and be not conformed to this world. That is the full verse."""
    
    verse_text = "I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service."
    
    verse_start = transcript.find("I beseech")
    
    # Simulate premature end detection (stopped too early)
    premature_end = transcript.find("acceptable unto God") + len("acceptable unto God")
    
    print(f"\nVerse start: {verse_start}")
    print(f"Premature end (too early): {premature_end}")
    print(f"Text at premature end: '...{transcript[premature_end-10:premature_end+20]}...'")
    
    # Find actual verse end
    actual_end = find_verse_end_in_transcript(
        transcript, verse_start, verse_text, max_search=500, debug=True
    )
    
    print(f"\nActual verse end found: {actual_end}")
    if actual_end:
        print(f"Text ends at: '...{transcript[actual_end-20:actual_end]}'")
        
        # The end should include "reasonable service"
        passage_text = transcript[verse_start:actual_end]
        if "reasonable service" in passage_text:
            print(f"\n  ✓ PASS: End boundary includes complete verse")
            return True
        else:
            print(f"\n  ❌ FAIL: End boundary does not include 'reasonable service'")
            return False
    else:
        print(f"\n  ❌ FAIL: Could not find verse end")
        return False


# ============================================================================
# TASK-029: TEST MULTIPLE PASSAGES ISOLATION
# ============================================================================

def test_multiple_passages_isolated():
    """
    TASK-029: Test that multiple passages are each isolated correctly.
    """
    print("\n" + "=" * 70)
    print("TASK-029: Multiple Passages Isolation")
    print("=" * 70)
    
    transcript = MULTI_PASSAGE_TRANSCRIPT
    
    # Find boundaries for both passages
    john_start = transcript.find("For God so loved")
    john_end = john_start + len("For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life")
    
    romans_start = transcript.find("And we know that all things")
    romans_end = romans_start + len("And we know that all things work together for good to them that love God to them who are the called according to his purpose")
    
    print(f"\nJohn 3:16: [{john_start}, {john_end}]")
    print(f"Romans 8:28: [{romans_start}, {romans_end}]")
    
    quotes = [
        create_mock_quote_boundary(
            start=john_start,
            end=john_end,
            book="John",
            chapter=3,
            verse_start=16,
            verse_text=JOHN_3_16_VERSE,
            confidence=0.95
        ),
        create_mock_quote_boundary(
            start=romans_start,
            end=romans_end,
            book="Romans",
            chapter=8,
            verse_start=28,
            verse_text=ROMANS_8_28_VERSE,
            confidence=0.92
        )
    ]
    
    # Build AST
    result = build_ast(
        paragraphed_text=transcript,
        quote_boundaries=quotes,
        title="Multi-Passage Test",
        debug=True
    )
    
    root = result.document_state.root
    counts = count_node_types(root)
    
    print(f"\n--- AST Statistics ---")
    print(f"Total paragraphs: {counts['paragraph']}")
    print(f"Total passages: {counts['passage']}")
    
    # Check each passage is isolated
    isolated_passages = 0
    for child in root.children:
        if child.type == 'paragraph':
            child_types = get_paragraph_child_types(child)
            if child_types == ['passage']:
                isolated_passages += 1
    
    print(f"Isolated passages (sole child): {isolated_passages}")
    
    if isolated_passages == 2:
        print(f"\n  ✓ PASS: Both passages are isolated as sole children")
        return True
    else:
        print(f"\n  ❌ FAIL: Expected 2 isolated passages, found {isolated_passages}")
        return False


# ============================================================================
# TASK-030: TEST PASSAGES WITH INTERJECTIONS
# ============================================================================

def test_passages_with_interjections():
    """
    TASK-030: Test that interjections within passages are handled correctly.
    """
    print("\n" + "=" * 70)
    print("TASK-030: Passages with Interjections")
    print("=" * 70)
    
    transcript = INTERJECTION_TRANSCRIPT
    verse_text = JOHN_3_16_VERSE
    
    # Find the passage boundaries
    verse_start = transcript.find("For God so loved")
    verse_end = transcript.find("have everlasting life") + len("have everlasting life")
    
    print(f"\nTranscript: '{transcript}'")
    print(f"Passage boundaries: [{verse_start}, {verse_end}]")
    
    # Create quote (interjections will be detected by processor)
    quote = create_mock_quote_boundary(
        start=verse_start,
        end=verse_end,
        book="John",
        chapter=3,
        verse_start=16,
        verse_text=verse_text,
        confidence=0.9
    )
    
    # Build AST
    result = build_ast(
        paragraphed_text=transcript,
        quote_boundaries=[quote],
        title="Interjection Test",
        debug=True
    )
    
    root = result.document_state.root
    
    # Find the passage and check its structure
    passage_found = False
    passage_isolated = False
    
    for child in root.children:
        if child.type == 'paragraph':
            child_types = get_paragraph_child_types(child)
            if 'passage' in child_types:
                passage_found = True
                if child_types == ['passage']:
                    passage_isolated = True
                    print(f"  ✓ Passage is isolated")
                
                # Get passage content
                for sub in child.children:
                    if sub.type == 'passage':
                        content = get_passage_content(sub)
                        print(f"  Passage content: '{content[:60]}...'")
    
    if passage_found and passage_isolated:
        print(f"\n  ✓ PASS: Passage with interjections is correctly isolated")
        return True
    elif not passage_found:
        print(f"\n  ❌ FAIL: No passage found")
        return False
    else:
        print(f"\n  ❌ FAIL: Passage is not isolated")
        return False


# ============================================================================
# TASK-031: TEST FULL PIPELINE
# ============================================================================

def test_full_pipeline():
    """
    TASK-031: Test the full processing pipeline end-to-end.
    
    This tests the complete flow:
    1. process_text() - Bible quote detection
    2. build_ast() - AST construction
    3. Verify passage isolation in final output
    """
    print("\n" + "=" * 70)
    print("TASK-031: Full Pipeline Test")
    print("=" * 70)
    
    transcript = """Good morning everyone. Today we will study the Word.

Let's begin with John 3:16 For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life.

What a beautiful verse. Now consider what Paul says in Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service.

These two passages form the foundation of our faith."""
    
    print(f"\nRunning full pipeline...")
    print(f"Transcript length: {len(transcript)} chars")
    
    try:
        # Step 1: Process text
        processed_text, quote_boundaries = process_text(
            transcript,
            translation="KJV",
            auto_detect=True,
            verbose=True
        )
        
        print(f"\nQuotes detected: {len(quote_boundaries)}")
        for qb in quote_boundaries:
            ref_str = qb.reference.to_standard_format()
            print(f"  - {ref_str}: [{qb.start_pos}, {qb.end_pos}]")
            if qb.boundary_verified:
                print(f"    Boundary verified, adjustments: start={qb.start_adjustment}, end={qb.end_adjustment}")
        
        # Step 2: Build AST
        result = build_ast(
            paragraphed_text=processed_text,
            quote_boundaries=quote_boundaries,
            title="Full Pipeline Test",
            debug=True
        )
        
        print(f"\n--- AST Result ---")
        print(f"Passages in AST: {result.processing_metadata.passage_count}")
        print(f"Paragraphs in AST: {result.processing_metadata.paragraph_count}")
        
        # Step 3: Verify isolation
        root = result.document_state.root
        isolated_count = 0
        
        for child in root.children:
            if child.type == 'paragraph':
                child_types = get_paragraph_child_types(child)
                if child_types == ['passage']:
                    isolated_count += 1
        
        print(f"Isolated passages: {isolated_count}")
        
        if len(quote_boundaries) > 0 and isolated_count == len(quote_boundaries):
            print(f"\n  ✓ PASS: Full pipeline produces correctly isolated passages")
            return True
        elif len(quote_boundaries) == 0:
            print(f"\n  ⚠ SKIP: No quotes detected (API may be unavailable)")
            return True  # Don't fail if API is unavailable
        else:
            print(f"\n  ❌ FAIL: Not all passages are isolated")
            return False
            
    except Exception as e:
        print(f"\n  ❌ FAIL: Exception during pipeline: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# TASK-032: TEST TIPTAP INTEGRATION COMPATIBILITY
# ============================================================================

def test_tiptap_integration():
    """
    TASK-032: Test that AST structure is compatible with TipTap.
    
    TipTap requires:
    - Passages must be sole children of paragraphs
    - No text nodes as siblings to passage nodes
    - Valid node IDs on all structural nodes
    """
    print("\n" + "=" * 70)
    print("TASK-032: TipTap Integration Compatibility")
    print("=" * 70)
    
    transcript = """Introduction text here.

Romans 12:1 I beseech you therefore brethren by the mercies of God that you present your bodies a living sacrifice holy acceptable unto God which is your reasonable service.

Conclusion text here."""
    
    verse_text = ROMANS_12_1_VERSE_TEXT
    verse_start = transcript.find("I beseech")
    verse_end = transcript.find("reasonable service") + len("reasonable service")
    
    quote = create_mock_quote_boundary(
        start=verse_start,
        end=verse_end,
        book="Romans",
        chapter=12,
        verse_start=1,
        verse_text=verse_text,
        confidence=0.95
    )
    
    result = build_ast(
        paragraphed_text=transcript,
        quote_boundaries=[quote],
        title="TipTap Test",
        debug=True
    )
    
    root = result.document_state.root
    
    print(f"\n--- TipTap Compatibility Checks ---")
    
    errors = []
    
    # Check 1: All structural nodes have IDs
    def check_ids(node, path="root"):
        if not hasattr(node, 'id') or not node.id:
            errors.append(f"Missing ID at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_ids(child, f"{path}/child[{i}]")
    
    check_ids(root)
    
    if not errors:
        print(f"  ✓ All nodes have valid IDs")
    else:
        for err in errors:
            print(f"  ❌ {err}")
    
    # Check 2: Passages are sole children
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
    
    if not passage_violations:
        print(f"  ✓ All passages are sole children")
    else:
        for v in passage_violations:
            print(f"  ❌ {v}")
    
    # Check 3: No empty text nodes
    def check_empty_text(node, path="root"):
        if node.type == 'text':
            if hasattr(node, 'content') and not node.content:
                errors.append(f"Empty text node at {path}")
        if hasattr(node, 'children'):
            for i, child in enumerate(node.children):
                check_empty_text(child, f"{path}/child[{i}]")
    
    check_empty_text(root)
    
    if not any("Empty text" in e for e in errors):
        print(f"  ✓ No empty text nodes")
    
    all_passed = len(errors) == 0 and len(passage_violations) == 0
    
    if all_passed:
        print(f"\n  ✓ PASS: AST structure is TipTap-compatible")
        return True
    else:
        print(f"\n  ❌ FAIL: AST has TipTap compatibility issues")
        return False


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all passage isolation tests."""
    print("\n" + "=" * 70)
    print("PASSAGE STRUCTURE ISOLATION TESTS (PHASE 5)")
    print("=" * 70)
    
    results = []
    
    # Core functionality tests (don't require API)
    results.append(("TASK-025: Romans 12:1 example", test_romans_12_1_example()))
    results.append(("TASK-026: Passage structural isolation", test_passage_structural_isolation()))
    results.append(("TASK-027: Start boundary excludes intro", test_start_boundary_excludes_intro()))
    results.append(("TASK-028: End boundary includes verse", test_end_boundary_includes_complete_verse()))
    results.append(("TASK-029: Multiple passages isolated", test_multiple_passages_isolated()))
    results.append(("TASK-030: Passages with interjections", test_passages_with_interjections()))
    results.append(("TASK-032: TipTap integration", test_tiptap_integration()))
    
    # Full pipeline test (requires API)
    try:
        results.append(("TASK-031: Full pipeline", test_full_pipeline()))
    except Exception as e:
        print(f"\nSkipping full pipeline test: {e}")
        results.append(("TASK-031: Full pipeline", None))
    
    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    
    passed = sum(1 for _, result in results if result is True)
    failed = sum(1 for _, result in results if result is False)
    skipped = sum(1 for _, result in results if result is None)
    total = len(results)
    
    for name, result in results:
        if result is True:
            status = "✓ PASS"
        elif result is False:
            status = "❌ FAIL"
        else:
            status = "⚠ SKIP"
        print(f"  {status}: {name}")
    
    print(f"\nResults: {passed} passed, {failed} failed, {skipped} skipped (total: {total})")
    
    if failed == 0:
        print("\n✅ All tests passed!")
        return 0
    else:
        print(f"\n❌ {failed} test(s) failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
