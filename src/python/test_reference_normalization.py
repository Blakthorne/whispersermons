#!/usr/bin/env python3
"""
Comprehensive tests for Bible reference normalization (AST-level).

Covers:
- BOOK_CHAPTER_COUNTS completeness and correctness
- SINGLE_CHAPTER_BOOKS correctness
- is_valid_chapter() edge cases
- All normalization rules (run-together, hyphen, comma, enumeration, period, spoken)
- Preservation rules (verbose speech, already-correct, single-chapter books)
- Idempotency (SEC-001)
- AST integration (TextNode normalization, PassageNode preservation)
- Multiple references in one segment
- References at text boundaries
- Coordinate-space immutability (REQ-008)
"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch
from typing import Optional

# Ensure src/python is on the path
sys.path.insert(0, os.path.dirname(__file__))

from bible_quote_processor import (
    BOOK_CHAPTER_COUNTS,
    SINGLE_CHAPTER_BOOKS,
    BOOK_ID_MAP,
    is_valid_chapter,
    ReferenceNormalization,
    normalize_bible_references_in_segment,
    BibleAPIClient,
    BibleReference,
    QuoteBoundary,
    process_text,
)
from document_model import (
    DocumentRootNode,
    ParagraphNode,
    TextNode,
    PassageNode,
    PassageMetadata,
    BibleReferenceMetadata,
    QuoteDetectionMetadata,
    ProcessingMetadata,
    create_text_node,
    create_paragraph_node,
    create_passage_node,
    create_document_root,
)
from ast_builder import (
    normalize_ast_references,
    build_ast,
    ASTBuilderConfig,
)


# ============================================================================
# MOCK FIXTURES
# ============================================================================

def create_mock_api_client(verify_results=None):
    """Create a mock BibleAPIClient that returns pre-configured results.

    Args:
        verify_results: Dict mapping "Book ch:v" to bool for verify_reference().
                        If None, verify_reference() always returns True.
    """
    mock = MagicMock(spec=BibleAPIClient)

    def mock_verify(book, chapter, verse=None):
        if verify_results is None:
            return True
        key = f"{book} {chapter}:{verse}" if verse else f"{book} {chapter}"
        return verify_results.get(key, True)

    mock.verify_reference.side_effect = mock_verify
    mock.get_verse.return_value = {'text': 'mock verse text'}
    mock.translation = 'KJV'
    return mock


# ============================================================================
# PHASE 1 TESTS: Chapter count validation data
# ============================================================================

class TestBookChapterCounts(unittest.TestCase):
    """TASK-004: Tests for BOOK_CHAPTER_COUNTS, SINGLE_CHAPTER_BOOKS, is_valid_chapter."""

    def test_all_66_books_present(self):
        """All 66 Protestant canon books must be in BOOK_CHAPTER_COUNTS."""
        self.assertEqual(len(BOOK_CHAPTER_COUNTS), 66)

    def test_all_book_id_map_books_covered(self):
        """Every book in BOOK_ID_MAP must be in BOOK_CHAPTER_COUNTS."""
        for book in BOOK_ID_MAP:
            self.assertIn(book, BOOK_CHAPTER_COUNTS,
                          f"{book} is in BOOK_ID_MAP but missing from BOOK_CHAPTER_COUNTS")

    def test_chapter_counts_are_positive(self):
        """All chapter counts must be positive integers."""
        for book, count in BOOK_CHAPTER_COUNTS.items():
            self.assertIsInstance(count, int, f"{book} has non-int chapter count")
            self.assertGreater(count, 0, f"{book} has non-positive chapter count")

    def test_well_known_chapter_counts(self):
        """Spot-check well-known chapter counts."""
        self.assertEqual(BOOK_CHAPTER_COUNTS['Genesis'], 50)
        self.assertEqual(BOOK_CHAPTER_COUNTS['Psalms'], 150)
        self.assertEqual(BOOK_CHAPTER_COUNTS['Matthew'], 28)
        self.assertEqual(BOOK_CHAPTER_COUNTS['Revelation'], 22)
        self.assertEqual(BOOK_CHAPTER_COUNTS['Romans'], 16)
        self.assertEqual(BOOK_CHAPTER_COUNTS['Jude'], 1)

    def test_single_chapter_books_correct(self):
        """SINGLE_CHAPTER_BOOKS must contain exactly the books with 1 chapter."""
        expected = {'Obadiah', 'Philemon', '2 John', '3 John', 'Jude'}
        self.assertEqual(SINGLE_CHAPTER_BOOKS, expected)

    def test_single_chapter_books_is_frozenset(self):
        self.assertIsInstance(SINGLE_CHAPTER_BOOKS, frozenset)

    def test_is_valid_chapter_valid(self):
        self.assertTrue(is_valid_chapter('Matthew', 1))
        self.assertTrue(is_valid_chapter('Matthew', 28))
        self.assertTrue(is_valid_chapter('Psalms', 150))

    def test_is_valid_chapter_invalid(self):
        self.assertFalse(is_valid_chapter('Matthew', 29))
        self.assertFalse(is_valid_chapter('Matthew', 0))
        self.assertFalse(is_valid_chapter('Matthew', -1))
        self.assertFalse(is_valid_chapter('Jude', 2))

    def test_is_valid_chapter_unknown_book(self):
        """Unknown books should return True (permissive fallback)."""
        self.assertTrue(is_valid_chapter('UnknownBook', 99))

    def test_is_valid_chapter_zero(self):
        self.assertFalse(is_valid_chapter('Genesis', 0))


# ============================================================================
# PHASE 2 TESTS: Core normalization rules
# ============================================================================

class TestRuntogetherNormalization(unittest.TestCase):
    """TASK-025: Run-together number normalization."""

    def test_romans_829(self):
        text = "He read Romans 829 to them."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Romans 8:29", result)
        self.assertEqual(len(norms), 1)
        self.assertEqual(norms[0].rule_applied, 'runtogether')

    def test_hebrews_725(self):
        text = "Hebrews 725 says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Hebrews 7:25", result)

    def test_matthew_633(self):
        text = "Matthew 633 is about seeking."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Matthew 6:33", result)

    def test_chapter_only_not_normalized(self):
        """Chapter-only reference 'Romans 8' must NOT be normalized."""
        text = "Romans 8 is a great chapter."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Romans 8", result)
        self.assertEqual(len(norms), 0)

    def test_two_digit_not_normalized(self):
        """Two-digit numbers are chapter-only, not run-together."""
        text = "Genesis 12 tells us."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(len(norms), 0)


class TestHyphenNormalization(unittest.TestCase):
    """TASK-026: Hyphen as chapter:verse separator."""

    def test_galatians_1_6(self):
        text = "Galatians 1-6 says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Galatians 1:6", result)

    def test_micah_5_2(self):
        text = "Read Micah 5-2."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Micah 5:2", result)

    def test_chapter_range_not_normalized(self):
        """Actual chapter ranges like 'Genesis 1-3' must NOT be normalized."""
        text = "Genesis 1-3 covers creation."
        result, norms = normalize_bible_references_in_segment(text)
        # Should not be normalized since 1-3 looks like chapters 1 through 3
        self.assertNotIn("Genesis 1:3", result)


class TestCommaNormalization(unittest.TestCase):
    """TASK-027: Comma as chapter:verse separator."""

    def test_revelation_19_16(self):
        text = "Revelation 19, 16 describes."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Revelation 19:16", result)
        self.assertEqual(len(norms), 1)
        self.assertEqual(norms[0].rule_applied, 'comma_separator')


class TestEnumerationAndNormalization(unittest.TestCase):
    """TASK-028: Enumeration with 'and'."""

    def test_romans_1_21_22(self):
        text = "Romans 1, 21 and 22 talks about."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Romans 1:21-22", result)
        self.assertEqual(len(norms), 1)
        self.assertEqual(norms[0].rule_applied, 'enumeration_and')

    def test_matthew_5_44_45(self):
        text = "Matthew 5, 44 and 45 says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Matthew 5:44-45", result)


class TestPeriodNormalization(unittest.TestCase):
    """TASK-029: Period as chapter:verse separator."""

    def test_romans_12_1(self):
        text = "Romans 12.1 says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Romans 12:1", result)
        self.assertEqual(norms[0].rule_applied, 'period_separator')

    def test_sentence_ending_period_not_consumed(self):
        """A period at end of sentence should not be consumed."""
        text = "He spoke about Romans 12. Everyone agreed."
        result, norms = normalize_bible_references_in_segment(text)
        # "Romans 12." should NOT be treated as "Romans 1:2" — no digit after period
        # The period pattern requires digits after the period
        self.assertEqual(len(norms), 0)


class TestSpokenNumberNormalization(unittest.TestCase):
    """TASK-030: Spoken verse numbers."""

    def test_romans_12_one(self):
        text = "Romans 12 one says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Romans 12:1", result)
        self.assertEqual(norms[0].rule_applied, 'spoken_number')

    def test_matthew_6_thirty_three(self):
        text = "Matthew 6 thirty-three says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Matthew 6:33", result)

    def test_genesis_1_twenty(self):
        text = "Genesis 1 twenty tells us."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Genesis 1:20", result)


# ============================================================================
# PRESERVATION TESTS
# ============================================================================

class TestVerboseSpeechPreservation(unittest.TestCase):
    """TASK-031: Verbose speech patterns must NOT be normalized."""

    def test_matthew_chapter_2_verses_1_through_12(self):
        text = "Matthew chapter 2 verses 1 through 12 describes."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)

    def test_isaiah_chapter_9(self):
        text = "Isaiah chapter 9 is powerful."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)


class TestAlreadyCorrectPreservation(unittest.TestCase):
    """TASK-032: Already-correct references must NOT be changed."""

    def test_john_3_16(self):
        text = "John 3:16 says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)

    def test_romans_8_28_29(self):
        text = "Romans 8:28-29 is comforting."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)


class TestSingleChapterBookPreservation(unittest.TestCase):
    """TASK-033: Single-chapter book references must NOT be normalized."""

    def test_jude_12(self):
        text = "Jude 12 warns us."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)

    def test_obadiah_4(self):
        text = "Obadiah 4 says."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)

    def test_philemon_15(self):
        text = "Philemon 15 is meaningful."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)


# ============================================================================
# IDEMPOTENCY TEST
# ============================================================================

class TestIdempotency(unittest.TestCase):
    """TASK-034: SEC-001 — normalization must be idempotent."""

    def test_double_normalization(self):
        text = "Romans 829 and Galatians 1-6 are important."
        result1, norms1 = normalize_bible_references_in_segment(text)
        result2, norms2 = normalize_bible_references_in_segment(result1)
        self.assertEqual(result1, result2)
        # Second pass should produce no new normalizations
        self.assertEqual(len(norms2), 0)

    def test_already_correct_idempotent(self):
        text = "John 3:16 and Romans 8:28"
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, text)
        self.assertEqual(len(norms), 0)


# ============================================================================
# AST INTEGRATION TEST
# ============================================================================

class TestASTIntegration(unittest.TestCase):
    """TASK-035: AST integration — TextNode normalization, PassageNode preservation."""

    def _make_test_ast(self):
        """Create a minimal AST with TextNodes and a PassageNode."""
        text_node = create_text_node("He read Romans 829 to the congregation.")
        text_para = create_paragraph_node(children=[text_node])

        passage_node = create_passage_node(
            content="For God so loved the world",
            reference=BibleReferenceMetadata(
                book='John', chapter=3, verse_start=16, verse_end=None,
                original_text='John 3:16',
                normalized_reference='John 3:16',
            ),
            detection=QuoteDetectionMetadata(
                confidence=0.95, confidence_level='high',
                translation='KJV', translation_auto_detected=False,
                verse_text='For God so loved the world',
                is_partial_match=False,
            ),
        )
        passage_para = create_paragraph_node(children=[passage_node])

        root = create_document_root(children=[text_para, passage_para])
        return root

    def test_text_node_normalized(self):
        root = self._make_test_ast()
        root, norms = normalize_ast_references(root)
        # The text node should be normalized
        text_para = root.children[0]
        text_node = text_para.children[0]
        self.assertIn("Romans 8:29", text_node.content)
        self.assertEqual(len(norms), 1)

    def test_passage_node_preserved(self):
        root = self._make_test_ast()
        root, norms = normalize_ast_references(root)
        # The passage node content must be unchanged
        passage_para = root.children[1]
        passage_node = passage_para.children[0]
        # PassageNode children are TextNodes within the passage
        passage_text = ''.join(
            c.content for c in passage_node.children if hasattr(c, 'content')
        )
        self.assertEqual(passage_text, "For God so loved the world")


# ============================================================================
# MULTIPLE REFERENCES AND BOUNDARY TESTS
# ============================================================================

class TestMultipleReferences(unittest.TestCase):
    """TASK-038: Multiple references in one text segment."""

    def test_two_references(self):
        text = "He read Romans 829 and then Galatians 1-6 to us."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertIn("Romans 8:29", result)
        self.assertIn("Galatians 1:6", result)
        self.assertEqual(len(norms), 2)


class TestReferenceBoundaries(unittest.TestCase):
    """TASK-039: References at text boundaries."""

    def test_reference_at_start(self):
        text = "Romans 829 says something."
        result, norms = normalize_bible_references_in_segment(text)
        self.assertTrue(result.startswith("Romans 8:29"))
        self.assertEqual(len(norms), 1)

    def test_reference_at_end(self):
        text = "He spoke about Romans 829"
        result, norms = normalize_bible_references_in_segment(text)
        self.assertTrue(result.endswith("Romans 8:29"))

    def test_reference_is_entire_text(self):
        text = "Romans 829"
        result, norms = normalize_bible_references_in_segment(text)
        self.assertEqual(result, "Romans 8:29")


# ============================================================================
# PROCESSING METADATA TEST
# ============================================================================

class TestProcessingMetadata(unittest.TestCase):
    """Test that ProcessingMetadata includes normalization_count."""

    def test_normalization_count_field(self):
        meta = ProcessingMetadata()
        self.assertEqual(meta.normalization_count, 0)

    def test_normalization_count_in_dict(self):
        meta = ProcessingMetadata()
        meta.normalization_count = 5
        d = meta.to_dict()
        self.assertIn('normalizationCount', d)
        self.assertEqual(d['normalizationCount'], 5)


# ============================================================================
# REFERENCE NORMALIZATION DATACLASS TEST
# ============================================================================

class TestReferenceNormalizationDataclass(unittest.TestCase):
    """Test the ReferenceNormalization dataclass."""

    def test_creation(self):
        norm = ReferenceNormalization(
            original_text="Romans 829",
            normalized_text="Romans 8:29",
            position=10,
            book="Romans",
            chapter=8,
            verse_start=29,
            rule_applied="runtogether",
        )
        self.assertEqual(norm.original_text, "Romans 829")
        self.assertEqual(norm.normalized_text, "Romans 8:29")
        self.assertEqual(norm.book, "Romans")
        self.assertEqual(norm.chapter, 8)
        self.assertEqual(norm.verse_start, 29)
        self.assertIsNone(norm.verse_end)
        self.assertEqual(norm.rule_applied, "runtogether")


if __name__ == '__main__':
    unittest.main()
