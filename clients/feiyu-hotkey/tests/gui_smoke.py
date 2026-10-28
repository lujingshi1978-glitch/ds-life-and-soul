"""Local Windows GUI acceptance harness. Never registers a global hotkey."""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import tkinter as tk
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_client import FIXTURE_TOKEN, Fixture  # noqa: E402

from feiyu_hotkey.ui import ChatWindow  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hold", type=int, default=10)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    os.environ["FEIYU_PET_TOKEN"] = FIXTURE_TOKEN
    fixture = Fixture()
    temp = tempfile.TemporaryDirectory()
    root = tk.Tk()
    window = ChatWindow(root, fixture.settings, Path(temp.name) / "client.json", no_hotkey=True)
    root.title("肥鱼 · 快捷对话 · 本地验收")
    report = {"hotkey_registered": False, "external_requests": 0, "python": sys.version.split()[0]}

    def start() -> None:
        window.input.insert("1.0", "你好，快捷聊天窗。")
        window.send()
        root.after(80, observe)

    def observe() -> None:
        if window.controller.active_id is not None:
            root.after(80, observe)
            return
        content = window.output.get("1.0", "end")
        assert "你好，同一个肥鱼" in content, "local fixture must render in the real Tk Text widget"
        assert str(window.send_button.cget("state")) == "normal"
        assert str(window.cancel_button.cget("state")) == "disabled"
        report["fixture_requests"] = len(fixture.received)
        report["reply_rendered"] = True
        # Verify visibility without globally registering a key or injecting input.
        window.hide()
        root.update_idletasks()
        report["fallback_taskbar_visible"] = root.state() == "iconic"
        window.toggle()
        root.update_idletasks()
        report["toggle_restored"] = root.state() == "normal"
        window.configure()
        root.update_idletasks()
        report["settings_opened"] = window.settings_dialog.winfo_exists() == 1
        window.settings_dialog.destroy()
        report["idle_wall_start"] = time.perf_counter()
        report["idle_cpu_start"] = time.process_time()
        report["thread_count_idle"] = __import__("threading").active_count()
        root.after(args.hold * 1000, finish)

    def finish() -> None:
        report["idle_cpu_seconds"] = round(time.process_time() - report.pop("idle_cpu_start"), 6)
        report["idle_wall_seconds"] = round(time.perf_counter() - report.pop("idle_wall_start"), 6)
        report["normal_exit"] = True
        window.quit()

    root.after(100, start)
    root.after((args.hold + 30) * 1000, window.quit)
    root.mainloop()
    fixture.close()
    temp.cleanup()
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
