"""
Tests for whisper_bridge.py dependency checks after migration to mlx-embeddings.

Verifies that:
- check_dependencies() reports mlx_embeddings status
- No torch or keybert checks remain
- Device is always 'mlx'
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from whisper_bridge import check_dependencies


class TestCheckDependencies(unittest.TestCase):
    """Test the check_dependencies function."""
    
    def test_returns_dict_with_required_keys(self):
        """check_dependencies should return a dict with 'dependencies', 'all_installed', and 'device'."""
        result = check_dependencies()
        
        self.assertIn('dependencies', result)
        self.assertIn('all_installed', result)
        self.assertIn('device', result)
    
    def test_checks_mlx_embeddings(self):
        """check_dependencies should check for mlx_embeddings."""
        result = check_dependencies()
        deps = result['dependencies']
        
        self.assertIn('mlx_embeddings', deps,
                      "Should check mlx_embeddings dependency")
    
    def test_checks_mlx_core(self):
        """check_dependencies should check for mlx."""
        result = check_dependencies()
        deps = result['dependencies']
        
        self.assertIn('mlx', deps,
                      "Should check mlx dependency")
    
    def test_checks_mlx_whisper(self):
        """check_dependencies should check for mlx_whisper."""
        result = check_dependencies()
        deps = result['dependencies']
        
        self.assertIn('mlx_whisper', deps,
                      "Should check mlx_whisper dependency")
    
    def test_no_torch_check(self):
        """check_dependencies should NOT check for torch."""
        result = check_dependencies()
        deps = result['dependencies']
        
        self.assertNotIn('torch', deps,
                        "Should NOT have torch in dependency checks")
    
    def test_no_keybert_check(self):
        """check_dependencies should NOT check for keybert."""
        result = check_dependencies()
        deps = result['dependencies']
        
        self.assertNotIn('keybert', deps,
                        "Should NOT have keybert in dependency checks")
    
    def test_no_sentence_transformers_check(self):
        """check_dependencies should NOT check for sentence_transformers."""
        result = check_dependencies()
        deps = result['dependencies']
        
        self.assertNotIn('sentence_transformers', deps,
                        "Should NOT have sentence_transformers in dependency checks")
    
    def test_no_nltk_check(self):
        """check_dependencies should NOT check for nltk."""
        result = check_dependencies()
        deps = result['dependencies']
        
        self.assertNotIn('nltk', deps,
                        "Should NOT have nltk in dependency checks")
    
    def test_device_is_mlx(self):
        """Device should always be 'mlx' (only supported platform)."""
        result = check_dependencies()
        
        self.assertEqual(result['device'], 'mlx',
                        "Device should be 'mlx'")
    
    def test_no_torch_device_key(self):
        """Result should not contain a 'torch_device' key."""
        result = check_dependencies()
        
        self.assertNotIn('torch_device', result,
                        "Should NOT have torch_device in result")


class TestNoRemovedDependenciesInBridge(unittest.TestCase):
    """Verify that removed dependencies are not referenced in whisper_bridge.py."""
    
    def test_no_sentence_transformers_in_bridge(self):
        """whisper_bridge.py should not reference sentence_transformers."""
        bridge_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'whisper_bridge.py')
        with open(bridge_path, 'r') as f:
            content = f.read()
        
        # Skip comments
        lines = [l for l in content.split('\n') if not l.strip().startswith('#')]
        code = '\n'.join(lines)
        
        self.assertNotIn('SentenceTransformer', code,
                        "whisper_bridge.py should not reference SentenceTransformer")
    
    def test_no_keybert_in_bridge(self):
        """whisper_bridge.py should not reference keybert."""
        bridge_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'whisper_bridge.py')
        with open(bridge_path, 'r') as f:
            content = f.read()
        
        lines = [l for l in content.split('\n') if not l.strip().startswith('#')]
        code = '\n'.join(lines)
        
        self.assertNotIn('KeyBERT', code,
                        "whisper_bridge.py should not reference KeyBERT")
        self.assertNotIn('keybert', code,
                        "whisper_bridge.py should not reference keybert")
    
    def test_no_torch_in_bridge(self):
        """whisper_bridge.py should not import torch."""
        bridge_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'whisper_bridge.py')
        with open(bridge_path, 'r') as f:
            content = f.read()
        
        lines = [l for l in content.split('\n') if not l.strip().startswith('#')]
        code = '\n'.join(lines)
        
        self.assertNotIn('import torch', code,
                        "whisper_bridge.py should not import torch")


if __name__ == '__main__':
    unittest.main()
