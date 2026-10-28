from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import types
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("feiyu_local_asr", Path(__file__).with_name("local-asr.py"))
ASR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASR)


class LocalAsrTests(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory)
        model = root / "local-model"
        model.mkdir()
        for name in ASR.REQUIRED_FILES:
            (model / name).write_text("{}" if name.endswith(".json") else "fixture-only")
        out = io.BytesIO()
        with wave.open(out, "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(16000)
            stream.writeframes(bytes(3200))
        source = root / "fixture.wav"
        source.write_bytes(out.getvalue())
        return model, source

    def test_missing_or_relative_model_never_calls_a_model_factory(self):
        for value in ("", "small", "https://huggingface.co/model"):
            with patch.dict(os.environ, {"FEIYU_ASR_MODEL": value}), self.assertRaises(ASR.AsrModelNotConfigured):
                ASR.transcribe("not-used", model_factory=lambda *args, **kwargs: self.fail("must not load"))

    def test_missing_tokenizer_fails_before_faster_whisper_fallback(self):
        with tempfile.TemporaryDirectory(prefix="feiyu-asr-test-") as folder:
            model, source = self.fixture(folder)
            (model / "tokenizer.json").unlink()
            with patch.dict(os.environ, {"FEIYU_ASR_MODEL": str(model)}), self.assertRaises(ASR.LocalModelIncomplete):
                ASR.transcribe(str(source), model_factory=lambda *args, **kwargs: self.fail("must not load or download"))

    def test_fixture_transcription_uses_only_explicit_local_model_and_offline_flags(self):
        with tempfile.TemporaryDirectory(prefix="feiyu-asr-test-") as folder:
            model, source = self.fixture(folder)
            calls = []

            class FakeModel:
                def __init__(self, directory, **kwargs):
                    calls.append((directory, kwargs))

                def transcribe(self, file, **kwargs):
                    self_file = file
                    assert self_file == str(source.resolve())
                    return [types.SimpleNamespace(start=0.0, end=0.1, text=" 合成夹具 ")], types.SimpleNamespace(language="zh")

            with patch.dict(os.environ, {"FEIYU_ASR_MODEL": str(model), "HF_TOKEN": "fixture-token"}):
                result = ASR.transcribe(str(source), model_factory=FakeModel)
                self.assertEqual(result["text"], "合成夹具")
                self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
                self.assertEqual(os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"], "1")
                self.assertNotIn("HF_TOKEN", os.environ)
            self.assertEqual(calls[0][0], str(model.resolve()))
            self.assertTrue(calls[0][1]["local_files_only"])
            self.assertEqual(calls[0][1]["compute_type"], "int8")

    def test_rejects_non_wav_and_invalid_model_json(self):
        with tempfile.TemporaryDirectory(prefix="feiyu-asr-test-") as folder:
            model, source = self.fixture(folder)
            with patch.dict(os.environ, {"FEIYU_ASR_MODEL": str(model)}):
                source.write_bytes(b"not audio")
                with self.assertRaises(ASR.InvalidWave):
                    ASR.transcribe(str(source), model_factory=lambda *args, **kwargs: self.fail("must not load"))
                (model / "tokenizer.json").write_text(json.dumps([]))
                with self.assertRaises(ASR.LocalModelIncomplete):
                    ASR.transcribe(str(source), model_factory=lambda *args, **kwargs: self.fail("must not load"))


if __name__ == "__main__":
    unittest.main()
