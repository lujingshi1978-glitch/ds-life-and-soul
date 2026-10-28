from __future__ import annotations

import json
import os
import queue
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from feiyu_hotkey.config import ConfigError, Settings, load_settings, read_token, save_settings
from feiyu_hotkey.controller import ChatController, Event
from feiyu_hotkey.hotkey import HotkeyService
from feiyu_hotkey.hotkey_spec import normalize, parse
from feiyu_hotkey.transport import Cancelled, ChatError, RequestHandle, chat, safe_message

FIXTURE_TOKEN = "fixture-only-not-a-real-token"


class Fixture:
    def __init__(self, mode="sse"):
        self.mode = mode
        self.received = []
        self.waiting = threading.Event()
        self.release = threading.Event()
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_POST(self):
                length = int(self.headers["Content-Length"])
                fixture.received.append((self.path, self.headers.get("Authorization"), json.loads(self.rfile.read(length))))
                if self.path.startswith("/pet/v1/audio/"):
                    import base64

                    from feiyu_hotkey.voice import pcm_wave
                    value = {"text": "夹具识别文字"} if self.path.endswith("transcriptions") else {"audio": base64.b64encode(pcm_wave(bytes(3200))).decode(), "format": "wav"}
                    raw = json.dumps(value, ensure_ascii=False).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                if fixture.mode == "wait":
                    fixture.waiting.set()
                    fixture.release.wait(5)
                    return
                if fixture.mode == "redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://invalid.example/steal")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if fixture.mode == "error":
                    raw = json.dumps({"error": {"message": "肥鱼目前休息或系统暂停"}}, ensure_ascii=False).encode()
                    self.send_response(503)
                    self.send_header("Content-Type", "application/json")
                elif fixture.mode == "json":
                    raw = json.dumps({"choices": [{"message": {"content": "完整回复"}}]}, ensure_ascii=False).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                else:
                    raw = b": comment\r\n\r\n"
                    for part in ("你好", "，同一个肥鱼"):
                        raw += ("data: " + json.dumps({"choices": [{"delta": {"content": part}}]}, ensure_ascii=False) + "\r\n\r\n").encode()
                    if fixture.mode != "truncated":
                        raw += b"data: [DONE]\r\n\r\n"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                self.wfile.flush()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def settings(self):
        return Settings(gateway_url=f"http://127.0.0.1:{self.server.server_port}/pet")

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)


class ConfigTests(unittest.TestCase):
    def test_local_capability_allowlist(self):
        for url in ("https://127.0.0.1:3116/pet", "http://localhost:3116/pet", "http://127.0.0.2:3116/pet", "http://127.0.0.1:3116/utility", "http://user@127.0.0.1:3116/pet", "http://127.0.0.1:3116/pet?token=x", "http://127.0.0.1/pet"):
            with self.subTest(url=url), self.assertRaises(ConfigError):
                Settings(gateway_url=url).validate()

    def test_roundtrip_and_missing_backend_credentials(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"FEIYU_PET_TOKEN": ""}):
            file = Path(folder) / "client.json"
            settings = Settings(credentials_file=str(Path(folder) / "not-created-yet.json"))
            save_settings(file, settings)
            self.assertEqual(load_settings(file), settings)
            with self.assertRaisesRegex(ConfigError, "无法读取所选凭据文件"):
                read_token(settings)
            self.assertNotIn("token", file.read_text())
            self.assertEqual(load_settings(Path(folder) / "absent.json"), Settings())

    def test_only_pet_credential_and_no_client_token(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"FEIYU_PET_TOKEN": ""}):
            file = Path(folder) / "credentials.json"
            file.write_text(json.dumps({"pet": FIXTURE_TOKEN, "utility": "must-never-use"}))
            self.assertEqual(read_token(Settings(credentials_file=str(file))), FIXTURE_TOKEN)
            file.write_text(json.dumps({"utility": "must-never-use"}))
            with self.assertRaises(ConfigError):
                read_token(Settings(credentials_file=str(file)))
            file.write_text('{"token":"do-not-copy"}')
            with self.assertRaises(ConfigError):
                load_settings(file)

    def test_header_injection_and_error_redaction(self):
        with patch.dict(os.environ, {"FEIYU_PET_TOKEN": "bad\r\nX-Test: evil"}), self.assertRaises(ConfigError):
            read_token(Settings())
        message = safe_message("Bearer abcd token=12345 http://127.0.0.1/private C:\\secret\\file " + FIXTURE_TOKEN, FIXTURE_TOKEN)
        for secret in ("abcd", "12345", FIXTURE_TOKEN, "C:\\secret", "http://"):
            self.assertNotIn(secret, message)


class TransportTests(unittest.TestCase):
    def call_fixture(self, mode="sse"):
        fixture = Fixture(mode)
        self.addCleanup(fixture.close)
        deltas = []
        with patch.dict(os.environ, {"FEIYU_PET_TOKEN": FIXTURE_TOKEN, "HTTP_PROXY": "http://invalid.example:9"}):
            chat(fixture.settings, "这轮文字", RequestHandle(), deltas.append)
        return fixture, deltas

    def test_sse_uses_pet_path_only_latest_user_no_prompts(self):
        fixture, deltas = self.call_fixture()
        self.assertEqual(deltas, ["你好", "，同一个肥鱼"])
        self.assertEqual(fixture.received, [("/pet/v1/chat/completions", "Bearer " + FIXTURE_TOKEN,
                                           {"model": "feiyu", "stream": True, "messages": [{"role": "user", "content": "这轮文字"}]})])

    def test_json_compatibility(self):
        _, deltas = self.call_fixture("json")
        self.assertEqual(deltas, ["完整回复"])

    def test_http_failure_and_no_redirect_or_retry(self):
        for mode, expected in (("error", "休息"), ("redirect", "HTTP 302"), ("truncated", "提前结束")):
            fixture = Fixture(mode)
            try:
                with patch.dict(os.environ, {"FEIYU_PET_TOKEN": FIXTURE_TOKEN}), self.assertRaisesRegex(ChatError, expected):
                    chat(fixture.settings, "text", RequestHandle(), lambda text: None)
                self.assertEqual(len(fixture.received), 1)
            finally:
                fixture.close()

    def test_cancel_interrupts_server_wait_without_waiting_for_timeout(self):
        fixture = Fixture("wait")
        self.addCleanup(fixture.close)
        handle, errors, complete = RequestHandle(), [], threading.Event()

        def work():
            try:
                chat(fixture.settings, "cancel", handle, lambda text: None)
            except ChatError as error:
                errors.append(error)
            finally:
                complete.set()

        with patch.dict(os.environ, {"FEIYU_PET_TOKEN": FIXTURE_TOKEN}):
            worker = threading.Thread(target=work, daemon=True)
            worker.start()
            self.assertTrue(fixture.waiting.wait(2))
            handle.cancel()
            self.assertTrue(complete.wait(2), "cancel must interrupt a socket blocked in response headers")
            worker.join(2)
        self.assertIsInstance(errors[0], Cancelled)


class ControllerTests(unittest.TestCase):
    def test_cancel_drops_late_content_then_allows_next_request(self):
        entered, release = threading.Event(), threading.Event()

        def transport(settings, text, handle, on_delta):
            entered.set()
            release.wait(2)
            on_delta("late text")

        controller = ChatController(transport)
        controller.start(Settings(), "first")
        self.assertTrue(entered.wait(2))
        with self.assertRaises(ChatError):
            controller.start(Settings(), "overlap")
        controller.cancel()
        release.set()
        self.assertIsNone(controller.receive(controller.events.get(timeout=2)))
        terminal = controller.receive(controller.events.get(timeout=2))
        self.assertEqual(terminal.kind, "cancelled")
        self.assertIsNone(controller.active_id)
        new_id = controller.start(Settings(), "next")
        self.assertIsNone(controller.receive(Event(new_id - 1, "delta", "old")))
        controller.close()
        self.assertIsNone(controller.receive(Event(new_id, "delta", "closed")))

    def test_empty_reply_and_worker_error_have_terminal_events(self):
        for should_fail, expected in ((False, "done"), (True, "error")):
            def transport(settings, text, handle, on_delta, fail=should_fail):
                if fail:
                    raise ChatError("后端休息")
            controller = ChatController(transport)
            controller.start(Settings(), "hello")
            event = controller.receive(controller.events.get(timeout=2))
            self.assertEqual(event.kind, expected)
            self.assertIsNone(controller.active_id)
            controller.close()


class FakeAPI:
    def __init__(self, success=True):
        self.success = success
        self.events = queue.Queue()
        self.calls = []

    def prepare(self):
        self.calls.append(("prepare", threading.get_ident()))
        return 123

    def register(self, modifiers, key):
        self.calls.append(("register", threading.get_ident(), modifiers, key))
        return self.success

    def next_event(self):
        return self.events.get(timeout=3)

    def wake(self, thread_id):
        self.events.put("quit")

    def unregister(self):
        self.calls.append(("unregister", threading.get_ident()))


class HotkeyTests(unittest.TestCase):
    def test_parser_requires_modifiers_and_ascii(self):
        self.assertEqual(normalize("alt+control+f9"), "Ctrl+Alt+F9")
        for value in ("F9", "Ctrl+ß", "Ctrl+P+Q", "Win", "Ctrl+你好"):
            self.assertIsNone(parse(value))

    def test_keyboard_boundary_uses_one_owner_thread_and_unregisters(self):
        api, called = FakeAPI(), threading.Event()
        service = HotkeyService(api)
        self.assertTrue(service.start("Ctrl+Alt+F9", called.set))
        api.events.put("hotkey")
        self.assertTrue(called.wait(2))
        service.close()
        self.assertFalse(service.registered)
        self.assertEqual([row[0] for row in api.calls], ["prepare", "register", "unregister"])
        self.assertEqual(len({row[1] for row in api.calls}), 1)

    def test_conflicting_hotkey_is_visible_and_does_not_unregister_others(self):
        api, service = FakeAPI(False), None
        service = HotkeyService(api)
        self.assertFalse(service.start("Ctrl+Alt+F9", lambda: None))
        self.assertIn("占用", service.error)
        service.close()
        self.assertNotIn("unregister", [row[0] for row in api.calls])


if __name__ == "__main__":
    unittest.main()
