"""RegisterHotKey uses its own short-lived message thread, with clean teardown."""
from __future__ import annotations

import ctypes
import os
import threading
from ctypes import wintypes

from .hotkey_spec import MOD_NOREPEAT, parse

HOTKEY_ID = 0x5F19
WM_HOTKEY = 0x0312
WM_QUIT = 0x0012


class HotkeyError(RuntimeError):
    pass


class WindowsAPI:
    def __init__(self) -> None:
        if os.name != "nt":
            raise HotkeyError("全局快捷键仅支持 Windows；聊天窗口仍可使用")
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
        self.user32.RegisterHotKey.restype = wintypes.BOOL
        self.user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
        self.user32.UnregisterHotKey.restype = wintypes.BOOL
        self.user32.PeekMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT]
        self.user32.PeekMessageW.restype = wintypes.BOOL
        self.user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
        self.user32.GetMessageW.restype = ctypes.c_int
        self.user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.PostThreadMessageW.restype = wintypes.BOOL
        self.kernel32.GetCurrentThreadId.restype = wintypes.DWORD

    def prepare(self) -> int:
        message = wintypes.MSG()
        self.user32.PeekMessageW(ctypes.byref(message), None, 0, 0, 0)
        return int(self.kernel32.GetCurrentThreadId())

    def register(self, modifiers: int, key: int) -> bool:
        return bool(self.user32.RegisterHotKey(None, HOTKEY_ID, modifiers | MOD_NOREPEAT, key))

    def next_event(self) -> str:
        message = wintypes.MSG()
        result = self.user32.GetMessageW(ctypes.byref(message), None, 0, 0)
        if result == -1:
            raise HotkeyError("快捷键消息循环已停止，请重新启动客户端")
        if result == 0:
            return "quit"
        return "hotkey" if message.message == WM_HOTKEY and message.wParam == HOTKEY_ID else "other"

    def wake(self, thread_id: int) -> None:
        self.user32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)

    def unregister(self) -> None:
        self.user32.UnregisterHotKey(None, HOTKEY_ID)


class HotkeyService:
    def __init__(self, api=None) -> None:
        self.api = api
        self.registered = False
        self._thread: threading.Thread | None = None
        self._thread_id: int | None = None
        self._stop = threading.Event()
        self.error = ""

    def start(self, binding: str, callback, on_error=lambda value: None) -> bool:
        if self._thread is not None:
            raise HotkeyError("快捷键服务已经启动")
        parsed = parse(binding)
        if parsed is None:
            self.error = "快捷键格式无效"
            return False
        try:
            self.api = self.api or WindowsAPI()
        except HotkeyError as error:
            self.error = str(error)
            return False
        ready = threading.Event()

        def run() -> None:
            try:
                self._thread_id = self.api.prepare()
                if self._stop.is_set():
                    return
                if not self.api.register(*parsed):
                    self.error = "快捷键已被占用或被 Windows 保留，请在设置中换一个组合"
                    return
                self.registered = True
                ready.set()
                while not self._stop.is_set():
                    event = self.api.next_event()
                    if event == "quit":
                        break
                    if event == "hotkey" and not self._stop.is_set():
                        callback()
            except Exception:  # noqa: BLE001 - native callback boundary must keep UI recoverable
                self.error = "快捷键服务不可用；可从任务栏打开窗口并重新设置"
                on_error(self.error)
            finally:
                if self.registered:
                    self.api.unregister()
                self.registered = False
                ready.set()

        self._thread = threading.Thread(target=run, name="feiyu-hotkey", daemon=True)
        self._thread.start()
        if not ready.wait(timeout=2):
            self.error = "快捷键注册超时"
            self.close()
        return self.registered

    def close(self) -> None:
        self._stop.set()
        if self._thread_id is not None:
            self.api.wake(self._thread_id)
        if self._thread is not None:
            self._thread.join(timeout=2)
