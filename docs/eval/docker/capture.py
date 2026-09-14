"""Record unmodified output with monotonic timing, including PTY interaction and cancellation.

Input bytes are deliberately not recorded: terminal consent and authentication may
contain secrets. Capture authentication separately from publishable trial evidence.
"""

import argparse
import base64
import errno
import json
import os
from pathlib import Path
import pty
import selectors
import signal
import subprocess
import sys
import termios
import time
import tty


def capture(command, output, *, terminal=False, timeout=7200, env=None, cwd=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    receipt = {"command": command, "cwd": str(cwd or Path.cwd()),
               "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "terminal": terminal, "timeout_seconds": timeout}
    (output / "command.json").write_text(json.dumps(receipt, indent=2) + "\n")
    master = slave = None
    if terminal:
        master, slave = pty.openpty()
        if sys.stdin.isatty():
            import fcntl
            import struct
            size = fcntl.ioctl(sys.stdin.fileno(), termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
            fcntl.ioctl(slave, termios.TIOCSWINSZ, size)
    process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                               stdin=slave if terminal else subprocess.DEVNULL,
                               stdout=slave if terminal else subprocess.PIPE,
                               stderr=slave if terminal else subprocess.PIPE)
    selector = selectors.DefaultSelector()
    if terminal:
        os.close(slave)
        selector.register(master, selectors.EVENT_READ, "terminal")
        if sys.stdin.isatty():
            selector.register(sys.stdin, selectors.EVENT_READ, "input")
    else:
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    streams = {name: (output / (name + ".log")).open("wb")
               for name in (["terminal"] if terminal else ["stdout", "stderr"])}
    event_file = (output / "output.jsonl").open("w")
    first = last = None
    max_gap = 0.0
    interrupted = None
    stopping_at = None

    def stop(sig, _frame=None):
        nonlocal interrupted, stopping_at
        if stopping_at is None:
            interrupted = signal.Signals(sig).name
            stopping_at = time.monotonic()
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass

    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    saved_terminal = termios.tcgetattr(sys.stdin) if terminal and sys.stdin.isatty() else None
    if saved_terminal:
        tty.setraw(sys.stdin)
    try:
        while True:
            now = time.monotonic()
            if now - started >= timeout and stopping_at is None:
                stop(signal.SIGTERM)
                interrupted = "timeout"
            if stopping_at is not None and now - stopping_at >= 2:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                if now - stopping_at >= 3:
                    break
            for key, _ in selector.select(0.1):
                fd = key.fileobj if isinstance(key.fileobj, int) else key.fileobj.fileno()
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b""
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                if key.data == "input":
                    event_file.write(json.dumps({"seconds": time.monotonic() - started,
                                                 "stream": "input_activity"}) + "\n")
                    event_file.flush()
                    os.write(master, chunk)
                    continue
                elapsed = time.monotonic() - started
                if first is None:
                    first = elapsed
                max_gap = max(max_gap, elapsed - (last if last is not None else 0))
                last = elapsed
                streams[key.data].write(chunk)
                streams[key.data].flush()
                event_file.write(json.dumps({"seconds": elapsed, "stream": key.data,
                                             "bytes_base64": base64.b64encode(chunk).decode()}) + "\n")
                event_file.flush()
                target = sys.stderr.buffer if key.data == "stderr" else sys.stdout.buffer
                target.write(chunk)
                target.flush()
            outputs = [k for k in selector.get_map().values() if k.data != "input"]
            if process.poll() is not None and not outputs:
                break
        code = process.wait(timeout=5)
    finally:
        if process.poll() is None:
            stop(signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        if saved_terminal:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, saved_terminal)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        selector.close()
        if master is not None:
            os.close(master)
        for stream in streams.values():
            stream.close()
        event_file.close()
    duration = time.monotonic() - started
    receipt.update(exit_code=code, duration_seconds=duration, stop_reason=interrupted or "exited",
                   first_output_seconds=first,
                   max_silence_seconds=max(max_gap, duration - (last if last is not None else 0)))
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--terminal", action="store_true")
    parser.add_argument("--timeout", type=float, default=7200)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a command is required after --")
    result = capture(command, args.output, terminal=args.terminal, timeout=args.timeout)
    sys.exit(124 if result["stop_reason"] == "timeout" else max(0, result["exit_code"]) if result["exit_code"] >= 0 else 128 - result["exit_code"])
