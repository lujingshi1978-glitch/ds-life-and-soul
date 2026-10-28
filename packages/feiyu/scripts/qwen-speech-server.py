"""Loopback-only persistent Qwen3-TTS worker. No filesystem paths accepted via HTTP."""
import argparse
import hmac
import io
import json
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--config", required=True)
args = parser.parse_args()
with open(args.config, encoding="utf-8-sig") as handle:
    config = json.load(handle)

import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel

if not torch.cuda.is_available():
    raise RuntimeError("CUDA GPU unavailable; refusing to silently run slow CPU inference")
torch.set_num_threads(6)
print("Loading Qwen3-TTS on " + torch.cuda.get_device_name(0), flush=True)
model = Qwen3TTSModel.from_pretrained(
    config["modelPath"], device_map="cuda:0", dtype=torch.bfloat16,
    attn_implementation="sdpa",
)
generation_lock = threading.Lock()
print("Model loaded", flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *values):
        # No chat text or authorization headers in access logs.
        print(fmt % values, flush=True)

    def reply(self, status, data, content_type="application/json"):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, "Bearer " + config["token"])

    def do_GET(self):
        if not self.authorized():
            return self.reply(401, {"error": "Unauthorized"})
        if self.path != "/health":
            return self.reply(404, {"error": "Not found"})
        self.reply(200, {"ready": True, "provider": "qwen3-tts", "device": torch.cuda.get_device_name(0), "busy": generation_lock.locked()})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {"error": "Unauthorized"})
        if self.path != "/speech":
            return self.reply(404, {"error": "Not found"})
        length = int(self.headers.get("Content-Length", 0))
        if length < 1 or length > 16384:
            return self.reply(400, {"error": "Invalid request size"})
        try:
            request = json.loads(self.rfile.read(length))
            text = request.get("text")
            style = request.get("style", "")
            if not isinstance(text, str) or not text.strip() or len(text) > 500:
                raise ValueError("Text must contain 1-500 characters")
            if not isinstance(style, str) or len(style) > 200:
                raise ValueError("Style must contain at most 200 characters")
        except (ValueError, TypeError):
            return self.reply(400, {"error": "Invalid text or style"})
        if not generation_lock.acquire(blocking=False):
            return self.reply(409, {"error": "正在生成另一条语音，请稍后重试"})
        started = time.monotonic()
        try:
            instruction = config.get("instruction", "自然口语，语调有起伏，避免播音腔。")
            if style:
                instruction += " 本句语气：" + style
            with torch.inference_mode():
                wavs, rate = model.generate_custom_voice(
                    text=text.strip(), language="Chinese", speaker=config.get("speaker", "Vivian"),
                    instruct=instruction, max_new_tokens=2048,
                )
            audio = io.BytesIO()
            sf.write(audio, wavs[0], rate, format="WAV", subtype="PCM_16")
            print(f"Speech generated: {len(wavs[0])/rate:.1f}s audio, {time.monotonic()-started:.1f}s elapsed", flush=True)
            self.reply(200, audio.getvalue(), "audio/wav")
        except Exception as error:
            print(f"Generation failed: {type(error).__name__}", flush=True)
            traceback.print_exc()
            self.reply(500, {"error": "Qwen3-TTS 合成失败：" + type(error).__name__})
        finally:
            generation_lock.release()


server = ThreadingHTTPServer(("127.0.0.1", config.get("port", 3101)), Handler)
print("Qwen3-TTS listening on http://127.0.0.1:" + str(server.server_port), flush=True)
server.serve_forever()
