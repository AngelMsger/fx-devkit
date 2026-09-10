"""Prepare independent feature checkouts at merge bases from a private case file."""

import argparse
import json
import re
from pathlib import Path
import shutil
import subprocess


def read_case(file: Path) -> dict[str, dict[str, str]]:
    data = json.loads(file.read_text())
    entries = data.get("repos")
    if not isinstance(entries, list) or not entries:
        raise SystemExit("Case JSON must contain a non-empty repos array.")
    cases = {}
    for item in entries:
        name = item.get("name") if isinstance(item, dict) else None
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            raise SystemExit("Each case repository needs a simple directory name.")
        if name in cases or not all(isinstance(item.get(key), str) and item[key] for key in ("source", "target")):
            raise SystemExit("Repository names must be unique and source/target revisions are required.")
        cases[name] = item
    return cases


def git(cwd: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=cwd, text=True, stderr=subprocess.PIPE
    ).strip()


def clone_at_base(project: Path, root: Path, repo: str, case: dict[str, str]) -> dict[str, str]:
    source = project / repo
    checkout = root / repo
    head = git(source, "rev-parse", "--verify", "--end-of-options", case["source"] + "^{commit}")
    target = git(source, "rev-parse", "--verify", "--end-of-options", case["target"] + "^{commit}")
    base = git(source, "merge-base", head, target)
    git(root, "clone", "--quiet", "--shared", "--no-checkout", str(source), str(checkout))
    git(checkout, "remote", "remove", "origin")
    remotes = git(source, "remote").splitlines()
    for name in ("upstream", "origin"):
        if name in remotes:
            git(checkout, "remote", "add", name, git(source, "remote", "get-url", name))
    git(checkout, "checkout", "--quiet", "-B", case.get("branch", "evaluation"), base)
    return {
        "base": base,
        "reference_source": head,
        "status": git(checkout, "status", "--short"),
    }


def prepare(project: Path, manifest: Path, destination: Path, cases: dict[str, dict[str, str]]) -> None:
    if destination.exists():
        raise SystemExit("Evaluation directory already exists; choose a new root.")
    root = destination / "root"
    home = destination / "home"
    source = home / "workspaces/fx-eval/source"
    root.mkdir(parents=True)
    source.parent.mkdir(parents=True)
    shutil.copytree(manifest, source, ignore=shutil.ignore_patterns(".git"))
    config = {
        "default_workspace": "fx-eval",
        "workspaces": {"fx-eval": {"root": str(root), "source": str(manifest)}},
    }
    (home / "config.yaml").write_text(json.dumps(config))
    (source.parent / "local.yaml").write_text(json.dumps({"scope": {"repos": list(cases)}}))
    pins = {repo: clone_at_base(project, root, repo, case) for repo, case in cases.items()}
    for agent_directory in (".agents", ".claude"):
        directory = root / agent_directory
        directory.mkdir()
        (directory / "skills").symlink_to(source / "skills", target_is_directory=True)
    (destination / "pins.json").write_text(json.dumps(pins, indent=2) + "\n")
    print(json.dumps({"root": str(root), "pins": pins}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--case", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source_root.resolve(), args.manifest.resolve(), args.root.resolve(), read_case(args.case))


if __name__ == "__main__":
    main()
