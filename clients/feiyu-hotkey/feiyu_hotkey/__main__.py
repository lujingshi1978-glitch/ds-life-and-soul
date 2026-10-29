from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .config import ConfigError, Settings, default_path, load_settings


def main() -> int:
    parser = argparse.ArgumentParser(description="肥鱼 Windows 快捷聊天窗（同一个 DSH 肥鱼后端）")
    parser.add_argument("--config", type=Path, default=default_path(), help="客户端设置文件（不含令牌）")
    parser.add_argument("--no-hotkey", action="store_true", help="不注册全局快捷键，用于 GUI 验收")
    parser.add_argument("--text-window", action="store_true", help="仅打开备用文字窗（不录音）")
    parser.add_argument("--startup-report", type=Path, help="可选：写入不含凭据的启动状态，供本机部署核验")
    args = parser.parse_args()
    error = ""
    try:
        settings = load_settings(args.config)
    except ConfigError as exception:
        settings, error = Settings(), str(exception)
    if not args.text_window:
        try:
            from PySide6.QtWidgets import QApplication

            from .overlay import VoiceOverlay
        except ImportError:
            error = "语音组件未安装，请先运行 install.cmd；当前打开备用文字窗口"
        else:
            app = QApplication([])
            app.setQuitOnLastWindowClosed(False)
            window = VoiceOverlay(settings, args.config, args.no_hotkey, initial_error=error)
            if args.no_hotkey or not window.tray.isVisible():
                window.show()
            if args.startup_report:
                report = {"version": 1, "pid": os.getpid(), "hotkey": settings.hotkey,
                          "registered": bool(window.hotkey and window.hotkey.registered),
                          "captionEnabled": settings.caption_enabled,
                          "mainWindowVisible": window.isVisible(), "trayVisible": window.tray.isVisible(),
                          "configurationError": bool(error)}
                args.startup_report.parent.mkdir(parents=True, exist_ok=True)
                temporary = args.startup_report.with_name(args.startup_report.name + f".{os.getpid()}.tmp")
                with temporary.open("x", encoding="utf-8") as stream:
                    json.dump(report, stream, ensure_ascii=False)
                os.replace(temporary, args.startup_report)
            return app.exec()
    import tkinter as tk

    from .ui import ChatWindow
    root = tk.Tk()
    ChatWindow(root, settings, args.config, args.no_hotkey, initial_error=error)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
