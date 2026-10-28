"""Bounded, cancellable loopback HTTP. No proxy, redirect, retry or model brain."""
from __future__ import annotations

import http.client
import io
import json
import re
import select
import socket
import threading
import time
from collections.abc import Callable

from .config import Settings, read_token

MAX_BYTES = 2 * 1024 * 1024
MAX_LINE = 128 * 1024


class ChatError(RuntimeError):
    pass


class Cancelled(ChatError):
    pass


class _CancellableReader(io.RawIOBase):
    """Socket.makefile on Windows need not wake when another thread closes it.

    A select-based reader checks cancellation every 100ms, including while the
    HTTP parser is waiting for response headers or a partially received line.
    """
    def __init__(self, owner) -> None:
        super().__init__()
        self.owner = owner

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:
        while True:
            self.owner.wait(read=True)
            try:
                return self.owner.socket.recv_into(buffer)
            except BlockingIOError:
                continue


class _CancellableSocket:
    def __init__(self, stream: socket.socket, handle: RequestHandle, timeout: int) -> None:
        self.socket, self.handle = stream, handle
        self.deadline = time.monotonic() + timeout
        stream.setblocking(False)

    def wait(self, read: bool) -> None:
        while True:
            self.handle.check()
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            try:
                ready = select.select([self.socket] if read else [], [] if read else [self.socket], [], min(remaining, 0.1))
            except (OSError, ValueError):
                self.handle.check()
                raise OSError("loopback socket closed") from None
            self.handle.check()
            if ready[0] or ready[1]:
                return

    def sendall(self, data: bytes) -> None:
        view = memoryview(data)
        while view:
            self.wait(read=False)
            try:
                sent = self.socket.send(view)
            except BlockingIOError:
                continue
            if not sent:
                raise OSError("loopback socket closed")
            view = view[sent:]

    def makefile(self, mode: str):
        if mode != "rb":
            raise ValueError("read mode required")
        return io.BufferedReader(_CancellableReader(self))

    def shutdown(self, how: int) -> None:
        self.socket.shutdown(how)

    def close(self) -> None:
        self.socket.close()


class RequestHandle:
    def __init__(self) -> None:
        self.cancelled = threading.Event()
        self._lock = threading.Lock()
        self._connection: http.client.HTTPConnection | None = None

    def attach(self, connection: http.client.HTTPConnection) -> None:
        with self._lock:
            self._connection = connection
            cancelled = self.cancelled.is_set()
        if cancelled:
            self.cancel()
            raise Cancelled("已取消")

    def check(self) -> None:
        if self.cancelled.is_set():
            raise Cancelled("已取消")

    def cancel(self) -> None:
        self.cancelled.set()
        with self._lock:
            connection = self._connection
        if connection is not None:
            try:
                if connection.sock is not None:
                    connection.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()


def safe_message(message: object, token: str = "") -> str:
    text = str(message)
    if token:
        text = text.replace(token, "[凭据已隐藏]")
    text = re.sub(r"Bearer\s+\S+", "Bearer [已隐藏]", text, flags=re.I)
    text = re.sub(r"(?:token|password|api[_-]?key|secret|cookie)\s*[:=]\s*\S+", "[凭据已隐藏]", text, flags=re.I)
    text = re.sub(r"https?://\S+|[A-Za-z]:[\\/]\S+", "[地址已隐藏]", text)
    return "".join(c for c in text if c.isprintable() or c == "\n")[:240]


def _error_message(raw: bytes, status: int, token: str) -> str:
    if status in (401, 403):
        return f"肥鱼凭据未获授权（HTTP {status}），请重新选择后端凭据文件"
    try:
        data = json.loads(raw)
        message = data.get("error", {}).get("message", "")
    except (ValueError, AttributeError):
        message = ""
    return f"后端暂时无法回复（HTTP {status}）" + ("：" + safe_message(message, token) if message else "")


def _event(data: str, token: str) -> tuple[str, bool]:
    if data == "[DONE]":
        return "", True
    try:
        value = json.loads(data)
        if "error" in value:
            raise ChatError(safe_message(value["error"].get("message", "后端流返回错误"), token))
        choices = value.get("choices", [])
        delta = choices[0].get("delta", {}) if choices else {}
        content = delta.get("content", "")
        if not isinstance(content, str):
            raise TypeError
        return content, False
    except (ValueError, KeyError, IndexError, AttributeError, TypeError):
        raise ChatError("后端流格式无效") from None


def post_audio(settings: Settings, endpoint: str, body: dict, handle: RequestHandle) -> dict:
    """Same pet credential and cancellation boundary for the existing audio API."""
    if endpoint not in ("transcriptions", "speech"):
        raise ChatError("语音接口无效")
    settings.validate()
    token = read_token(settings)
    handle.check()
    payload = json.dumps(body).encode("utf-8")
    if len(payload) > 2800000:
        raise ChatError("录音超过大小限制")
    connection = http.client.HTTPConnection("127.0.0.1", settings.port, timeout=3)
    try:
        connection.connect()
        connection.sock = _CancellableSocket(connection.sock, handle, settings.timeout_seconds)
        handle.attach(connection)
        connection.request("POST", "/pet/v1/audio/" + endpoint, payload,
                           {"Content-Type": "application/json", "Authorization": "Bearer " + token})
        response = connection.getresponse()
        if response.status != 200:
            raise ChatError(_error_message(response.read(4096), response.status, token))
        if response.getheader("Content-Type", "").split(";", 1)[0].lower().strip() != "application/json":
            raise ChatError("后端语音回复类型无效")
        raw = response.read(8 * 1024 * 1024 + 1)
        handle.check()
        if len(raw) > 8 * 1024 * 1024:
            raise ChatError("后端语音回复超过大小限制")
        try:
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise TypeError
            return result
        except (ValueError, TypeError):
            raise ChatError("后端语音回复格式无效") from None
    except (OSError, http.client.HTTPException) as error:
        if handle.cancelled.is_set():
            raise Cancelled("已取消") from None
        if isinstance(error, (socket.timeout, TimeoutError)):
            raise ChatError("语音处理超时；请求未自动重试") from None
        raise ChatError("无法连接肥鱼本机语音接口，或连接已中断") from None
    finally:
        connection.close()


def chat(settings: Settings, text: str, handle: RequestHandle, on_delta: Callable[[str], None]) -> None:
    settings.validate()
    if not text.strip() or len(text) > 12000:
        raise ChatError("请输入 1 到 12000 字的文字")
    token = read_token(settings)
    handle.check()
    connection = http.client.HTTPConnection("127.0.0.1", settings.port, timeout=3)
    try:
        # Literal IPv4 loopback avoids DNS rebinding and operating-system proxies.
        connection.connect()
        connection.sock = _CancellableSocket(connection.sock, handle, settings.timeout_seconds)
        handle.attach(connection)
        handle.check()
        payload = json.dumps({"model": "feiyu", "stream": True, "messages": [{"role": "user", "content": text}]}, ensure_ascii=False).encode("utf-8")
        connection.request("POST", "/pet/v1/chat/completions", payload, {"Content-Type": "application/json", "Accept": "text/event-stream", "Authorization": "Bearer " + token})
        response = connection.getresponse()
        if response.status != 200:
            raise ChatError(_error_message(response.read(4096), response.status, token))
        content_type = response.getheader("Content-Type", "").split(";", 1)[0].lower().strip()
        if content_type == "application/json":
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ChatError("回复超过大小限制")
            try:
                reply = json.loads(raw)["choices"][0]["message"]["content"]
                if not isinstance(reply, str):
                    raise TypeError
            except (ValueError, TypeError, KeyError, IndexError):
                raise ChatError("后端回复格式无效") from None
            handle.check()
            if reply:
                on_delta(reply)
            return
        if content_type != "text/event-stream":
            raise ChatError("后端回复类型无效")
        total, event_lines = 0, []
        while True:
            handle.check()
            line = response.readline(MAX_LINE + 1)
            total += len(line)
            if len(line) > MAX_LINE or total > MAX_BYTES:
                raise ChatError("回复超过大小限制")
            if not line:
                raise ChatError("回复连接提前结束；未自动重试，请检查后再决定是否重发")
            try:
                line_text = line.decode("utf-8").rstrip("\r\n")
            except UnicodeDecodeError:
                raise ChatError("后端流编码无效") from None
            if line_text.startswith("data:"):
                event_lines.append(line_text[5:].lstrip(" "))
            elif line_text == "" and event_lines:
                delta, done = _event("\n".join(event_lines), token)
                event_lines.clear()
                handle.check()
                if delta:
                    on_delta(delta)
                if done:
                    return
    except (OSError, http.client.HTTPException) as error:
        if handle.cancelled.is_set():
            raise Cancelled("已取消") from None
        if isinstance(error, (socket.timeout, TimeoutError)):
            raise ChatError("等待超时；请求未自动重试，请检查肥鱼后端状态") from None
        raise ChatError("无法连接肥鱼本机网关，或连接已中断；请检查后端是否启动") from None
    finally:
        connection.close()
