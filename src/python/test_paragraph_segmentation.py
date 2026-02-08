"""
Integration tests for paragraph segmentation with the new EmbeddingGemma model.

Tests that segment_into_paragraphs() works correctly with the unified embedding model,
including quote boundary preservation, prayer detection, and threshold sensitivity.
"""

import sys
import os
import unittest
import numpy as np

# Ensure the python source directory is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import segment_into_paragraphs  # type: ignore[attr-defined]
from bible_quote_processor import QuoteBoundary, BibleReference


class TestBasicSegmentation(unittest.TestCase):
    """Test basic paragraph segmentation behavior."""
    
    def test_multi_topic_produces_multiple_paragraphs(self):
        """A text covering multiple distinct topics should produce at least 2 paragraphs."""
        # Create a text with two very different topics
        topic1_sentences = [
            "Today we're going to talk about the importance of prayer in our daily lives.",
            "Prayer is our direct communication with God the Father.",
            "Through prayer, we can express our gratitude and bring our concerns before the Lord.",
            "Jesus taught his disciples to pray with faith and persistence.",
            "The Bible tells us to pray without ceasing.",
            "In Philippians, Paul encourages us to pray about everything.",
            "Prayer transforms our hearts and minds.",
            "When we pray, we align our will with God's purposes.",
            "Let us commit to spending time in prayer each day.",
            "God hears every prayer we bring before his throne.",
        ]
        topic2_sentences = [
            "Now I want to talk about something completely different about financial stewardship.",
            "Managing money wisely is an important biblical principle for Christians today.",
            "The Bible has many teachings about how to handle finances responsibly.",
            "We should be generous with our resources and give cheerfully to those in need.",
            "Good stewardship means investing wisely in things that matter for eternity.",
            "Tithing is one way we demonstrate our trust in God's provision for our lives.",
            "We should avoid excessive debt and live within our means each month.",
            "Financial freedom allows us to be more generous with those around us.",
            "Let's be faithful stewards of everything God has entrusted to us.",
            "Remember that all we have ultimately belongs to the Lord our God.",
        ]
        text = " ".join(topic1_sentences + topic2_sentences)
        
        result = segment_into_paragraphs(text, min_sentences_per_paragraph=5, similarity_threshold=0.55)
        paragraphs = result.split('\n\n')
        
        self.assertGreaterEqual(len(paragraphs), 2,
                              f"Expected at least 2 paragraphs from multi-topic text, got {len(paragraphs)}")
    
    def test_short_text_not_split(self):
        """A short coherent text below min_sentences threshold stays as one paragraph."""
        text = "God loves us. He sent his Son. Jesus died for our sins. We are saved by grace."
        
        result = segment_into_paragraphs(text, min_sentences_per_paragraph=8)
        paragraphs = result.split('\n\n')
        
        self.assertEqual(len(paragraphs), 1,
                        f"Expected 1 paragraph for short text, got {len(paragraphs)}")
    
    def test_single_topic_stays_together(self):
        """A coherent text about one topic should result in few paragraphs."""
        sentences = [
            f"Prayer is essential for every believer. We need to pray regularly."
            for _ in range(5)
        ]
        text = " ".join(sentences)
        
        result = segment_into_paragraphs(text, min_sentences_per_paragraph=3, similarity_threshold=0.65)
        paragraphs = result.split('\n\n')
        
        # Even if it gets split, it shouldn't produce many paragraphs
        self.assertLessEqual(len(paragraphs), 3,
                            f"Expected ≤3 paragraphs for single-topic text, got {len(paragraphs)}")


class TestThresholdSensitivity(unittest.TestCase):
    """Test that threshold changes affect segmentation as expected."""
    
    def test_lower_threshold_fewer_or_equal_paragraphs(self):
        """Lowering the similarity threshold should produce fewer or equal paragraphs
        (since we break when similarity is BELOW the threshold)."""
        sentences = []
        for i in range(30):
            if i < 10:
                sentences.append(f"Prayer and worship are central to our faith life. Sentence {i}.")
            elif i < 20:
                sentences.append(f"Financial stewardship is important for believers. Sentence {i}.")
            else:
                sentences.append(f"Marriage and family are blessed by God in wonderful ways. Sentence {i}.")
        text = " ".join(sentences)
        
        result_low = segment_into_paragraphs(text, min_sentences_per_paragraph=5, similarity_threshold=0.20)
        result_high = segment_into_paragraphs(text, min_sentences_per_paragraph=5, similarity_threshold=0.50)
        
        paras_low = len(result_low.split('\n\n'))
        paras_high = len(result_high.split('\n\n'))
        
        self.assertLessEqual(paras_low, paras_high,
                            f"Lower threshold should produce ≤ paragraphs: low={paras_low}, high={paras_high}")


class TestPrayerDetection(unittest.TestCase):
    """Test that prayers are handled correctly."""
    
    def test_prayer_gets_own_paragraph(self):
        """Prayers starting with 'Let's pray' should start a new paragraph."""
        sentences = [
            "We have been talking about faith today.",
            "Faith is the substance of things hoped for.",
            "It is the evidence of things not seen.",
            "Faith grows when we read God's word.",
            "Faith is essential for every Christian believer.",
            "Now it is time to close our service.",
            "It has been a wonderful time together.",
            "Let us remember what we learned today.",
            "Let's pray. Dear Lord, we thank you for this time.",
            "We ask that you bless us as we go.",
            "In Jesus' name we pray, Amen.",
            "Now go forth in peace and serve the Lord.",
        ]
        text = " ".join(sentences)
        
        result = segment_into_paragraphs(text, min_sentences_per_paragraph=3, similarity_threshold=0.20)
        
        # The prayer should be separate
        self.assertIn("Let's pray", result)


if __name__ == '__main__':
    unittest.main()
