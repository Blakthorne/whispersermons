"""
Threshold calibration script for EmbeddingGemma-300m-4bit embeddings.

Systematically sweeps paragraph segmentation and tag extraction similarity
thresholds to find optimal values for the new model.

Usage:
    python calibrate_thresholds.py [path_to_transcript.txt]

If no transcript path is provided, uses test_mode_transcript.txt.
"""

import sys
import os
import time

# Ensure the python source directory is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import segment_into_paragraphs, extract_tags  # type: ignore[attr-defined]


def calibrate_paragraph_thresholds(text: str) -> list[dict]:
    """
    Sweep paragraph segmentation similarity_threshold from 0.20 to 0.80
    in 0.05 increments. Print paragraph count for each threshold.
    """
    print("=" * 70)
    print("PARAGRAPH SEGMENTATION THRESHOLD CALIBRATION")
    print("=" * 70)
    print(f"Text length: {len(text)} chars, ~{len(text.split())} words")
    print()
    
    results = []
    thresholds = [round(0.20 + i * 0.05, 2) for i in range(13)]  # 0.20 to 0.80
    
    for threshold in thresholds:
        start = time.time()
        result = segment_into_paragraphs(
            text,
            min_sentences_per_paragraph=5,
            similarity_threshold=threshold,
        )
        elapsed = time.time() - start
        
        paragraphs = result.split('\n\n')
        para_count = len(paragraphs)
        avg_len = sum(len(p.split()) for p in paragraphs) / max(para_count, 1)
        
        results.append({
            'threshold': threshold,
            'paragraphs': para_count,
            'avg_words': avg_len,
            'time_s': elapsed,
        })
        
        print(f"  threshold={threshold:.2f}: {para_count:3d} paragraphs, "
              f"avg {avg_len:.0f} words/para, {elapsed:.2f}s")
    
    print()
    print("Summary:")
    print(f"  {'Threshold':>10} | {'Paragraphs':>10} | {'Avg Words':>10}")
    print(f"  {'-' * 10}-+-{'-' * 10}-+-{'-' * 10}")
    for r in results:
        print(f"  {r['threshold']:10.2f} | {r['paragraphs']:10d} | {r['avg_words']:10.0f}")
    
    print()
    # Recommend a threshold that gives ~10-20 paragraphs for a typical sermon
    best = None
    for r in results:
        if 8 <= r['paragraphs'] <= 25:
            if best is None or abs(r['paragraphs'] - 15) < abs(best['paragraphs'] - 15):
                best = r
    
    if best:
        print(f"  ★ Recommended threshold: {best['threshold']:.2f} "
              f"({best['paragraphs']} paragraphs)")
    else:
        print("  ⚠️  No threshold produced 8-25 paragraphs. Review results above.")
    
    return results


def calibrate_tag_thresholds(text: str) -> list[dict]:
    """
    Sweep tag extraction min_similarity from 0.25 to 0.60
    in 0.05 increments. Print tag results for each threshold.
    """
    print()
    print("=" * 70)
    print("TAG EXTRACTION THRESHOLD CALIBRATION")
    print("=" * 70)
    print()
    
    results = []
    thresholds = [round(0.25 + i * 0.05, 2) for i in range(8)]  # 0.25 to 0.60
    
    for threshold in thresholds:
        start = time.time()
        tags = extract_tags(
            text,
            max_tags=15,
            verbose=False,
            semantic_threshold=threshold,
        )
        elapsed = time.time() - start
        
        results.append({
            'threshold': threshold,
            'tag_count': len(tags),
            'tags': tags,
            'time_s': elapsed,
        })
        
        tags_str = ", ".join(tags[:10])
        if len(tags) > 10:
            tags_str += f" ... (+{len(tags) - 10} more)"
        print(f"  threshold={threshold:.2f}: {len(tags):2d} tags, {elapsed:.2f}s")
        print(f"    → {tags_str}")
    
    print()
    print("Summary:")
    print(f"  {'Threshold':>10} | {'Tags':>5} | Top Themes")
    print(f"  {'-' * 10}-+-{'-' * 5}-+-{'-' * 40}")
    for r in results:
        top = ", ".join(r['tags'][:5])
        print(f"  {r['threshold']:10.2f} | {r['tag_count']:5d} | {top}")
    
    print()
    # Recommend a threshold that gives ~5-10 tags
    best = None
    for r in results:
        if 5 <= r['tag_count'] <= 10:
            if best is None or abs(r['tag_count'] - 7) < abs(best['tag_count'] - 7):
                best = r
    
    if best:
        print(f"  ★ Recommended threshold: {best['threshold']:.2f} "
              f"({best['tag_count']} tags)")
    else:
        print("  ⚠️  No threshold produced 5-10 tags. Review results above.")
    
    return results


def main():
    """Run threshold calibration on the test transcript."""
    # Determine transcript path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    if len(sys.argv) > 1:
        transcript_path = sys.argv[1]
    else:
        transcript_path = os.path.join(script_dir, 'test_mode_transcript.txt')
    
    if not os.path.exists(transcript_path):
        print(f"Error: Transcript not found at {transcript_path}")
        print(f"Usage: python calibrate_thresholds.py [path_to_transcript.txt]")
        sys.exit(1)
    
    print(f"Loading transcript: {transcript_path}")
    with open(transcript_path, 'r') as f:
        text = f.read()
    
    print(f"Transcript loaded: {len(text)} chars, ~{len(text.split())} words")
    print()
    
    # Pre-load the embedding model once
    print("Pre-loading EmbeddingGemma-300m-4bit model...")
    from embedding_model import load_model
    start = time.time()
    load_model()
    print(f"Model loaded in {time.time() - start:.1f}s")
    print()
    
    # Run calibration sweeps
    para_results = calibrate_paragraph_thresholds(text)
    tag_results = calibrate_tag_thresholds(text)
    
    print()
    print("=" * 70)
    print("CALIBRATION COMPLETE")
    print("=" * 70)
    print()
    print("Next steps:")
    print("  1. Review the recommended thresholds above")
    print("  2. Update similarity_threshold default in segment_into_paragraphs()")
    print("  3. Update semantic_threshold default in extract_tags()")
    print("  4. Re-run tests to verify quality with new thresholds")


if __name__ == '__main__':
    main()
