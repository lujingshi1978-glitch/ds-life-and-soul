"""Voice pipeline adapted from Merzlin's MIT pet/feiyu_voice.py (2026).

Retains Ctrl+Alt+Space toggle, 16kHz mono PCM, original silence/limit policy,
and 450-character speech segments. No device is opened until explicitly asked.
"""
from __future__ import annotations

import base64
import binascii
import io
import threading
import time
import wave

from .config import ConfigError, Settings
from .controller import ChatController, Event
from .transport import Cancelled, ChatError, RequestHandle, chat, post_audio


def pcm_wave(pcm: bytes) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16000)
        stream.writeframes(pcm)
    return out.getvalue()


def speech_segments(text: str) -> list[str]:
    return [text[i:i + 450] for i in range(0, len(text), 450)]


def record_microphone(stop: threading.Event, handle: RequestHandle) -> bytes:
    try:
        import numpy as np
        import sounddevice as sd
    except ImportError:
        raise ChatError("录音组件缺失，请运行客户端 install.cmd 安装语音依赖") from None
    blocks: list[bytes] = []
    start = last_voice = time.monotonic()
    heard_voice, overflow = threading.Event(), threading.Event()
    captured_bytes = 0

    def collect(data, _frames, _time, status):
        nonlocal last_voice, captured_bytes
        if status.input_overflow:
            overflow.set()
            stop.set()
            return
        block = bytes(data)
        if captured_bytes + len(block) > 59 * 32000:
            stop.set()
            return
        blocks.append(block)
        captured_bytes += len(block)
        if np.sqrt(np.mean(np.frombuffer(block, dtype=np.int16).astype(float) ** 2)) > 350:
            heard_voice.set()
            last_voice = time.monotonic()

    try:
        with sd.RawInputStream(samplerate=16000, channels=1, dtype="int16", blocksize=1600, callback=collect):
            while not stop.wait(0.05):
                handle.check()
                now = time.monotonic()
                if now - start >= 59 or (heard_voice.is_set() and now - last_voice > 1.4) or (not heard_voice.is_set() and now - start > 8):
                    break
        handle.check()
    except (OSError, sd.PortAudioError):
        handle.check()
        raise ChatError("无法打开默认麦克风，请检查设备和 Windows 麦克风权限") from None
    if overflow.is_set():
        raise ChatError("录音设备输入溢出，本轮未发送，请重试")
    if not heard_voice.is_set():
        raise ChatError("没听到说话，再按 Ctrl+Alt+Space 试一次")
    return pcm_wave(b"".join(blocks)[:59 * 32000])


class VoiceController(ChatController):
    def __init__(self, recorder=record_microphone, audio_transport=post_audio, chat_transport=chat):
        super().__init__(chat_transport)
        self.recorder = recorder
        self.audio_transport = audio_transport
        self.record_stop = threading.Event()

    def start_voice(self, settings: Settings) -> int:
        if self.closed or self.active_id is not None:
            raise ChatError("上一条对话仍在处理")
        self._serial += 1
        request_id = self._serial
        self.active_id, self.phase = request_id, "recording"
        self._handle = handle = RequestHandle()
        self.record_stop = stop = threading.Event()

        def emit(kind: str, text: str = "", audio: bytes | None = None):
            self.events.put(Event(request_id, kind, text, audio))

        def work() -> None:
            replied = False
            try:
                wav = self.recorder(stop, handle)
                handle.check()
                emit("transcribing")
                result = self.audio_transport(settings, "transcriptions", {"audio": base64.b64encode(wav).decode("ascii")}, handle)
                transcript = result.get("text", "")
                if not isinstance(transcript, str) or not transcript.strip() or len(transcript) > 12000:
                    raise ChatError("没识别出这句话，请再说一遍")
                handle.check()
                emit("transcript", transcript.strip())
                emit("waiting")
                answer: list[str] = []

                def delta(value):
                    answer.append(value)
                    emit("delta", value)

                self.transport(settings, transcript.strip(), handle, delta)
                handle.check()
                replied = True
                if settings.voice_playback and answer:
                    emit("speaking")
                    for part in speech_segments("".join(answer)):
                        handle.check()
                        result = self.audio_transport(settings, "speech", {"text": part}, handle)
                        if result.get("format") not in ("wav", "mp3") or not isinstance(result.get("audio"), str):
                            raise ChatError("后端语音播放格式无效")
                        try:
                            audio = base64.b64decode(result["audio"], validate=True)
                        except (ValueError, binascii.Error):
                            raise ChatError("后端语音数据无效") from None
                        if not audio or len(audio) > 6 * 1024 * 1024:
                            raise ChatError("后端语音数据大小无效")
                        handle.check()
                        emit("audio", result["format"], audio)
                emit("done")
            except Cancelled:
                emit("cancelled")
            except (ChatError, ConfigError) as error:
                emit("error", ("文字已回复，语音暂时没播出来：" if replied else "") + str(error))
            except Exception:  # noqa: BLE001 - redact unexpected device/provider error details
                emit("error", "语音未能完成，请检查录音组件和后端配置")

        self._thread = threading.Thread(target=work, name="feiyu-voice", daemon=True)
        self._thread.start()
        return request_id

    def finish_recording(self) -> bool:
        if self.active_id is None or self.phase != "recording":
            return False
        self.record_stop.set()
        return True

    def cancel(self) -> bool:
        self.record_stop.set()
        return super().cancel()
