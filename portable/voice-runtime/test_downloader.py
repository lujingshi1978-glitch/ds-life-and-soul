from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("feiyu_model_downloader", Path(__file__).with_name("download-model.py"))
DOWNLOADER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DOWNLOADER)


class DownloaderTests(unittest.TestCase):
    def test_official_revision_without_auth_uses_only_four_files(self):
        calls = []
        fake_hub = types.SimpleNamespace(snapshot_download=lambda **kwargs: calls.append(kwargs))
        with tempfile.TemporaryDirectory(prefix="feiyu-hf-test-") as folder:
            root = Path(folder)
            environment = {"HF_HOME": str(root / "hf"), "HF_HUB_CACHE": str(root / "hf" / "hub"),
                           "HF_TOKEN": "fixture-secret", "HF_ENDPOINT": "https://fixture.invalid"}
            with patch.dict(os.environ, environment), patch.dict(sys.modules, {"huggingface_hub": fake_hub}), patch.object(sys, "argv", ["download-model.py", str(root / "model")]):
                DOWNLOADER.main()
                self.assertNotIn("HF_TOKEN", os.environ)
                self.assertEqual(os.environ["HF_ENDPOINT"], "https://huggingface.co")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["repo_id"], "Systran/faster-whisper-small")
        self.assertEqual(calls[0]["revision"], "536b0662742c02347bc0e980a01041f333bce120")
        self.assertIs(calls[0]["token"], False)
        self.assertEqual(calls[0]["endpoint"], "https://huggingface.co")
        self.assertEqual(calls[0]["allow_patterns"], ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"])

    def test_rejects_relative_destination_and_missing_isolated_cache(self):
        with patch.object(sys, "argv", ["download-model.py", "relative-model"]), self.assertRaises(ValueError):
            DOWNLOADER.main()
        with tempfile.TemporaryDirectory(prefix="feiyu-hf-test-") as folder:
            with patch.dict(os.environ, {"HF_HOME": "", "HF_HUB_CACHE": ""}), patch.object(sys, "argv", ["download-model.py", str(Path(folder) / "model")]), self.assertRaises(ValueError):
                DOWNLOADER.main()


if __name__ == "__main__":
    unittest.main()
