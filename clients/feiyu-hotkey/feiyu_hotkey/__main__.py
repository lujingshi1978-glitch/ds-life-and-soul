from __future__ import annotations

import argparse
from pathlib import Path

from .config import ConfigError, Settings, default_path, load_settings


def main() -> int:
    parser = argparse.ArgumentParser(description="肥鱼 Windows 快捷聊天窗（同一个 DSH 肥鱼后端）")
    parser.add_argument("--config", type=Path, default=default_path(), help="客户端设置文件（不含令牌）")
    parser.add_argument("--no-hotkey", action="store_true", help="不注册全局快捷键，用于 GUI 验收")
    parser.add_argument("--text-window", action="store_true", help="仅打开备用文字窗（不录音）")
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
            window.show()
            return app.exec()
    import tkinter as tk

    from .ui import ChatWindow
    root = tk.Tk()
    ChatWindow(root, settings, args.config, args.no_hotkey, initial_error=error)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
