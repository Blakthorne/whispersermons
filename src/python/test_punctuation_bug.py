#!/usr/bin/env python3
"""
Test script to demonstrate and verify the punctuation boundary bug.

BUG: Punctuation at the end of passage text nodes consistently gets left off
and appears at the start of the next text node instead.

ROOT CAUSE: bible_quote_processor uses word-boundary matching (\\b\\w+\\b) to 
determine end_pos. This ends at the last word character, excluding any 
trailing punctuation (periods, commas, etc.). The AST builder then splits 
the text at exactly end_pos, leaving the punctuation in the text-after segment.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from bible_quote_processor import QuoteBoundary, BibleReference
from ast_builder import apply_passages_to_ast
from document_model import (
    create_text_node, create_paragraph_node, create_document_root
)


def make_quote(start, end, book, chapter, verse_start, verse_text, confidence=0.95):
    ref = BibleReference(
        book=book, chapter=chapter, verse_start=verse_start,
        verse_end=None, original_text=f"{book} {chapter}:{verse_start}"
    )
    return QuoteBoundary(
        start_pos=start, end_pos=end, reference=ref,
        verse_text=verse_text, confidence=confidence, translation="KJV"
    )


def get_passage_text(passage_node):
    """Extract full text content from a PassageNode's children."""
    parts = []
    for child in passage_node.children:
        if hasattr(child, 'content'):
            parts.append(child.content)
    return ''.join(parts)


def run_split(raw_text, quotes):
    initial_text = create_text_node(raw_text)
    initial_para = create_paragraph_node(children=[initial_text])
    root = create_document_root(children=[initial_para], title="Test")
    root, _ = apply_passages_to_ast(root, raw_text, quotes, debug=True)
    
    nodes = []
    for child in root.children:
        for sub in child.children:
            if sub.type == "passage":
                nodes.append(("passage", get_passage_text(sub)))
            elif sub.type == "text":
                nodes.append(("text", sub.content))
    return nodes


def test_trailing_period():
    """Period after passage gets pushed to next text node."""
    print("TEST 1: Trailing period")
    raw_text = "Introduction text. For God so loved the world that he gave his only begotten Son. Conclusion text."
    
    # end_pos stops at word boundary (after "Son", before ".")
    verse_start = raw_text.find("For God so loved")
    verse_end = raw_text.find("Son") + len("Son")  # Does NOT include the period
    
    quote = make_quote(verse_start, verse_end, "John", 3, 16,
        "For God so loved the world that he gave his only begotten Son")
    
    nodes = run_split(raw_text, [quote])
    
    print(f"  Nodes:")
    for ntype, content in nodes:
        print(f"    {ntype}: {content!r}")
    
    # Check for the bug
    passage_content = next(c for t, c in nodes if t == "passage")
    text_after = [c for t, c in nodes if t == "text"]
    
    if not passage_content.endswith("."):
        print(f"  BUG DETECTED: Passage missing trailing period")
        if text_after and text_after[-1].startswith("."):
            print(f"  BUG CONFIRMED: Period pushed to next text node: {text_after[-1]!r}")
        return False
    else:
        print(f"  PASS: Passage correctly ends with period")
        return True


def test_trailing_comma():
    """Comma after passage gets pushed to next text node."""
    print("\nTEST 2: Trailing comma")
    raw_text = "He said in John 3:16 For God so loved the world, and then he continued preaching."
    
    verse_start = raw_text.find("For God so loved")
    verse_end = raw_text.find("world") + len("world")  # Before the comma
    
    quote = make_quote(verse_start, verse_end, "John", 3, 16,
        "For God so loved the world")
    
    nodes = run_split(raw_text, [quote])
    
    print(f"  Nodes:")
    for ntype, content in nodes:
        print(f"    {ntype}: {content!r}")
    
    passage_content = next(c for t, c in nodes if t == "passage")
    text_after = [c for t, c in nodes if t == "text"]
    
    if not passage_content.endswith(","):
        print(f"  BUG DETECTED: Passage missing trailing comma")
        if text_after and text_after[-1].startswith(","):
            print(f"  BUG CONFIRMED: Comma pushed to next text node")
        return False
    else:
        print(f"  PASS: Passage correctly ends with comma")
        return True


def test_trailing_semicolon():
    """Semicolon after passage gets pushed to next text node."""
    print("\nTEST 3: Trailing semicolon")
    raw_text = "He read the word; blessed are the meek; and then he moved on."
    
    verse_start = raw_text.find("blessed are the meek")
    verse_end = raw_text.find("meek") + len("meek")
    
    quote = make_quote(verse_start, verse_end, "Matthew", 5, 5,
        "blessed are the meek")
    
    nodes = run_split(raw_text, [quote])
    
    print(f"  Nodes:")
    for ntype, content in nodes:
        print(f"    {ntype}: {content!r}")
    
    passage_content = next(c for t, c in nodes if t == "passage")
    text_after = [c for t, c in nodes if t == "text"]
    
    if not passage_content.endswith(";"):
        print(f"  BUG DETECTED: Passage missing trailing semicolon")
        return False
    else:
        print(f"  PASS: Passage correctly ends with semicolon")
        return True


def test_multiple_trailing_punctuation():
    """Multiple punctuation chars (e.g., period + quote mark)."""
    print("\nTEST 4: Multiple trailing punctuation (period + closing quote)")
    raw_text = 'He said "For God so loved the world." Then he paused.'
    
    verse_start = raw_text.find("For God so loved")
    verse_end = raw_text.find("world") + len("world")
    
    quote = make_quote(verse_start, verse_end, "John", 3, 16,
        "For God so loved the world")
    
    nodes = run_split(raw_text, [quote])
    
    print(f"  Nodes:")
    for ntype, content in nodes:
        print(f"    {ntype}: {content!r}")
    
    passage_content = next(c for t, c in nodes if t == "passage")
    text_after = [c for t, c in nodes if t == "text"]
    
    # The period should be absorbed; closing quote is debatable but desirable
    if passage_content.endswith("world"):
        print(f"  BUG DETECTED: Passage missing trailing punctuation")
        return False
    else:
        print(f"  PASS: Passage ends with punctuation: {passage_content[-5:]!r}")
        return True


def test_no_trailing_punctuation():
    """No punctuation after passage — should not change anything."""
    print("\nTEST 5: No trailing punctuation (space follows)")
    raw_text = "He read For God so loved the world and then he left."
    
    verse_start = raw_text.find("For God so loved")
    verse_end = raw_text.find("world") + len("world")
    
    quote = make_quote(verse_start, verse_end, "John", 3, 16,
        "For God so loved the world")
    
    nodes = run_split(raw_text, [quote])
    
    print(f"  Nodes:")
    for ntype, content in nodes:
        print(f"    {ntype}: {content!r}")
    
    passage_content = next(c for t, c in nodes if t == "passage")
    text_after = [c for t, c in nodes if t == "text"]
    
    if passage_content.endswith("world"):
        print(f"  PASS: Passage correctly ends at word boundary (no punct to absorb)")
        # Make sure text-after doesn't start with weird chars
        if text_after and not text_after[-1][0].isalpha() and text_after[-1][0] != " ":
            print(f"  WARN: Text-after starts unexpectedly: {text_after[-1][:10]!r}")
        return True
    else:
        print(f"  UNEXPECTED: Passage content is {passage_content!r}")
        return False


def test_passage_at_end_of_text():
    """Passage at the very end with period."""
    print("\nTEST 6: Passage at end of text with period")
    raw_text = "Introduction. For God so loved the world."
    
    verse_start = raw_text.find("For God so loved")
    verse_end = raw_text.find("world") + len("world")
    
    quote = make_quote(verse_start, verse_end, "John", 3, 16,
        "For God so loved the world")
    
    nodes = run_split(raw_text, [quote])
    
    print(f"  Nodes:")
    for ntype, content in nodes:
        print(f"    {ntype}: {content!r}")
    
    passage_content = next(c for t, c in nodes if t == "passage")
    
    if passage_content.endswith("."):
        print(f"  PASS: Passage absorbed trailing period at end of text")
        return True
    else:
        print(f"  BUG DETECTED: Passage missing trailing period at end of text")
        return False


def test_exclamation_and_question_marks():
    """Exclamation and question marks after passage."""
    print("\nTEST 7: Exclamation mark after passage")
    raw_text = "He shouted Blessed are the pure in heart! The crowd cheered."
    
    verse_start = raw_text.find("Blessed are")
    verse_end = raw_text.find("heart") + len("heart")
    
    quote = make_quote(verse_start, verse_end, "Matthew", 5, 8,
        "Blessed are the pure in heart")
    
    nodes = run_split(raw_text, [quote])
    
    print(f"  Nodes:")
    for ntype, content in nodes:
        print(f"    {ntype}: {content!r}")
    
    passage_content = next(c for t, c in nodes if t == "passage")
    
    if passage_content.endswith("!"):
        print(f"  PASS: Passage absorbed trailing exclamation mark")
        return True
    else:
        print(f"  BUG DETECTED: Passage missing trailing exclamation mark")
        return False


def main():
    results = []
    results.append(("Trailing period", test_trailing_period()))
    results.append(("Trailing comma", test_trailing_comma()))
    results.append(("Trailing semicolon", test_trailing_semicolon()))
    results.append(("Multiple trailing punctuation", test_multiple_trailing_punctuation()))
    results.append(("No trailing punctuation", test_no_trailing_punctuation()))
    results.append(("Passage at end of text", test_passage_at_end_of_text()))
    results.append(("Exclamation mark", test_exclamation_and_question_marks()))
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, r in results if r)
    for name, r in results:
        print(f"  {'PASS' if r else 'FAIL'}: {name}")
    print(f"\n{passed}/{len(results)} passed")
    
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
