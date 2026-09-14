# Container evaluation

This optional Linux harness measures a real installation and remote repository
initialization in one disposable Docker container. It does not change fx's
runtime or add progress to its output. Keep the manifest, repository selections,
prompts and live evidence outside this repository.

## Prepare and build

Use Python 3.12 or later on the host, Docker Desktop on macOS, an available SSH
agent, a verified `known_hosts` file and an npm configuration with the required
registry access. SSH agent forwarding uses Docker Desktop's
`/run/host-services/ssh-auth.sock`. Native Linux needs a separately reviewed
socket mapping; this launcher does not claim that portability.

Run from the fx-devkit checkout. Choose an unused evidence directory. Resolve
the base image to a digest before a comparison and pin both Git revisions:

```sh
python3 docs/eval/docker/run.py --evidence /private/path/evaluation prepare \
  --devkit /path/to/fx-devkit --devkit-ref <commit> \
  --manifest /path/to/manifest --manifest-ref <commit> \
  --base node@sha256:<digest> --grok-version 1.0.25

docker build --build-arg BASE_IMAGE=node@sha256:<digest> \
  --build-arg GROK_VERSION=1.0.25 --progress plain \
  -t fx-evaluation:local /private/path/evaluation/build

python3 docs/eval/docker/run.py --evidence /private/path/evaluation start \
  --container fx-evaluation --image fx-evaluation:local \
  --npmrc /path/to/npmrc --known-hosts /path/to/known_hosts
```

The container has four CPUs and 4 GiB of memory. It runs as the host's numeric
user, with a passwd entry for runtimes that resolve user information. A
supplementary group grants access to Docker Desktop's root-group SSH socket;
the socket's ownership and host files are never changed. Only the fresh state
volume is assigned to this user. No Docker control socket is mounted.

The image builds a package from the pinned source. The timed round installs
that tarball into a new user-owned npm prefix. Build/download time belongs to
image preparation and must be reported separately from workspace initialization.
The manifest snapshot is an ordinary directory exported from the recorded Git
commit; it does not test remote manifest refresh or registry package publication.

## Run rounds

Each bootstrap creates a new HOME, FX_HOME, cache, prefix and workspace. Reusing
an existing round identifier is rejected. Omit `--repos` for the full manifest;
pass `--repos` without values to select no business repositories.

```sh
python3 docs/eval/docker/run.py --evidence /private/path/evaluation bootstrap \
  --round sample --repos api-service identity-service

python3 docs/eval/docker/run.py --evidence /private/path/evaluation record \
  --round sample --label init-no-input --timeout 7200 -- \
  fx init /state/sample/workspace --from /input/manifest --name sample \
  --format json --no-input

python3 docs/eval/docker/run.py --evidence /private/path/evaluation record \
  --round sample --label init-terminal --terminal -- \
  fx init /state/sample/workspace --from /input/manifest --name sample
```

The terminal mode needs a real host terminal. It preserves native consent
prompts. Review exact manifest command vectors before approval; a broad test
request is not vector approval. A `--yes` retry is appropriate only after all
vectors that invocation may trust have explicit approval. Use a new label when
recording recovery, so failed evidence remains intact.

For cold-clone comparisons use new rounds, the same repository set and explicit
`--jobs 1` or `--jobs 4`. Report the order of runs and the limitations of shared
network/server caches. Do not substitute local Git objects or shallow clones.
Retain unreadable repositories in the denominator.

Capture `fx status`, `fx doctor`, `fx skill list` and `fx hook list` separately
after init. A zero exit is not evidence that every stage completed or that all
tools are ready. Distinguish expected missing credentials, declared coverage
gaps, foreign files, and actual initialization failures.

## Inspect evidence and run agent trials

```sh
python3 docs/eval/docker/assess.py /private/path/evaluation
python3 -m unittest discover -s docs/eval/docker -p 'test_*.py' -v
python3 docs/eval/docker/replay.py \
  /private/path/evaluation/rounds/sample/init-terminal/output.jsonl

docker exec <recorded-container-id> python3 /harness/faults.py \
  --fx /state/sample/home/.local/bin/fx

docker exec <recorded-container-id> python3 /harness/inventory.py --round sample
```

`rounds/<round>/<label>/` contains exact command metadata, raw stdout/stderr or
PTY output, timestamped output chunks, a completion receipt, FX_TRACE and Git
Trace2 when produced. `resources/` contains separately timestamped Docker stats.
`measurements.json` summarizes commands, Git durations, partial init findings,
first output and longest output silence. Input activity timestamps carry no
input bytes; use the corresponding prompt to account for human wait separately.
The assessor separates recognized fx consent waits from active runtime and
silence. Replay caps each pause at two seconds for convenient inspection; use
the timestamped evidence for actual durations, or increase `--max-gap` to replay
long pauses in full.
Raw terminal output may contain echoed input and must remain private. Never
record passwords or authorization tokens in a trial capture.

The optional fault probe creates its own synthetic local Git remotes and checks
that a failed clone is reported despite exit zero, a corrected branch can be
retried, and dirty content and diverged commits survive synchronization. It
never edits the team manifest or accesses a remote service. Run it once per
state volume; retain its assertion receipt separately from live performance data.
The inventory captures readiness queries, selected repository HEADs, branches,
remotes, dirty state, object and disk sizes, and derived guide/Skill paths. A
missing query result stays explicit; inventory creation does not certify readiness.

The recorder forwards interruption to the command's process group and escalates
after two seconds. Timeout or signal termination remains an incomplete run, not
a success. Automated tests cover output fidelity, PTY behavior, process-tree
termination and partial-result assessment.

For native agent trials, authenticate Grok inside the selected round's HOME
using `grok login --device-auth`. Review native project and hook trust before
running fixed private prompts. Use the same model, isolated sessions and memory
settings; do not inject fx command hints. Preserve session reports, tool traces,
stop reasons and usage when available. Hooks must be observed natively; file
presence alone does not prove activation. Remove `FX_SKILL_LOADED` from the
initial agent environment so the trial discovers the matching bundled Skill.
The recorder does this automatically for commands beginning with `grok` and
sets `GROK_MEMORY=0` to disable cross-session memory. Choose `--no-subagents`
explicitly for a single-agent baseline.

Verify one real terminal tool call before starting the campaign: a model-only
response does not exercise execution permissions. In Grok 1.0.25, inline
environment assignments can still prompt under `default` even with Bash allow
rules. `auto` mode can permit the call through its native safety check; keep the
reviewed deny rules and record the chosen mode. Auto is not a closed allowlist
and may still block other calls. Do not label a cancelled tool call a success
just because the Grok process exits zero.

Complete the native directory-trust prompt before assessing automatic discovery.
Use `grok inspect --json` to check project instructions, project Skills and hooks
separately. A plain directory may have a null `projectRoot` while still being
trusted; do not add a Git repository merely to change that field. An empty native
hook list or absent automatic-sync observations must remain an explicit gap.

First-output >5 seconds and output silence >15 seconds are diagnostic flags,
not a network performance SLA. Do not turn small samples into latency percentiles
or treat network failures as proof of a code defect.

## Keep or clean up

Leave the final container and volume intact for inspection. `container.json`
records the exact container ID and volume name. Cleanup only those resources:

```sh
docker stop <recorded-container-id>
docker rm <recorded-container-id>
docker volume rm <recorded-volume-name>
```

Archive private reports first. No global Docker prune is part of this workflow.
