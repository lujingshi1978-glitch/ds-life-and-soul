"""Render the real transparent widget using synthetic WAV/HTTP, never devices."""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QTimer  # noqa: E402
from PySide6.QtGui import QFont, QFontDatabase  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402
from test_client import FIXTURE_TOKEN, Fixture  # noqa: E402

from feiyu_hotkey.overlay import VoiceOverlay  # noqa: E402
from feiyu_hotkey.voice import VoiceController, pcm_wave  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ["FEIYU_PET_TOKEN"] = FIXTURE_TOKEN
    fixture = Fixture()
    temporary = tempfile.TemporaryDirectory()
    app = QApplication([])
    app.setQuitOnLastWindowClosed(False)
    # The Windows offscreen plugin does not enumerate installed fonts. Load the
    # host's CJK font for this render only; no font is copied into the package.
    font_file = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "msyh.ttc"
    if font_file.is_file():
        font_id = QFontDatabase.addApplicationFont(str(font_file))
        families = QFontDatabase.applicationFontFamilies(font_id)
        if families:
            app.setFont(QFont(families[0], 10))
    errors = []
    report = {"kind": "real-Qt-widget-offscreen-render", "microphone_opened": False,
              "audio_played": False, "global_hotkey_registered": False, "external_requests": 0}

    def recorder(stop, handle):
        if not stop.wait(5):
            raise RuntimeError("fixture recorder was not stopped")
        handle.check()
        return pcm_wave(bytes(3200))

    window = VoiceOverlay(fixture.settings, Path(temporary.name) / "client.json", no_hotkey=True,
                          no_playback=True, controller=VoiceController(recorder=recorder))
    started = time.perf_counter()

    def begin():
        window.toggle_voice()
        assert not window.isVisible(), "voice hotkey must not show the chat window"
        assert window.caption.isVisible(), "recording status must be visible as a small caption"
        report["recording_status"] = window.status.text()
        window.caption.grab().save(str(args.output / "voice-recording.png"))
        window.toggle_voice()
        QTimer.singleShot(80, observe)

    def observe():
        try:
            if time.perf_counter() - started > 20:
                raise AssertionError("voice fixture did not finish")
            if window.controller.active_id is not None:
                QTimer.singleShot(80, observe)
                return
            assert "夹具识别文字" in window.output.toPlainText()
            assert "你好，同一个肥鱼" in window.output.toPlainText()
            assert window.send_button.isEnabled()
            assert not window.isVisible()
            assert "你好，同一个肥鱼" in window.caption.label.text()
            report["voice_does_not_raise_chat_window"] = True
            window.caption.grab().save(str(args.output / "reply-caption.png"))
            report["same_backend_voice_chain"] = [row[0] for row in fixture.received]
            report["reply_rendered"] = True
            report["translucent_widget"] = window.testAttribute(__import__("PySide6.QtCore", fromlist=["Qt"]).Qt.WidgetAttribute.WA_TranslucentBackground)
            window.grab().save(str(args.output / "voice-overlay.png"))
            window.resize(470, 360)
            app.processEvents()
            window.grab().save(str(args.output / "voice-overlay-narrow.png"))
            report["narrow_widget_size"] = [window.width(), window.height()]
            report["idle_wall_start"] = time.perf_counter()
            report["idle_cpu_start"] = time.process_time()
            report["idle_threads_including_fixture"] = threading.active_count()
            QTimer.singleShot(10000, finish)
        except Exception as error:  # noqa: BLE001 - test harness records assertions before cleanup
            errors.append(type(error).__name__ + ": " + str(error))
            finish()

    def finish():
        if "idle_cpu_start" in report:
            report["idle_cpu_seconds"] = round(time.process_time() - report.pop("idle_cpu_start"), 6)
            report["idle_wall_seconds"] = round(time.perf_counter() - report.pop("idle_wall_start"), 6)
        window.quit()

    QTimer.singleShot(100, begin)
    QTimer.singleShot(30000, finish)
    app.exec()
    fixture.close()
    temporary.cleanup()
    report["errors"] = errors
    report["normal_exit"] = True
    (args.output / "qt-voice-smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
