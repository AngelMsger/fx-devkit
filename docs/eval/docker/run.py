"""Single-container evaluation driver. Private inputs and evidence never enter the source tree.

Each bootstrap allocates an empty round, including HOME, FX_HOME, npm prefix and
cache. Record can reuse that round for recovery without overwriting any evidence.
"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time

from capture import capture


HERE = Path(__file__).resolve().parent


def name(value):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", value):
        raise argparse.ArgumentTypeError("use a short lowercase alphanumeric identifier")
    return value


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def environment(round_id):
    root = Path("/state") / name(round_id)
    home = root / "home"
    env = dict(os.environ, HOME=str(home), FX_HOME=str(root / "fx"),
               NPM_CONFIG_PREFIX=str(home / ".local"),
               NPM_CONFIG_CACHE=str(home / ".npm"),
               NPM_CONFIG_USERCONFIG="/input/npmrc", FX_UPDATE_CHECK="0",
               FX_SKILL_LOADED="1", SSH_AUTH_SOCK="/run/host-services/ssh-auth.sock",
               GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/input/known_hosts -o ConnectTimeout=15")
    env["PATH"] = str(home / ".local/bin") + ":" + os.environ["PATH"]
    return root, env


def prepare(args):
    args.evidence.mkdir(parents=True, exist_ok=False)
    args.evidence.chmod(0o700)
    build = args.evidence / "build"
    build.mkdir()
    receipt = {"base_image": args.base, "grok_version": args.grok_version}
    for label, repo, ref, dest in [
        ("fx-devkit", args.devkit, args.devkit_ref, build / "devkit"),
        ("manifest", args.manifest, args.manifest_ref, args.evidence / "manifest"),
    ]:
        sha = subprocess.check_output(["git", "rev-parse", ref], cwd=repo, text=True).strip()
        receipt[label] = sha
        archive = args.evidence / (label + ".tar")
        with archive.open("wb") as target:
            subprocess.run(["git", "archive", sha], cwd=repo, stdout=target, check=True)
        dest.mkdir()
        with tarfile.open(archive) as source:
            source.extractall(dest, filter="data")
    shutil.copy(HERE / "Dockerfile", build / "Dockerfile")
    write_json(args.evidence / "baseline.json", receipt)


def start(args):
    if (args.evidence / "container.json").exists():
        raise RuntimeError("container receipt already exists; inspect it before reuse")
    for source in [args.npmrc, args.known_hosts, args.evidence / "manifest"]:
        if not source.exists():
            raise RuntimeError(f"missing input: {source}")
    volume = args.container + "-state"
    # Named-volume copy-up retains the image directory's non-root ownership.
    vector = ["docker", "run", "--detach", "--init", "--name", args.container,
              "--user", f"{os.getuid()}:{os.getgid()}",
              "--group-add", "0",
              "--label", "fx.evaluation=" + args.container,
              "--cpus", "4", "--memory", "4g", "--mount", f"type=volume,src={volume},dst=/state",
              "--mount", f"type=bind,src={args.evidence},dst=/evidence",
              "--mount", f"type=bind,src={args.evidence / 'manifest'},dst=/input/manifest,readonly",
              "--mount", f"type=bind,src={HERE},dst=/harness,readonly",
              "--mount", f"type=bind,src={args.npmrc},dst=/input/npmrc,readonly",
              "--mount", f"type=bind,src={args.known_hosts},dst=/input/known_hosts,readonly",
              "--mount", "type=bind,src=/run/host-services/ssh-auth.sock,dst=/run/host-services/ssh-auth.sock",
              args.image]
    container_id = subprocess.check_output(vector, text=True).strip()
    for kind, identity, create in [("group", os.getgid(), "groupadd"), ("passwd", os.getuid(), "useradd")]:
        found = subprocess.run(["docker", "exec", "--user", "0", container_id,
                                "getent", kind, str(identity)], capture_output=True)
        if found.returncode != 0:
            options = ["--gid", str(identity)] if kind == "group" else ["--uid", str(identity), "--gid", str(os.getgid()), "--no-create-home"]
            subprocess.run(["docker", "exec", "--user", "0", container_id,
                            create, *options, f"eval-{identity}"], check=True)
    subprocess.run(["docker", "exec", "--user", "0", container_id,
                    "chown", f"{os.getuid()}:{os.getgid()}", "/state"], check=True)
    write_json(args.evidence / "container.json", {"id": container_id, "name": args.container,
                                                 "volume": volume, "image": args.image})
    print(container_id)


def bootstrap(args):
    root, env = environment(args.round)
    root.mkdir(exist_ok=False)
    (root / "home").mkdir()
    (root / "workspace").mkdir()
    fx = root / "fx"
    fx.mkdir()
    # Only select the agent under evaluation, before the first projection.
    (fx / "config.yaml").write_text("agents: [grok]\n")
    if args.repos is not None:
        local = fx / "workspaces" / args.round
        local.mkdir(parents=True)
        (local / "local.yaml").write_text("scope:\n  repos: " + json.dumps(args.repos) + "\n")
    evidence = Path("/evidence/rounds") / args.round
    evidence.mkdir(parents=True, exist_ok=False)
    write_json(evidence / "round.json", {"repos": args.repos, "root": str(root),
                                        "initial_home": "empty", "agents": ["grok"]})
    result = capture(["npm", "install", "--global", "/opt/eval/fx.tgz"], evidence / "install-fx",
                     env=env, cwd=root, timeout=600)
    return result["exit_code"]


def record(args):
    root, env = environment(args.round)
    if not (root / "home").is_dir():
        raise RuntimeError("bootstrap the round first")
    dest = Path("/evidence/rounds") / args.round / args.label
    env["FX_TRACE"] = str(dest / "fx-trace.jsonl")
    env["GIT_TRACE2_EVENT"] = str(dest / "git-trace.jsonl")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        raise RuntimeError("a command is required after --")
    if command[0] == "grok":
        env.pop("FX_SKILL_LOADED", None)
        env["GROK_MEMORY"] = "0"
    result = capture(command, dest, terminal=args.terminal, timeout=args.timeout,
                     env=env, cwd=root / "workspace")
    return 124 if result["stop_reason"] == "timeout" else result["exit_code"]


def container_call(args):
    receipt = json.loads((args.evidence / "container.json").read_text())
    container = receipt["id"]
    argv = ["docker", "exec"]
    if getattr(args, "terminal", False):
        argv.append("-it")
    argv += [container, "python3", "/harness/run.py", "inside-" + args.action,
             "--round", args.round]
    if args.action == "bootstrap":
        if args.repos is not None:
            argv += ["--repos", *args.repos]
    else:
        argv += ["--label", args.label, "--timeout", str(args.timeout)]
        if args.terminal:
            argv.append("--terminal")
        argv += ["--", *(args.command[1:] if args.command[:1] == ["--"] else args.command)]
    samples = args.evidence / "resources"
    samples.mkdir(exist_ok=True)
    sample_path = samples / f"{args.round}-{getattr(args, 'label', 'bootstrap')}.jsonl"
    stop = threading.Event()

    def sample():
        with sample_path.open("x") as out:
            while not stop.is_set():
                try:
                    result = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}", container],
                                            capture_output=True, text=True, timeout=10)
                    out.write(json.dumps({"ts": time.time(), "sample": result.stdout.strip(),
                                          "exit_code": result.returncode}) + "\n")
                    out.flush()
                except subprocess.TimeoutExpired:
                    out.write(json.dumps({"ts": time.time(), "error": "stats timeout"}) + "\n")
                stop.wait(2)

    worker = threading.Thread(target=sample)
    worker.start()
    try:
        return subprocess.call(argv)
    finally:
        stop.set()
        worker.join(timeout=12)


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--evidence", type=lambda p: Path(p).resolve())
    commands = cli.add_subparsers(dest="action", required=True)
    prep = commands.add_parser("prepare")
    for option in ["devkit", "manifest"]:
        prep.add_argument("--" + option, type=Path, required=True)
        prep.add_argument("--" + option + "-ref", required=True)
    prep.add_argument("--base", required=True)
    prep.add_argument("--grok-version", default="1.0.25")
    begin = commands.add_parser("start")
    begin.add_argument("--container", type=name, required=True)
    begin.add_argument("--image", required=True)
    begin.add_argument("--npmrc", type=lambda p: Path(p).resolve(), required=True)
    begin.add_argument("--known-hosts", type=lambda p: Path(p).resolve(), required=True)
    for prefix in ["", "inside-"]:
        boot = commands.add_parser(prefix + "bootstrap")
        boot.add_argument("--round", type=name, required=True)
        boot.add_argument("--repos", nargs="*")
        run = commands.add_parser(prefix + "record")
        run.add_argument("--round", type=name, required=True)
        run.add_argument("--label", type=name, required=True)
        run.add_argument("--terminal", action="store_true")
        run.add_argument("--timeout", type=float, default=7200)
        run.add_argument("command", nargs=argparse.REMAINDER)
    return cli


if __name__ == "__main__":
    cli = parser()
    args = cli.parse_args()
    if not args.action.startswith("inside-") and args.evidence is None:
        cli.error("--evidence is required on the host")
    if args.action == "prepare":
        prepare(args)
    elif args.action == "start":
        start(args)
    elif args.action == "inside-bootstrap":
        sys.exit(bootstrap(args))
    elif args.action == "inside-record":
        code = record(args)
        sys.exit(code if code >= 0 else 128 - code)
    else:
        sys.exit(container_call(args))
