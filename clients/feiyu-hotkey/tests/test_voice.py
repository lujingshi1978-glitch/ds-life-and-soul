from __future__ import annotations

import base64
import io
import os
import threading
import unittest
import wave
from dataclasses import replace
from unittest.mock import patch

from test_client import FIXTURE_TOKEN, Fixture

from feiyu_hotkey.config import Settings
from feiyu_hotkey.controller import Event
from feiyu_hotkey.transport import ChatError
from feiyu_hotkey.voice import VoiceController, pcm_wave, speech_segments


class VoiceTests(unittest.TestCase):
    def test_original_wave_format_segments_and_hotkey_default(self):
        with wave.open(io.BytesIO(pcm_wave(bytes(3200))), "rb") as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()), (1, 2, 16000, 1600))
        self.assertEqual([len(x) for x in speech_segments("鱼" * 1000)], [450, 450, 100])
        self.assertEqual(Settings().hotkey, "Ctrl+Alt+Space")

    def test_toggle_recording_to_stt_shared_chat_then_tts_without_devices(self):
        fixture = Fixture()
        self.addCleanup(fixture.close)
        entered = threading.Event()

        def fixture_recorder(stop, handle):
            entered.set()
            self.assertTrue(stop.wait(2))
            handle.check()
            return pcm_wave(bytes(3200))

        controller = VoiceController(recorder=fixture_recorder)
        with patch.dict(os.environ, {"FEIYU_PET_TOKEN": FIXTURE_TOKEN}):
            controller.start_voice(fixture.settings)
            self.assertTrue(entered.wait(2))
            self.assertEqual(controller.phase, "recording")
            self.assertTrue(controller.finish_recording())
            events = []
            while controller.active_id is not None:
                event = controller.receive(controller.events.get(timeout=3))
                if event:
                    events.append(event)
        self.assertEqual([row[0] for row in fixture.received], ["/pet/v1/audio/transcriptions", "/pet/v1/chat/completions", "/pet/v1/audio/speech"])
        self.assertEqual(fixture.received[1][2]["messages"], [{"role": "user", "content": "夹具识别文字"}])
        self.assertEqual(base64.b64decode(fixture.received[0][2]["audio"]), pcm_wave(bytes(3200)))
        self.assertIn("transcript", [event.kind for event in events])
        self.assertIn("audio", [event.kind for event in events])
        self.assertEqual(events[-1].kind, "done")
        controller.close()

    def test_cancel_recording_never_uploads_and_ignores_late_audio(self):
        entered = threading.Event()
        calls = []

        def fixture_recorder(stop, handle):
            entered.set()
            stop.wait(2)
            handle.check()
            return pcm_wave(bytes(3200))

        controller = VoiceController(recorder=fixture_recorder, audio_transport=lambda *args: calls.append(args))
        request_id = controller.start_voice(Settings())
        self.assertTrue(entered.wait(2))
        controller.cancel()
        self.assertIsNone(controller.receive(Event(request_id, "audio", "wav", b"fixture")))
        terminal = controller.receive(controller.events.get(timeout=2))
        self.assertEqual(terminal.kind, "cancelled")
        self.assertEqual(calls, [])
        controller.close()

    def test_tts_optional_and_failure_preserves_visible_chat(self):
        for playback in (False, True):
            calls = []

            def audio(settings, endpoint, body, handle, recorded=calls):
                recorded.append(endpoint)
                if endpoint == "speech":
                    raise ChatError("TTS组件未安装")
                return {"text": "fixture"}

            def chat(settings, text, handle, on_delta):
                on_delta("已经可见的回复")

            controller = VoiceController(recorder=lambda stop, handle: pcm_wave(bytes(3200)), audio_transport=audio, chat_transport=chat)
            controller.start_voice(replace(Settings(), voice_playback=playback))
            events = []
            while controller.active_id is not None:
                event = controller.receive(controller.events.get(timeout=2))
                if event:
                    events.append(event)
            self.assertIn("已经可见的回复", [event.text for event in events])
            self.assertEqual(events[-1].kind, "error" if playback else "done")
            if playback:
                self.assertIn("文字已回复", events[-1].text)
            self.assertEqual(calls, ["transcriptions", "speech"] if playback else ["transcriptions"])
            controller.close()


if __name__ == "__main__":
    unittest.main()
