"""Exercise clone failure recovery and dirty/diverged preservation using local synthetic repositories.

Run inside the evaluation container with --fx pointing to an installed baseline
executable. No private manifest, credential, or remote service is used.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

from capture import capture
from run import environment, write_json


def main(fx):
    root, env = environment("faults")
    root.mkdir(exist_ok=False)
    (root / "home").mkdir()
    (root / "fx").mkdir()
    (root / "fx/config.yaml").write_text("agents: [grok]\n")
    env.update(GIT_AUTHOR_NAME="Fixture", GIT_AUTHOR_EMAIL="fixture@example.com",
               GIT_COMMITTER_NAME="Fixture", GIT_COMMITTER_EMAIL="fixture@example.com")
    env.pop("GIT_SSH_COMMAND", None)
    host = root / "host/team"
    host.mkdir(parents=True)

    def git(argv, cwd=root):
        return subprocess.check_output(["git", *argv], cwd=cwd, env=env, text=True, stderr=subprocess.PIPE).strip()

    for repo in ["clean", "recover"]:
        bare = host / (repo + ".git")
        author = root / ("author-" + repo)
        git(["init", "--bare", "-b", "main", str(bare)])
        git(["clone", str(bare), str(author)])
        (author / "README").write_text(repo + "\n")
        git(["add", "README"], author)
        git(["commit", "-m", "fixture baseline"], author)
        git(["push", "origin", "main"], author)
    source = root / "source/manifest"
    source.mkdir(parents=True)
    (source / "workspace.yaml").write_text(f"""schema_version: 2
providers:
  code-host: {{provider: local-git, vars: {{host: {host.parent}, user: fixture}}}}
defaults: {{upstream_project: team, branch: main}}
projects: {{team: {{label: Fixture, contact: fixture}}}}
repos:
  - {{name: clean, desc: Successful clone}}
  - {{name: recover, branch: missing-branch, desc: Failing clone}}
""")
    workspace = root / "workspace"
    workspace.mkdir()
    evidence = Path("/evidence/rounds/faults")
    evidence.mkdir(parents=True, exist_ok=False)
    write_json(evidence / "round.json", {"synthetic": True, "root": str(root)})

    def run(label, argv):
        dest = evidence / label
        env["FX_TRACE"] = str(dest / "fx-trace.jsonl")
        env["GIT_TRACE2_EVENT"] = str(dest / "git-trace.jsonl")
        result = capture([fx, *argv, "--format", "json", "--no-input"], dest, cwd=workspace, env=env, timeout=60)
        assert result["exit_code"] == 0, result
        return json.loads((dest / "stdout.log").read_text())

    partial = run("partial-init", ["init", str(workspace), "--from", str(source.parent), "--name", "faults"])
    assert partial["sync"]["summary"]["failed"] == 1, partial
    assert (workspace / "clean/.git").exists()
    runtime = root / "fx/workspaces/faults/source/manifest/workspace.yaml"
    runtime.write_text(runtime.read_text().replace("branch: missing-branch", "branch: main"))
    recovery = run("recovery", ["sync", "--only", "repos", "--no-refresh-manifest"])
    assert recovery["summary"]["failed"] == 0, recovery
    assert (workspace / "recover/.git").exists()
    (workspace / "clean/README").write_text("uncommitted user edit\n")
    (workspace / "recover/local").write_text("local history\n")
    git(["add", "local"], workspace / "recover")
    git(["commit", "-m", "local change"], workspace / "recover")
    (root / "author-recover/remote").write_text("remote history\n")
    git(["add", "remote"], root / "author-recover")
    git(["commit", "-m", "remote change"], root / "author-recover")
    git(["push", "origin", "main"], root / "author-recover")
    before = git(["rev-parse", "HEAD"], workspace / "recover")
    preserved = run("preserve-work", ["sync", "--only", "repos", "--no-refresh-manifest"])
    dirty = next(row for row in preserved["items"] if row["name"] == "clean")
    assert dirty["action"] == "skip_dirty", dirty
    assert (workspace / "clean/README").read_text() == "uncommitted user edit\n"
    assert git(["rev-parse", "HEAD"], workspace / "recover") == before
    assert git(["branch", "--show-current"], workspace / "recover") == "main"
    write_json(evidence / "assertions.json", {"partial_exit_zero_detected": True,
                "recovery_without_reclone_of_clean_repo": True, "dirty_content_preserved": True,
                "diverged_head_preserved": True, "diverged_head": before,
                "dirty_content_sha256": hashlib.sha256((workspace / "clean/README").read_bytes()).hexdigest()})
    print("Synthetic clone/recovery/preservation assertions passed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fx", required=True)
    main(parser.parse_args().fx)
