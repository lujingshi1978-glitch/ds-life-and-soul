"""Loopback-only, authenticated, CPU ONNX embeddings. No network model loading."""
import argparse
import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


class Encoder:
    def __init__(self, directory, threads=2):
        directory = Path(directory).resolve()
        self.manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
        if self.manifest['format'] != 'cognition-bge-onnx-v1':
            raise ValueError('INVALID_MODEL_MANIFEST')
        for name, entry in self.manifest['files'].items():
            target = (directory / name).resolve()
            if not target.is_relative_to(directory) or hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
                raise ValueError('MODEL_CHECKSUM_MISMATCH')
        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, min(4, threads))
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(directory / 'onnx/model_quantized.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
        self.tokenizer = Tokenizer.from_file(str(directory / 'tokenizer.json'))
        self.tokenizer.enable_truncation(max_length=self.manifest['maxTokens'])
        self.tokenizer.enable_padding(pad_id=0, pad_token='[PAD]')
        self.lock = threading.Lock()
        self.encode(['本地模型预热'], 'search')

    def encode(self, texts, purpose):
        prefix = self.manifest['queryInstruction'] if purpose == 'search' else ''
        # A single bounded CPU inference lane avoids resource contention with V1.
        with self.lock:
            tokens = self.tokenizer.encode_batch([prefix + text for text in texts])
            fields = {'input_ids': [x.ids for x in tokens], 'attention_mask': [x.attention_mask for x in tokens], 'token_type_ids': [x.type_ids for x in tokens]}
            feeds = {spec.name: np.asarray(fields[spec.name], dtype=np.int64) for spec in self.session.get_inputs()}
            outputs = self.session.run(['last_hidden_state'], feeds)[0]
            vectors = outputs[:, 0, :].astype(np.float32)
            vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
            if vectors.shape != (len(texts), self.manifest['dimensions']) or not np.isfinite(vectors).all():
                raise ValueError('INVALID_MODEL_OUTPUT')
            return vectors.tolist(), sum(sum(x.attention_mask) for x in tokens)


def serve(config):
    encoder = Encoder(config['modelDirectory'], config.get('threads', 2))
    expected = 'Bearer ' + config['token']
    if len(config['token']) < 32:
        raise ValueError('TOKEN_REQUIRED')
    slots = threading.BoundedSemaphore(2)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log inputs, token or vectors.

        def reply(self, status, body):
            data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization', ''), expected)

        def do_GET(self):
            if not self.authorized():
                return self.reply(401, {'error': 'UNAUTHORIZED'})
            if self.path != '/health':
                return self.reply(404, {'error': 'NOT_FOUND'})
            return self.reply(200, {'ready': True, 'model': encoder.manifest['modelId'], 'dimensions': encoder.manifest['dimensions'], 'provider': 'CPUExecutionProvider', 'maxTokens': encoder.manifest['maxTokens']})

        def do_POST(self):
            self.connection.settimeout(20)
            if not self.authorized():
                return self.reply(401, {'error': 'UNAUTHORIZED'})
            if self.path != '/v1/embeddings':
                return self.reply(404, {'error': 'NOT_FOUND'})
            if not slots.acquire(blocking=False):
                return self.reply(429, {'error': 'BUSY'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 1 <= size <= 300000:
                    return self.reply(413, {'error': 'INVALID_BODY_SIZE'})
                body = json.loads(self.rfile.read(size))
                texts, purpose = body.get('input'), body.get('purpose', 'search')
                if body.get('model') != encoder.manifest['modelId']:
                    return self.reply(409, {'error': 'MODEL_MISMATCH'})
                if purpose not in ('search', 'index') or not isinstance(texts, list) or not 1 <= len(texts) <= 12 or any(not isinstance(x, str) or not x.strip() or len(x) > 6000 for x in texts):
                    return self.reply(400, {'error': 'INVALID_INPUT'})
                start = time.perf_counter()
                vectors, tokens = encoder.encode(texts, purpose)
                return self.reply(200, {'model': encoder.manifest['modelId'], 'data': [{'index': i, 'embedding': v} for i, v in enumerate(vectors)], 'usage': {'input_tokens': tokens}, 'elapsedMs': round((time.perf_counter() - start) * 1000, 2)})
            except Exception:
                return self.reply(400, {'error': 'EMBEDDING_REQUEST_FAILED'})
            finally:
                slots.release()

    server = ThreadingHTTPServer(('127.0.0.1', config['port']), Handler)
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'port': config['port'], 'model': encoder.manifest['modelId']}), flush=True)
    server.serve_forever(poll_interval=.5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    serve(json.loads(Path(parser.parse_args().config).read_text(encoding='utf-8-sig')))
