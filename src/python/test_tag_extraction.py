"""
Tests for tag extraction with the new EmbeddingGemma model.

Tests that extract_tags() works correctly using semantic theme inference,
and that no KeyBERT dependency remains.
"""

import sys
import os
import unittest
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import extract_tags, get_semantic_themes, compute_concept_embeddings  # type: ignore[attr-defined]


class TestExtractTags(unittest.TestCase):
    """Test the high-level extract_tags() function."""
    
    def test_returns_tags_for_sermon_text(self):
        """extract_tags should return at least one tag for a substantive sermon text."""
        text = (
            "Today we are going to talk about the power of prayer and faith. "
            "Prayer is our direct communication with God. Through prayer, we can "
            "express our gratitude, bring our concerns before the Lord, and seek "
            "His guidance. Jesus taught his disciples to pray with faith and "
            "persistence. In the Garden of Gethsemane, Jesus prayed earnestly "
            "before his crucifixion. The Bible tells us to pray without ceasing. "
            "Paul encourages us to pray about everything with thanksgiving. "
            "Prayer transforms our hearts and minds. When we pray, we align our "
            "will with God's purposes. Let us commit to spending time in prayer "
            "each day, knowing that God hears every prayer."
        )
        
        tags = extract_tags(text, max_tags=10, verbose=False)
        
        self.assertIsInstance(tags, list)
        self.assertGreater(len(tags), 0, "Should return at least one tag")
        # All tags should be strings
        for tag in tags:
            self.assertIsInstance(tag, str)
    
    def test_max_tags_limit(self):
        """extract_tags should not return more than max_tags."""
        text = (
            "This sermon covers prayer, faith, love, grace, mercy, forgiveness, "
            "salvation, redemption, hope, peace, joy, patience, kindness, "
            "goodness, faithfulness, gentleness, and self-control. "
            "We also discuss discipleship, evangelism, worship, stewardship, "
            "fellowship, communion, baptism, and the gifts of the Holy Spirit. "
        ) * 5
        
        tags = extract_tags(text, max_tags=3, verbose=False)
        
        self.assertLessEqual(len(tags), 3, f"Should return ≤3 tags, got {len(tags)}")
    
    def test_empty_text_returns_empty_or_few_tags(self):
        """extract_tags with very short/empty text should handle gracefully."""
        tags = extract_tags("", max_tags=5, verbose=False)
        self.assertIsInstance(tags, list)
    
    def test_returns_unique_tags(self):
        """All returned tags should be unique (no duplicates)."""
        text = (
            "Grace is the unmerited favor of God. By grace we are saved through "
            "faith, and this is not from ourselves, it is the gift of God. "
            "Amazing grace, how sweet the sound. Grace teaches us to deny "
            "ungodliness. The grace of our Lord Jesus Christ be with you all. "
            "We are justified freely by his grace through the redemption that "
            "came by Christ Jesus."
        )
        
        tags = extract_tags(text, max_tags=10, verbose=False)
        
        self.assertEqual(len(tags), len(set(tags)),
                        f"Tags should be unique, got duplicates: {tags}")


class TestSemanticThemes(unittest.TestCase):
    """Test the semantic theme inference engine."""
    
    def test_returns_tuples_of_name_and_score(self):
        """get_semantic_themes should return a list of (name, score) tuples."""
        text = (
            "Jesus said to love your neighbor as yourself. This is the second "
            "greatest commandment. We show God's love through acts of kindness "
            "and compassion toward others."
        )
        
        themes = get_semantic_themes(text, top_k=5, min_similarity=0.1, verbose=False)
        
        self.assertIsInstance(themes, list)
        for item in themes:
            self.assertIsInstance(item, tuple)
            self.assertEqual(len(item), 2)
            name, score = item
            self.assertIsInstance(name, str)
            self.assertTrue(isinstance(score, (float, int, np.floating)),
                           f"Score should be numeric, got {type(score)}")
    
    def test_scores_are_ordered_descending(self):
        """Themes should be sorted by score descending."""
        text = (
            "Salvation is the gift of God. We are saved by grace through faith. "
            "Jesus died on the cross for our sins and rose again on the third day. "
            "Through his resurrection, we have the hope of eternal life."
        ) * 3
        
        themes = get_semantic_themes(text, top_k=10, min_similarity=0.1, verbose=False)
        
        if len(themes) >= 2:
            scores = [score for _, score in themes]
            for i in range(len(scores) - 1):
                self.assertGreaterEqual(scores[i], scores[i + 1],
                                       f"Scores not descending: {scores}")


class TestConceptEmbeddings(unittest.TestCase):
    """Test the theological concepts knowledge base."""
    
    def test_compute_concept_embeddings_returns_valid_data(self):
        """compute_concept_embeddings should return names and numpy arrays."""
        import numpy as np
        
        names, embeddings = compute_concept_embeddings()
        
        self.assertIsInstance(names, list)
        self.assertGreater(len(names), 0, "Should have at least one concept")
        self.assertIsInstance(embeddings, np.ndarray)
        self.assertEqual(len(names), embeddings.shape[0],
                        "Names and embeddings count should match")
    
    def test_concept_embeddings_are_cached(self):
        """Second call should return the same cached result."""
        names1, emb1 = compute_concept_embeddings()
        names2, emb2 = compute_concept_embeddings()
        
        self.assertIs(names1, names2, "Names should be the same cached list")


class TestNoKeyBERTDependency(unittest.TestCase):
    """Verify that KeyBERT has been fully removed."""
    
    def test_no_keybert_import_in_main(self):
        """main.py should not contain any keybert imports."""
        main_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'main.py')
        with open(main_path, 'r') as f:
            content = f.read()
        
        self.assertNotIn('keybert', content.lower(),
                        "main.py should not reference keybert")
        self.assertNotIn('KeyBERT', content,
                        "main.py should not reference KeyBERT")
    
    def test_no_sentence_transformers_import_in_main(self):
        """main.py should not contain any sentence_transformers imports."""
        main_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'main.py')
        with open(main_path, 'r') as f:
            content = f.read()
        
        self.assertNotIn('sentence_transformers', content,
                        "main.py should not reference sentence_transformers")
        self.assertNotIn('SentenceTransformer', content,
                        "main.py should not reference SentenceTransformer")
    
    def test_no_torch_import_in_main(self):
        """main.py should not import torch."""
        main_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'main.py')
        with open(main_path, 'r') as f:
            content = f.read()
        
        # Check for 'import torch' but allow mentions of torch in comments
        lines = content.split('\n')
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('#'):
                continue
            self.assertNotIn('import torch', stripped,
                            f"main.py should not import torch: {stripped}")


if __name__ == '__main__':
    unittest.main()
