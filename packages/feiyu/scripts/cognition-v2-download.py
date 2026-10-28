"""Download a pinned ONNX conversion; never imports or modifies V1."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

PROFILES = {
    'small-zh': {'repo': 'Xenova/bge-small-zh-v1.5',
                 'revision': '75c43b069aac4d136ba6bc1122f995fedcfd2781',
                 'upstream': 'BAAI/bge-small-zh-v1.5', 'dimensions': 512},
    'large-zh': {'repo': 'Xenova/bge-large-zh-v1.5',
                 'revision': 'a48549b3259a6165364f226599cd91f39923d5d5',
                 'upstream': 'BAAI/bge-large-zh-v1.5', 'dimensions': 1024},
}
FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json',
         'special_tokens_map.json', 'onnx/model_quantized.onnx']


def download(output, profile='small-zh'):
    spec = PROFILES[profile]
    repo, revision = spec['repo'], spec['revision']
    model_id = f"{spec['upstream']}@{revision}:onnx-int8:cls-l2-query-v1"
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'manifest.json'
    if manifest_path.exists() and json.loads(manifest_path.read_text(encoding='utf-8'))['modelId'] != model_id:
        raise ValueError('MODEL_DIRECTORY_ALREADY_HAS_DIFFERENT_PROFILE')
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true', timeout=60) as response:
        info = json.load(response)
    known = {entry['rfilename']: entry for entry in info['siblings']}
    recorded = {}
    for name in FILES:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = known[name].get('lfs', {}).get('sha256')
        if not target.exists() or (expected and hashlib.sha256(target.read_bytes()).hexdigest() != expected):
            temporary = target.with_suffix(target.suffix + '.partial')
            with urllib.request.urlopen(f'https://huggingface.co/{repo}/resolve/{revision}/{name}', timeout=120) as response, temporary.open('wb') as writer:
                while chunk := response.read(1024 * 1024):
                    writer.write(chunk)
            checksum = hashlib.sha256(temporary.read_bytes()).hexdigest()
            if expected and checksum != expected:
                raise RuntimeError('MODEL_CHECKSUM_MISMATCH')
            temporary.replace(target)
        recorded[name] = {'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size}
        print(f'Ready: {name} ({target.stat().st_size} bytes)', flush=True)
    manifest = {'format': 'cognition-bge-onnx-v1', 'modelId': model_id, 'upstreamModel': spec['upstream'],
                'onnxRepository': repo, 'revision': revision, 'dimensions': spec['dimensions'], 'maxTokens': 512,
                'pooling': 'cls', 'normalize': True, 'queryInstruction': '为这个句子生成表示以用于检索相关文章：', 'files': recorded}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--profile', choices=sorted(PROFILES), default='small-zh')
    args = parser.parse_args()
    download(args.output, args.profile)
