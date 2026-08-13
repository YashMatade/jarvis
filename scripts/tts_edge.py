#!/usr/bin/env python3
import sys
import os
import asyncio
import edge_tts

DEBUG = os.environ.get("TTS_DEBUG", "0") == "1"


def log(msg: str) -> None:
    if DEBUG:
        print(msg, file=sys.stderr)


async def main():
    # Voice passed as argv[1] from Node; falls back to Ryan if omitted.
    voice = sys.argv[1] if len(sys.argv) > 1 else "en-GB-RyanNeural"
    rate = os.environ.get("EDGE_TTS_RATE", "+40%")
    pitch = os.environ.get("EDGE_TTS_PITCH", "-5Hz")
    volume = os.environ.get("EDGE_TTS_VOLUME", "+0%")

    text = sys.stdin.read().strip()
    if not text:
        print("Error: no text provided on stdin", file=sys.stderr)
        sys.exit(1)

    log(f"voice={voice} rate={rate} pitch={pitch} chars={len(text)}")

    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
    )

    total_bytes = 0
    try:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                sys.stdout.buffer.write(chunk["data"])
                total_bytes += len(chunk["data"])
        sys.stdout.buffer.flush()
    except Exception as e:
        print(f"Error generating speech: {e}", file=sys.stderr)
        sys.exit(1)

    if total_bytes == 0:
        print("Error: no audio was produced", file=sys.stderr)
        sys.exit(1)

    log(f"done: {total_bytes} bytes written")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)