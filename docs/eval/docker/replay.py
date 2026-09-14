"""Replay recorded output; cap pauses by default without changing recorded timings."""

import argparse
import base64
import json
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("events", type=Path)
    parser.add_argument("--speed", type=float, default=1)
    parser.add_argument("--max-gap", type=float, default=2)
    args = parser.parse_args()
    if args.speed <= 0 or args.max_gap < 0:
        parser.error("speed must be positive and max-gap must be nonnegative")
    previous = 0
    for line in args.events.read_text().splitlines():
        event = json.loads(line)
        if "bytes_base64" not in event:
            continue
        time.sleep(min(args.max_gap, max(0, event["seconds"] - previous) / args.speed))
        stream = sys.stderr.buffer if event["stream"] == "stderr" else sys.stdout.buffer
        stream.write(base64.b64decode(event["bytes_base64"]))
        stream.flush()
        previous = event["seconds"]


if __name__ == "__main__":
    main()
