# Workspace lifecycle contract

Lifecycle automation is a workspace feature. `hooks` defaults to true globally;
`FX_HOOKS` overrides that global setting. A workspace's personal
`hooks.enabled` defaults to true and can independently disable projection and
dispatch. The selected agents still come from the existing global agent choice.

## Entry points and ownership

`fx hook list` is read-only. `inject` enables the workspace and reconciles the
selected hosts. `remove` disables it before cleaning up, so sync cannot reinstall
the entries. Writes support dry-run and the ordinary read-only posture.
Global `agent unpick` immediately disables that host in every workspace and
reports its cleanup results; retrying unpick retries unfinished cleanup.

Only the registered workspace root receives entries. Business checkouts and
external worktrees receive no configuration. Dispatch validates the bound root,
registration, owner and actual host; it never falls back to a default workspace.

Native command hooks and extension bridges are separate protocols behind ports.
The sole AgentHostSpec table describes paths, events, context and host identity.
Composition registers protocol implementations and event handlers; application
code contains neither provider names nor native file layouts. Sync stages and
additional doctor checks are registered independently of their orchestration.

JSON edits preserve unmanaged text, including its whitespace and escaped values.
Ambiguous, invalid or foreign files stay unchanged. Bridge content carries an
ownership marker and digest; a modified bridge becomes foreign. Ownership
receipts and dated observations stay under the workspace's FX_HOME directory.
A phase that failed keeps one bounded line naming the failure beside its
observation code, so a fail-open background run stays diagnosable. A run dates
the phases it commits to before the first of them starts, so a worker its
supervisor terminates mid-phase leaves `HOOK_PHASE_UNREPORTED` rather than an
absence that reads like a phase with nothing to report. Observations
never contain prompts, transcripts, credentials, command output or member data
and are not included in exported profiles.

## Deadlines and delivery

The foreground performs local validation and returns cached observations. Its
normal target is 500ms, with an independent 2-second supervisor limit. Native
command entries and the Pi bridge allow 3 seconds so the fx supervisor can finish first. Missing
executables and failed workers produce an empty result with exit status zero.
Input is consumed once per process and capped at 64KiB; output is buffered until
successful completion and capped at 8KiB. UTF-8 decoding spans stream chunks.

Pi session shutdown cancels pending dispatches without delivering late context.
Cancellation signals the controller's own process group with SIGTERM, followed
by SIGKILL after 250ms if necessary. The supervisor handles termination signals
by reaping its worker group and returning an empty result. This is resource
cleanup, not a stop-event handler or transcript processing.

The detached background worker has a 30-second total deadline; companion
commands get at most 15 seconds and update probes retain the 2-second limit.
A companion command that exhausts its own budget ends the whole run: the worker
cannot own that child's process group, so it asks its supervisor to reap the
group, and the phases after it stay unreported.
The supervisor kills the worker process group on POSIX; Windows uses bounded
PID-scoped `taskkill /T /F` with direct-child fallback. Windows cleanup is
best-effort when a root has already exited. The supervisor owns
no host terminal handles. Only manifest refresh, docs, Skills and readiness
observations are wired into this worker. Repository sync and remote writes are
not available through its service wiring.

Manifest network checks retain the one-hour window and fx checks the one-day
window. Failures are remembered too. A 15-second local window coalesces session
bursts; local projection attempts are separate from successful remote checks.
The foreground does not wait for an update or reload the host's active session.
New resources may apply only to the next session.

Automatic execution never confirms trust, passes `--yes`, or overrides the
write posture. Untrusted Skill vectors are skipped while independent owned
projections can proceed. Historical login observations do not establish current
readiness; `can` and `doctor` remain the live query routes.

## Concurrency and recovery

Trust updates hold a file-level read/modify/write lease. Manifest refresh and
automatic work share workspace leases. Hook preferences and receipts have their
own short lease, and projections share target-path leases across workspaces.
Automatic contention skips; manual contention is bounded and retryable.
Recovery checks owner liveness and tokens, not elapsed time alone. Competing
reapers cannot remove the next owner's lease. Unreadable ownership is retained.

Documents use same-directory atomic replacement. Skill directory updates prepare
the complete new copy first, record their staging paths, and restore the previous
directory if interrupted between renames. Unrecognized recovery records require
inspection rather than deletion. Projection writes recheck the observed file;
an outdated plan returns conflict.

## Native activation and verification

A matching file proves projection, not host activation. The command reports
`activation: unverified` and a handoff until the person verifies native project
and hook trust. fx does not edit native trust stores or invoke bypass flags.
Claude Code and Codex have native context output; Pi uses a bounded project
extension; Grok requires explicit sync at plain workspace roots; see the activation limitation below.

Each protocol has a golden fixture. Unit tests also execute the generated Pi
bridge and exercise independent process supervision, UTF-8 boundaries, locking
and recovery. End-to-end tests use local bare repositories to prove that only
the manifest receives Git network operations and that the window is reused.
Native startup requires separate host and account verification under the
[validation guidance](../validation.md). Keep account-specific transcripts private.

Native Windows projection and acceptance details are in [Windows](windows.md).

Stop is a reserved event type. No high-frequency hook, transcript parser,
friction prompt, MCP projection or contribution write runs in lifecycle dispatch.

Hook preferences commit after successful projections and receipt writes. Conflict, busy and IO failures preserve the previous preference; completed projections keep recovery receipts. Dispatch errors fail open with bounded metadata on stderr. Grok 1.0.25 project hook discovery requires a Git root, which plain workspace roots deliberately lack. Its projection carries an unsupported activation handoff to explicit fx sync --only docs,skills. Normal directory trust is still required for guide/Skill discovery and does not remove this limitation.
