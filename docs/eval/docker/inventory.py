"""Capture post-init readiness, exact checkout revisions, sizes and guide/Skill paths."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from capture import capture
from run import environment, name, write_json


def main(round_id, fx=None, label_prefix="inventory"):
    root, env = environment(round_id)
    workspace = root / "workspace"
    executable = fx or str(root / "home/.local/bin/fx")
    evidence = Path("/evidence/rounds") / round_id
    answers = {}
    for label, command in [
        ("self-info", ["self", "info"]), ("repos", ["repo", "list"]),
        ("status", ["status"]), ("doctor", ["doctor"]),
        ("skills", ["skill", "list"]), ("hooks", ["hook", "list"]),
        ("mcp", ["mcp", "list"]), ("manifest-validation", ["manifest", "validate", "--strict"]),
    ]:
        dest = evidence / (label_prefix + "-" + label)
        env["FX_TRACE"] = str(dest / "fx-trace.jsonl")
        receipt = capture([executable, *command, "--format", "json", "--no-input"], dest,
                          env=env, cwd=workspace, timeout=180)
        try:
            answers[label] = {"exit_code": receipt["exit_code"],
                              "data": json.loads((dest / "stdout.log").read_text())}
        except json.JSONDecodeError:
            answers[label] = {"exit_code": receipt["exit_code"], "data": None}
    repos = []
    listing = answers["repos"]["data"]
    if isinstance(listing, dict):
        for row in listing.get("items", []):
            if not row.get("picked"):
                continue
            directory = workspace / row["path"]
            item = {**row, "absolute_path": str(directory)}
            if row.get("exists"):
                for label, command in [("head", ["rev-parse", "HEAD"]),
                                       ("current_branch", ["branch", "--show-current"]),
                                       ("remotes", ["remote", "-v"]),
                                       ("objects", ["count-objects", "-v"]),
                                       ("git_status", ["status", "--porcelain=v1"])]:
                    result = subprocess.run(["git", "-C", str(directory), *command],
                                            env=env, text=True, capture_output=True, timeout=30)
                    item[label] = result.stdout.strip() if result.returncode == 0 else None
                result = subprocess.run(["du", "-sk", str(directory)], capture_output=True, text=True, timeout=120)
                item["disk_kib"] = int(result.stdout.split()[0]) if result.returncode == 0 else None
            repos.append(item)
    guides = []
    for relative in ["AGENTS.md", ".grok/skills", ".grok/hooks/fx.json"]:
        path = workspace / relative
        row = {"path": relative, "exists": path.exists(), "symlink": path.is_symlink(),
               "resolved": str(path.resolve())}
        if path.is_file():
            row["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        guides.append(row)
    write_json(evidence / (label_prefix + ".json"), {"queries": answers, "repositories": repos,
                "guides": guides, "root_has_git": (workspace / ".git").exists()})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", required=True, type=name)
    parser.add_argument("--fx")
    parser.add_argument("--label-prefix", default="inventory", type=name)
    args = parser.parse_args()
    main(args.round, args.fx, args.label_prefix)
