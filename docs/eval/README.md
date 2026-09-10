# Evaluating agent workflows

Evaluate whether an agent can use a freshly prepared workspace to perform a real
engineering task. Repository and environment facts come from a fixture or the
team's private manifest; they are not maintained in this public directory.

## Prepare an isolated workspace

```sh
MANIFEST=/path/to/private/manifest EVAL=/tmp/fx-evaluation \
  EVAL_REPOS=api-service,identity-service bash docs/eval/sandbox.sh
```

`MANIFEST` is required. An empty `EVAL_REPOS` selects no business checkouts, which
is useful for coordinate-discovery tasks. Initialization isolates both FX_HOME
and the user home used by Skill installers. Native agent trials and read-only
doctor checks retain the caller's normal home so credentials are not copied.
The temporary initialization home does not inherit SSH configuration or companion
caches; a failure there is not evidence that native authentication is broken.

The script preserves initialization stdout/stderr and reports failed or incomplete
stages instead of treating exit zero as readiness. Read doctor coverage before
choosing a task. `sandbox.sh smoke` checks child-process discovery and tracing
without requiring a manifest; `sandbox.sh env` prints the trial environment.

For a feature task requiring historical merge bases, supply a private case file:

```sh
python3 docs/eval/feature-sandbox.py --source-root /path/to/checkouts \
  --manifest /path/to/private/manifest --case /path/to/case.json \
  --root /tmp/fx-feature-evaluation
```

The JSON file contains `repos`, each with `name`, `source` and `target` revisions.
The helper borrows local Git objects, checks out each merge base in a new
workspace and writes a pin receipt. Keep the source objects while these temporary
clones use them. No source checkout is modified. Derive the guides afterward
with `fx sync --only docs --no-refresh-manifest` using the temporary FX_HOME.

## Run independent trials

Start the agent from the workspace root. Provide only the task and its authorized
scope, not hints naming fx commands. The templates in `prompts/` describe review,
feature and observability tasks; fill placeholders in a private copy outside this
repository. Keep prompts fixed when comparing guidance changes.

For Herdr-based interactive sessions, `trial.sh` accepts a private prompt through
`EVAL_PROMPT_FILE`; its default is the corresponding public template. Start and
prompt are separate steps so the person can complete native folder trust:

```sh
EVAL=/tmp/fx-evaluation EVAL_PROMPT_FILE=/path/to/private/task.md \
  docs/eval/trial.sh R1 trial-a start grok
EVAL=/tmp/fx-evaluation EVAL_PROMPT_FILE=/path/to/private/task.md \
  docs/eval/trial.sh R1 trial-a prompt
```

For another launcher, preserve its exact arguments, working directory, runtime,
model, prompt, terminal output, exit reason and FX_TRACE. A turn cap counts model
turns, not necessarily tool calls. If a run ends at that cap, retain its session
identifier and resume the same session; do not call an incomplete report a pass.
A timeout while observing a live process is not evidence that it terminated.

Review a native host's permission semantics before choosing tool restrictions.
Do not bypass project trust or silently disable a failed OS sandbox. State which
boundary was actually used and audit the observed effects. Remote messages,
comments, approvals, pushes and production changes require their own authorization.

## Assess and iterate

Assess these dimensions independently:

- **Discovery:** executable identity, matching bundled Skill and target repositories.
- **Routing:** manifest-derived coordinates and readiness before platform queries.
- **Evidence:** fixed source revisions, complete relevant diffs and explicit gaps.
- **Boundaries:** preserved work, command trust, read-only posture and data scope.
- **Efficiency:** unnecessary probes and repeated queries, separate from useful depth.
- **Accuracy:** established findings versus conditional risks and historical behavior.

Ask the trial agent about unexplained choices in the same session, preserving its
answer separately from the original report. Change the tool or manifest only for
a recurring mechanism or reproducible defect. Do not add case-specific business
facts to repair a model's unsupported inference. Re-run the relevant task after a
change; aggregate timings alone do not prove that evidence coverage was preserved.

## Other reusable probes

- `harness-smoke.mjs` prepares disposable lifecycle resources for native inspection.
- `bitbucket-parent-smoke.mjs` exercises companion fork-parent output against a
  loopback fixture. Companion changes belong in the companion repository; this
  probe does not prove that an installed companion supports that response.

Keep live reports, patches, session logs and private case files in a private
artifact directory outside the repository. See [validation boundaries](../validation.md).
