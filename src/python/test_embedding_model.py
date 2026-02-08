"""
Unit tests for the unified embedding model module (embedding_model.py).

Tests model loading, text encoding, output shapes, normalization,
and basic similarity sanity checks using EmbeddingGemma-300m-4bit via mlx-embeddings.
"""

import sys
import os
import unittest
import numpy as np

# Ensure the python source directory is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from embedding_model import load_model, encode_texts, encode_single, MODEL_NAME


class TestLoadModel(unittest.TestCase):
    """Test model loading."""
    
    def test_load_model_returns_model_and_tokenizer(self):
        """Verify model and tokenizer load without error."""
        model, tokenizer = load_model()
        self.assertIsNotNone(model)
        self.assertIsNotNone(tokenizer)
    
    def test_load_model_is_idempotent(self):
        """Verify calling load_model twice returns the same objects."""
        model1, tokenizer1 = load_model()
        model2, tokenizer2 = load_model()
        self.assertIs(model1, model2)
        self.assertIs(tokenizer1, tokenizer2)


class TestEncodeSingleText(unittest.TestCase):
    """Test single text encoding."""
    
    def test_encode_single_text_shape(self):
        """Verify output shape is (768,) for a single text."""
        embedding = encode_single("Hello, world!")
        self.assertEqual(embedding.shape, (768,))
        self.assertTrue(embedding.dtype in [np.float32, np.float16])
    
    def test_encode_single_returns_numpy(self):
        """Verify output is a numpy array."""
        embedding = encode_single("Test text")
        self.assertIsInstance(embedding, np.ndarray)


class TestEncodeBatch(unittest.TestCase):
    """Test batch text encoding."""
    
    def test_encode_batch_shape(self):
        """Verify batch of 5 texts produces (5, 768)."""
        texts = [
            "God is love",
            "The Lord loves us",
            "Faith in Christ",
            "Prayer and worship",
            "Biblical teaching"
        ]
        embeddings = encode_texts(texts)
        self.assertEqual(embeddings.shape, (5, 768))
    
    def test_encode_large_batch(self):
        """Verify 100+ texts works with internal batching."""
        texts = [f"Sentence number {i} about theology" for i in range(120)]
        embeddings = encode_texts(texts, batch_size=32)
        self.assertEqual(embeddings.shape, (120, 768))
    
    def test_encode_single_item_list(self):
        """Verify encoding a single-item list works."""
        embeddings = encode_texts(["Just one text"])
        self.assertEqual(embeddings.shape, (1, 768))


class TestEmbeddingQuality(unittest.TestCase):
    """Test embedding quality via similarity checks."""
    
    def _cosine_similarity(self, a, b):
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
    
    def test_similar_texts_have_high_similarity(self):
        """'God is love' and 'The Lord loves us' should have cosine sim > 0.5."""
        embeddings = encode_texts(["God is love", "The Lord loves us"])
        sim = self._cosine_similarity(embeddings[0], embeddings[1])
        self.assertGreater(sim, 0.5, f"Expected similarity > 0.5 for similar texts, got {sim}")
    
    def test_dissimilar_texts_have_lower_similarity(self):
        """'God is love' and 'The weather is sunny' should have lower similarity."""
        embeddings = encode_texts(["God is love", "The weather is sunny today"])
        sim = self._cosine_similarity(embeddings[0], embeddings[1])
        # Even different texts may have moderate similarity; just ensure it's lower than similar texts
        similar = encode_texts(["God is love", "The Lord loves us"])
        sim_similar = self._cosine_similarity(similar[0], similar[1])
        self.assertLess(sim, sim_similar, 
                       f"Dissimilar texts ({sim:.3f}) should have lower similarity than similar texts ({sim_similar:.3f})")
    
    def test_embeddings_finite(self):
        """Verify embeddings contain no NaN or Inf values."""
        embedding = encode_single("Test for finite values")
        self.assertTrue(np.all(np.isfinite(embedding)), "Embedding contains NaN or Inf values")


class TestTaskPrefixes(unittest.TestCase):
    """Test that different task prefixes produce different embeddings."""
    
    def test_different_tasks_produce_different_embeddings(self):
        """Verify 'semantic_similarity' and 'classification' tasks produce different embeddings."""
        text = "Following Jesus as a disciple"
        emb_sim = encode_texts([text], task="semantic_similarity")[0]
        emb_cls = encode_texts([text], task="classification")[0]
        
        # Embeddings should be different (different task prefixes)
        diff = np.linalg.norm(emb_sim - emb_cls)
        self.assertGreater(diff, 0.01, 
                          "Embeddings with different task prefixes should differ")


if __name__ == '__main__':
    unittest.main()
