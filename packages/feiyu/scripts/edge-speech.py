"""Synthesize a bounded JSON request from stdin; never put chat text in argv."""
import asyncio
import json
import sys
import edge_tts


async def main():
    request = json.load(sys.stdin)
    speech = edge_tts.Communicate(
        request["text"], request["voice"],
        rate=request.get("rate", "+0%"), pitch=request.get("pitch", "+0Hz"),
        connect_timeout=15, receive_timeout=30,
    )
    await speech.save(request["output"])


if __name__ == "__main__":
    asyncio.run(main())
