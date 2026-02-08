"""
Unified Embedding Module for WhisperDesk

Encapsulates all mlx-embeddings logic in one place — model loading, text encoding,
numpy conversion. All other modules import from here.

Uses EmbeddingGemma-300m-4bit via mlx-embeddings for:
- Paragraph segmentation (task: "semantic_similarity")
- Tag extraction / theme matching (task: "classification")

This replaces both sentence-transformers models (all-MiniLM-L6-v2 and all-mpnet-base-v2)
with a single unified model that produces 768-dim embeddings with MTEB score ~69.67.

Output embeddings are numpy arrays for downstream cosine similarity computations.
"""

import numpy as np
from typing import List, Optional

# Model configuration
MODEL_NAME = "mlx-community/embeddinggemma-300m-4bit"

# Global model/tokenizer singletons (lazy-loaded)
_model = None
_tokenizer = None

# Task-specific prefixes for EmbeddingGemma
# These help the model produce better embeddings for different use cases
TASK_PREFIXES = {
    "semantic_similarity": "task: sentence similarity | query: ",
    "classification": "task: classification | query: ",
    "clustering": "task: clustering | query: ",
    "retrieval": "task: search result | query: ",
}


def load_model():
    """
    Lazily load the EmbeddingGemma model and tokenizer.
    
    Returns:
        Tuple of (model, tokenizer)
    """
    global _model, _tokenizer
    
    if _model is not None and _tokenizer is not None:
        return _model, _tokenizer
    
    from mlx_embeddings.utils import load
    
    print(f"Loading embedding model ({MODEL_NAME})...")
    _model, _tokenizer = load(MODEL_NAME)
    print(f"✓ Embedding model loaded")
    
    return _model, _tokenizer


def encode_texts(texts: List[str], task: str = "semantic_similarity",
                 batch_size: int = 64) -> np.ndarray:
    """
    Encode a list of texts into embeddings using EmbeddingGemma.
    
    Handles batching for large inputs (200+ sentences for paragraph segmentation).
    Uses task-specific prefixes for optimal embedding quality.
    
    Args:
        texts: List of text strings to encode
        task: Task type for EmbeddingGemma prefix. One of:
              "semantic_similarity" (for paragraph segmentation)
              "classification" (for tag extraction / theme matching)
              "clustering", "retrieval"
        batch_size: Maximum texts per batch (default: 64, prevents OOM)
    
    Returns:
        numpy array of shape (len(texts), 768) with float embeddings
    """
    model, tokenizer = load_model()
    
    # Apply task-specific prefix to each text
    prefix = TASK_PREFIXES.get(task, "")
    prefixed_texts = [f"{prefix}{text}" for text in texts]
    
    # Process in batches for large inputs
    if len(prefixed_texts) <= batch_size:
        return _encode_batch(prefixed_texts, model, tokenizer)
    
    # Batch processing
    all_embeddings = []
    for i in range(0, len(prefixed_texts), batch_size):
        batch = prefixed_texts[i:i + batch_size]
        batch_embeddings = _encode_batch(batch, model, tokenizer)
        all_embeddings.append(batch_embeddings)
    
    return np.vstack(all_embeddings)


def _encode_batch(texts: List[str], model, tokenizer) -> np.ndarray:
    """
    Encode a single batch of texts.
    
    Args:
        texts: List of texts (already with task prefix applied)
        model: The loaded mlx-embeddings model
        tokenizer: The loaded tokenizer (TokenizerWrapper from mlx-embeddings)
    
    Returns:
        numpy array of shape (len(texts), 768)
    """
    import mlx.core as mx
    
    # Tokenize using the underlying HuggingFace tokenizer's __call__ method.
    # We use return_tensors="np" then convert to MLX, because the GemmaTokenizer
    # (slow tokenizer) doesn't support batch_encode_plus or return_tensors="mlx".
    inputs = tokenizer._tokenizer(
        texts,
        return_tensors="np",
        padding=True,
        truncation=True,
        max_length=2048  # EmbeddingGemma supports 2048 tokens (4x the old 512)
    )
    
    # Convert numpy arrays to MLX arrays
    input_ids = mx.array(inputs["input_ids"])
    attention_mask = mx.array(inputs["attention_mask"]) if "attention_mask" in inputs else None
    
    # Run model
    if attention_mask is not None:
        outputs = model(input_ids, attention_mask=attention_mask)
    else:
        outputs = model(input_ids)
    
    # Extract normalized embeddings and convert to numpy
    # text_embeds are mean-pooled and normalized by mlx-embeddings
    embeddings = np.array(outputs.text_embeds)
    
    return embeddings


def encode_single(text: str, task: str = "semantic_similarity") -> np.ndarray:
    """
    Encode a single text into an embedding.
    
    Convenience wrapper around encode_texts for single-text use cases.
    
    Args:
        text: Text string to encode
        task: Task type for EmbeddingGemma prefix
    
    Returns:
        numpy array of shape (768,)
    """
    result = encode_texts([text], task=task)
    return result[0]
