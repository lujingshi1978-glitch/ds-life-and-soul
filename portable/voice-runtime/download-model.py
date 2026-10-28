"""Explicit installer-only official snapshot download; never used by ASR."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = "Systran/faster-whisper-small"
REVISION = "536b0662742c02347bc0e980a01041f333bce120"
FILES = ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"]


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("DestinationRequired")
    target = Path(sys.argv[1])
    if not target.is_absolute():
        raise ValueError("AbsoluteDestinationRequired")
    # Never inherit account tokens, user HuggingFace directories or mirrors.
    os.environ["HF_ENDPOINT"] = "https://huggingface.co"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "0"
    for key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACE_TOKEN"):
        os.environ.pop(key, None)
    if not os.environ.get("HF_HOME") or not os.environ.get("HF_HUB_CACHE"):
        raise ValueError("IsolatedCacheRequired")
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=REPO, revision=REVISION, allow_patterns=FILES,
                      local_dir=str(target), token=False,
                      endpoint="https://huggingface.co")
    print(json.dumps({"ok": True, "repo_id": REPO, "revision": REVISION}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - do not expose signed URLs or local account paths
        print(json.dumps({"error": type(error).__name__}))
        raise SystemExit(1) from None
