"""Derive timing and completion evidence without treating a zero exit as readiness."""

import argparse
import base64
import json
from pathlib import Path


def init_findings(result):
    if not isinstance(result, dict) or result.get("operation") != "apply" or not result.get("registered"):
        return ["initialization did not report an applied workspace registration"]
    preparation = result.get("preparation", {})
    if preparation.get("state") == "ready":
        return []
    blockers = preparation.get("blockers", [])
    return [item.get("message", item.get("id", "unfinished preparation")) for item in blockers] or ["preparation is not verified ready"]


def lines(path):
    if not path.exists():
        return []
    result = []
    for line in path.read_text(errors="replace").splitlines():
        try:
            result.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return result


def git_operations(directory):
    running, operations = {}, []
    for event in lines(directory / "git-trace.jsonl"):
        sid = event.get("sid")
        if event.get("event") == "start":
            argv = event.get("argv", [])
            if "clone" in argv or "fetch" in argv:
                running[sid] = {"argv": argv, "started_at": event.get("time"),
                                "operation": "clone" if "clone" in argv else "fetch"}
        elif event.get("event") == "exit" and sid in running:
            operations.append({**running.pop(sid), "duration_seconds": event.get("t_abs"),
                               "exit_code": event.get("code"), "finished_at": event.get("time")})
    return operations + [{**value, "exit_code": None, "incomplete": True} for value in running.values()]


def consent_timing(events, duration):
    waits, output_times = [], [0.0]
    waiting = None
    tail = ""
    for event in events:
        if event.get("stream") == "input_activity":
            if waiting is not None:
                waits.append((waiting, event["seconds"]))
                waiting = None
                tail = ""
            continue
        if "bytes_base64" not in event:
            continue
        output_times.append(event["seconds"])
        tail = (tail + base64.b64decode(event["bytes_base64"]).decode(errors="replace"))[-1000:]
        if waiting is None and "Trust this command" in tail and "[y/N]" in tail:
            waiting = event["seconds"]
    if waiting is not None:
        waits.append((waiting, duration))
    output_times.append(duration)
    gaps = []
    for before, after in zip(output_times, output_times[1:]):
        overlap = sum(max(0, min(after, end) - max(before, start)) for start, end in waits)
        gaps.append(max(0, after - before - overlap))
    human_wait = sum(end - start for start, end in waits)
    return {"consent_wait_intervals": waits, "consent_wait_seconds": human_wait,
            "active_duration_seconds": max(0, duration - human_wait),
            "active_max_silence_seconds": max(gaps, default=duration)}


def assess(directory):
    receipt = json.loads((directory / "receipt.json").read_text())
    result = {**receipt, "directory": str(directory), "git_operations": git_operations(directory)}
    command = receipt["command"]
    if len(command) > 1 and Path(command[0]).name in ["fx", "fx.js"] and command[1] == "init" and "--format" in command and command[command.index("--format") + 1] == "json":
        try:
            output = json.loads((directory / "stdout.log").read_text())
            result["init_problems"] = init_findings(output)
        except (FileNotFoundError, json.JSONDecodeError):
            result["init_problems"] = ["no complete JSON result on stdout"]
    events = lines(directory / "output.jsonl")
    result.update(consent_timing(events, receipt["duration_seconds"]))
    result["input_activity_seconds"] = [event["seconds"] for event in events if event.get("stream") == "input_activity"]
    progress = []
    for event in events:
        encoded = event.get("bytes_base64")
        if encoded:
            text = base64.b64decode(encoded).decode(errors="replace")
            if "_progress" in text or any(f" {state}" in text for state in ["start", "done", "fail", "skip"]):
                progress.append({"seconds": event["seconds"], "text": text})
    result["progress_chunks"] = progress
    result["ux_flags"] = []
    if receipt.get("first_output_seconds") is None or receipt["first_output_seconds"] > 5:
        result["ux_flags"].append("first output exceeded 5 seconds")
    if receipt["max_silence_seconds"] > 15:
        result["ux_flags"].append("output silence exceeded 15 seconds; inspect input waits separately")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    rows = [assess(path.parent) for path in sorted((args.evidence / "rounds").glob("*/*/receipt.json"))]
    (args.evidence / "measurements.json").write_text(json.dumps({"commands": rows}, indent=2) + "\n")
    for row in rows:
        print(f"{Path(row['directory']).parent.name}/{Path(row['directory']).name}: "
              f"exit={row['exit_code']} duration={row['duration_seconds']:.2f}s "
              f"silence={row['max_silence_seconds']:.2f}s")
