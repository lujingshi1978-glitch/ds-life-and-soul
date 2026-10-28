"""Local-only 16kHz WAV ASR, with no account or download fallback."""
from __future__ import annotations

import json
import os
import socket
import sys
import wave
from pathlib import Path

REQUIRED_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")


class AsrModelNotConfigured(RuntimeError):
    pass


class LocalModelIncomplete(RuntimeError):
    pass


class InvalidWave(RuntimeError):
    pass


def configure_offline() -> None:
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE",
                "HF_HUB_DISABLE_IMPLICIT_TOKEN", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_XET"):
        os.environ[key] = "1"
    for key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACE_TOKEN"):
        os.environ.pop(key, None)


def local_model() -> Path:
    raw = os.environ.get("FEIYU_ASR_MODEL", "")
    if not raw or not Path(raw).is_absolute():
        raise AsrModelNotConfigured
    model = Path(raw)
    if model.is_symlink() or not model.is_dir():
        raise LocalModelIncomplete
    resolved = model.resolve(strict=True)
    for name in REQUIRED_FILES:
        file = model / name
        if file.is_symlink() or not file.is_file() or file.stat().st_size == 0 or file.resolve().parent != resolved:
            raise LocalModelIncomplete
    # Prevent faster-whisper's tokenizer-from-pretrained fallback before import.
    for name in ("config.json", "tokenizer.json"):
        try:
            value = json.loads((model / name).read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError
        except (OSError, ValueError):
            raise LocalModelIncomplete from None
    return resolved


def local_wave(raw: str) -> Path:
    source = Path(raw)
    if not source.is_absolute() or source.is_symlink() or not source.is_file() or source.stat().st_size > 2000000:
        raise InvalidWave
    try:
        with wave.open(str(source), "rb") as stream:
            if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (1, 2, 16000, "NONE"):
                raise InvalidWave
            if not 1600 <= stream.getnframes() <= 960000:
                raise InvalidWave
    except (OSError, EOFError, wave.Error):
        raise InvalidWave from None
    return source.resolve(strict=True)


def deny_network() -> None:
    """Defense in depth in this dedicated ASR process, never in the parent app."""
    def denied(*args, **kwargs):
        raise OSError("NetworkDisabledForLocalAsr")
    socket.create_connection = denied
    socket.socket.connect = denied
    socket.socket.connect_ex = denied


def transcribe(raw: str, model_factory=None) -> dict:
    configure_offline()
    model_dir, source = local_model(), local_wave(raw)
    if model_factory is None:
        deny_network()
        from faster_whisper import WhisperModel
        model_factory = WhisperModel
    model = model_factory(str(model_dir), device="cpu", compute_type="int8", cpu_threads=2,
                          num_workers=1, local_files_only=True)
    segments, info = model.transcribe(str(source), language=None, vad_filter=True, beam_size=1)
    output = [{"from": round(part.start, 2), "to": round(part.end, 2), "text": part.text.strip()} for part in segments]
    return {"source": "local-whisper-asr", "language": info.language,
            "segments": output, "text": " ".join(part["text"] for part in output)}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if args and args[0] == "asr":
        args = args[1:]
    if len(args) != 1:
        raise InvalidWave
    print(json.dumps(transcribe(args[0]), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - return class only, never paths/tokens/provider output
        print(json.dumps({"error": type(error).__name__}))
        raise SystemExit(1) from None
