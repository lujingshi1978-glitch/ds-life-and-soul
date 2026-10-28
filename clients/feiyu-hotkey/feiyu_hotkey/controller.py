"""One request at a time; queued worker events never mutate Tk objects."""
from __future__ import annotations

import queue
import threading
from dataclasses import dataclass

from .config import ConfigError, Settings
from .transport import Cancelled, ChatError, RequestHandle, chat


@dataclass(frozen=True)
class Event:
    request_id: int
    kind: str
    text: str = ""
    audio: bytes | None = None


class ChatController:
    def __init__(self, transport=chat) -> None:
        self.events: queue.Queue[Event] = queue.Queue()
        self.transport = transport
        self.active_id: int | None = None
        self._serial = 0
        self._handle: RequestHandle | None = None
        self._thread: threading.Thread | None = None
        self.closed = False
        self.phase = "idle"

    def start(self, settings: Settings, text: str) -> int:
        if self.closed:
            raise ChatError("客户端已关闭")
        if self.active_id is not None:
            raise ChatError("上一条对话仍在处理")
        if not text.strip() or len(text) > 12000:
            raise ChatError("请输入 1 到 12000 字的文字")
        self._serial += 1
        request_id = self._serial
        self.active_id, self.phase = request_id, "waiting"
        handle = self._handle = RequestHandle()

        def work() -> None:
            try:
                self.transport(settings, text, handle, lambda value: self.events.put(Event(request_id, "delta", value)))
                handle.check()
                self.events.put(Event(request_id, "done"))
            except Cancelled:
                self.events.put(Event(request_id, "cancelled"))
            except (ChatError, ConfigError) as error:
                self.events.put(Event(request_id, "error", str(error)))
            except Exception:  # noqa: BLE001 - worker boundary must redact unexpected errors
                # Never surface exception repr: it may contain paths or credentials.
                self.events.put(Event(request_id, "error", "客户端未能完成请求，请检查设置"))

        self._thread = threading.Thread(target=work, name="feiyu-chat", daemon=True)
        self._thread.start()
        return request_id

    def receive(self, event: Event) -> Event | None:
        if self.closed or event.request_id != self.active_id:
            return None
        if self.phase == "cancelling":
            if event.kind not in ("done", "error", "cancelled"):
                return None
            event = Event(event.request_id, "cancelled")
        if event.kind in ("done", "cancelled", "error"):
            self.active_id, self._handle = None, None
            self.phase = event.kind
        elif event.kind == "delta":
            self.phase = "receiving"
        elif event.kind in ("recording", "transcribing", "waiting", "speaking"):
            self.phase = event.kind
        return event

    def cancel(self) -> bool:
        if self._handle is None:
            return False
        self.phase = "cancelling"
        self._handle.cancel()
        return True

    def close(self) -> None:
        self.closed = True
        self.cancel()
        if self._thread is not None:
            self._thread.join(timeout=1)
