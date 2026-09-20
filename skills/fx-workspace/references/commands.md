# Command reference

The generated repository reference is `docs/cli/README.md`; installed commands
expose the same flags through `fx <command> --help`. The table lists common flags;
`--dry-run` belongs to write commands and `--details` to the four workflow reports.

| Flag                           | Meaning                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `--format json\|ndjson\|human` | output format; agents use `json`                                   |
| `--details`                    | full JSON for init, sync, doctor and release                       |
| `--fields a,b.c`               | keep only these dot paths                                          |
| `--workspace <name>`           | a registered workspace instead of the one containing cwd           |
| `--no-input`                   | never prompt; a needed answer becomes a structured error           |
| `--yes`                        | confirm prompts, including trust-on-first-use of manifest commands |
| `--dry-run`                    | on write commands: print the plan, change nothing                  |
| `--allow-writes`               | override read-only posture once                                    |
| `--quiet`                      | drop notices and progress (errors stay)                            |

Every `--help` ends with an `AGENT USAGE` block that restates the output
and error contract.

## Workflow report views

The four workflow reports (`init`, `sync`, `doctor`, `release`) default to compact
JSON. `output_mode: summary` and `omitted` describe the view; omitted counts are
not pagination. All warning/failure rows and exact pending command vectors remain.
`--details` returns the full application result; explicit `--fields` projects it.
Explicit report projection applies in every format: JSON/NDJSON emit one object;
human output emits selected key/value pairs. Dotted paths retain flat keys and
array alignment. Without explicit fields, human/NDJSON defaults are unchanged.
Fact-query projections still apply per item and retain collection metadata. Error envelopes are never
projected or compacted. Large INIT_PREPARED notices follow the same report mode.

For init/sync, `operation` is `preview` or `apply`. `preparation_complete` is null for preview,
false when selected/requested work is protected, blocked, failed or unverified,
and true only when preparation completed. Doctor/release `ok` and `complete`
retain their failure/coverage meanings; preparation does not prove remote health.

`self info.bundled_skill_version` names the bundled instructions. Read the returned
source, then declare `FX_SKILL_VERSION` alongside `FX_SKILL_LOADED=1`. A matching
version can acknowledge loading even without a global copy. `skill status`
separates `loaded`, `loaded_version` and `version_verified` from installed copies.
A legacy boolean without a version produces `SKILL_VERSION_UNVERIFIED`; a declared
mismatch produces `SKILL_VERSION_MISMATCH`. With neither declaration, discovery
notices can instead report a missing, outdated, foreign or unread Skill copy. Notices are non-blocking and can be silenced with
the existing quiet/notice settings. Bootstrap commands remain available.

`SKILL_WRITE_DENIED` keeps denied filesystem paths and partial stage evidence.
Check access before repeating writes. To continue local repository/guide work,
use `sync --only repos,docs --no-refresh-manifest` in the affected workspace.
This does not claim the skipped Skill stage is ready or authorize trust changes.

## Shapes of the answering commands

`workspace list/show` resolves registry facts without requiring a valid manifest.
Rows include root/source, selection and health. `self info` still reports global
installation facts when the selected workspace is degraded. Use explicit
`workspace relocate`, `rebind` or `unregister` plans to change identity or end
management; these preserve business checkouts and respect owned-resource cleanup.

`repo select` / `env select` replace a personal collection. `--all` removes its
explicit scope and follows future shared entries; `--none` stores an empty set.
`pick/unpick` retain additive/removal semantics. Selection output reports modes
and next steps; repository selection is separate from downloading via sync.

`status` keeps `{items, has_more}` and adds workspace/root/selection context.
Items preserve `dirty` as tracked changes and add `uncommitted` for tracked or
untracked work. Human output includes untracked counts; `--dirty` filters on all
uncommitted work. Empty results distinguish no declarations, no selected repos
and no matching uncommitted work.

Init accepts `--repos` / `--no-repos` before cloning. Its preview distinguishes
actual registration from planned effects and states whether source contents
were inspected; uninspected remote contents are not a validated selection.
`registered` means registration currently exists, including a successful retry.

Profile import merges registrations by name, retains unmentioned workspaces and
refuses root/source identity changes. Its registration plan and quoted next steps
identify missing manifest preparation. Use workspace lifecycle commands for
relocation, rebinding and removal rather than editing an export to remove names.

`fx can <capability|tool> [--env <env>]` — one record:

| Field          | Meaning                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `ready`, `missing_tool`, `outdated_tool`, `disabled_tool`, `unconfigured`, `no_access`, `not_covered`, `unknown`                                                                   |
| `tool`         | the companion tool the provider needs, or `null` when none is required; `provider` and `env` identify the target                                                                   |
| `handoff`      | pending preparation or human interaction: `summary`, `user_steps[]` (`id`, `kind`, `title`, optional `instructions`, `open`, `command`, `expects.path`), `command`, `alternatives` |
| `alternatives` | commands that answer part of the question without the tool                                                                                                                         |

A bound provider without a companion tool has no installation or login check;
`ready` means preparation is complete, not that every repository query will succeed.

When a tool has multiple viable platform bindings, `can` returns
`CAN_AMBIGUOUS` rather than choosing by declaration order. Select a capability
and environment, or inspect repository platforms through `where`.

`fx where <repo> [--env <env>] [--platform <name>] [--no-check] [--probe]` — `items[]`, one per platform and environment:

| Field                             | Meaning                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `status`                          | `located` or `not_covered` (the environment has no such platform, or the repository is deliberately uncovered) |
| `ready`                           | the `fx can` status for this platform's tool in this environment; `null` under `--no-check`                    |
| `handoff`                         | as in `fx can`, when `ready` is not `ready`                                                                    |
| `command`                         | a shell line to show the person or run yourself once `ready` says so; `null` when not covered                  |
| `url`                             | the page behind it, when the provider knows one                                                                |
| `confidence`                      | `verified`, `derived`, `unverified`, `not_covered`, `not_found` — the weakest declared                         |
| `notes`                           | caveats from the manifest, most specific first                                                                 |
| `vars`                            | the merged variables, for composing another query                                                              |
| `outcome`, `suggested_confidence` | with `--probe` (needs `--env`): what the platform said, read-only, and the confidence to record                |

`fx member show <query>` — `items[]` of people: `id`, `display`, `email`, `status`, `accounts` (per system), `matched_by`, `via`.
`fx repo show <repo>` — the resolved entry, disk state and URLs, plus `owners`: `[]` when the members document names nobody, `null` when the workspace has no members document at all, else items of `area`, `lead`, `scenario`, `devLead`, `roles`, every person as `{id, name, email}` (name and email `null` when the id is not in the document, `all` included); `contact` is the project's contact.

### Diagnostic reports

Login and doctor reject unknown explicit tool/environment selectors before setup
or repair (`TOOL_UNKNOWN` / `ENV_NOT_FOUND`). `login --list` reports conflicting
expanded setup identities as `step_conflict` notices; executing that plan fails
with `SETUP_PLAN_CONFLICT`. Inspect the provider recipes rather than retrying the
same ambiguous setup. Doctor marks its missing verification as incomplete.

`fx doctor` and `fx release` return `ok`, `complete`, `summary {ok, warn, fail}`
and `findings[]`. Findings carry `group`, `id`, `level`, `coverage`, `message`,
`fix` and `handoff`; the full `--details` view also carries `evidence`.

Both commands exit 0 when the report was produced, even with failures.
`ok: true` means no `fail` finding. `complete: true` means no requested finding
has `coverage: incomplete`; `not_applicable` marks exclusions and `checked`
marks completed checks. Advisory warnings may still be checked. Inspect
findings and evidence before claiming readiness; neither top-level flag proves
that every capability is ready. For `can`, inspect `status` instead.

Doctor groups are `repos`, `tools`, `login`, `agents`, `manifest`, `self`,
`hooks`, `mcp` and `rules`. `manifest:docs` checks derived guides;
`manifest:upstream` checks source updates; `self:version` checks published CLI
updates. A development build needs no update; an unavailable registry produces
a warning, with a handoff when configuration is missing.

Doctor also returns `repairs`, empty without `--fix`. Summary JSON omits successful
repair rows; use `--details` to inspect all attempts. Each attempt is
`{group, status: planned|completed|failed, failure?}`. Failed attempts retain
structured recovery errors before post-repair findings are collected.
`completed` means the repair ran, not that the subsequent check passed.

`fx release [<repo>...] [--tag] [--only deps,merge,ci,errors] [--env] [--since]
[--jobs]` covers repositories selected by manifest release policy. Its evidence
is grouped by check:

| Group    | Evidence                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `merge`  | `source`, `target`, `ahead[]`, `behind[]`, `filtered`, `unknown[]` directions; commits have `sha`, `author {id, name}`, `date`, `message` |
| `deps`   | `file`, `offending[] {name, version, section, runtime}`                                                                                   |
| `ci`     | `builds[] {side, env, branch, path, number, status, started_at, url, current}`; null `path` means no declared job                         |
| `errors` | `env`, `slug`, `since`, `capped`, `undated`, `issues[] {short_id, title, level, first_seen, last_seen, count, url}`                       |

CI `current` compares build start time with branch-head time. This adapter result
has no built-commit field, so it is a freshness heuristic, not revision verification.
Use the companion's SCM/build details when the task requires an exact commit match.
The full report's merge/dependency/issue evidence is available with `--details`.

Uncovered explicit repositories yield `REPO_NOT_COVERED`, unmatched tags
`TAG_NOT_FOUND`, unknown environments `ENV_NOT_FOUND`, and an empty checklist
`CHECKLIST_EMPTY`. `--since` accepts windows such as `14d`, `48h` or `2w`;
invalid windows yield `BAD_SINCE`. Missing platform responses/jobs, undated
issues and builds that cannot be dated against the branch head warn rather
than prove readiness. `RELEASE_OK` / `RELEASE_FAILURES` are closing notices;
inspect report coverage even when the notice says OK.

### Update notices

`MANIFEST_OUTDATED` suggests `fx sync`; `FX_OUTDATED` suggests updating fx and
refreshing installed Skill copies. These notices do not change the command result.
Skill management, self-update, completion and lifecycle dispatch skip these checks.

Checks are cached for a day (fx) or an hour (manifest), run with two-second upstream
deadlines and stay silent on failure. Local cache access and bounded npm Registry discovery are outside that
deadline. `FX_UPDATE_CHECK=0`, `update_check: false` or `--quiet` disables them;
doctor then marks those checks as not checked. A failure before configuration is
loaded performs no update check.

`self info` exposes the effective `registry` and `registry_source`. Runtime order
is optional `FX_REGISTRY`, npm's package-scope setting, then npm's default setting.
Discovery uses global mode, honoring user/global config and `NPM_CONFIG_USERCONFIG`
while excluding project npmrc. Invalid chosen settings remain unresolved; internal
packages never fall back to a public Registry. Historical tarball URLs are not used
to guess Registry APIs. Metadata authentication is delegated to npm; the existing
private `FX_REGISTRY_TOKEN` override remains supported when paired with explicit
`FX_REGISTRY`; it is not applied to an inferred target. Self-update pins only the
fx package scope, preserving npm's default route for other dependencies.

### Initialization and synchronization

`fx sync` — `items[]` of repository rows (exceptions only in summary JSON), then `summary` and `stages` (`services`, `docs`, `skills`, `hooks`, `mcp`, `tools`) in the same envelope. Failed repository rows keep the display `error` and a
`failure` object with `category`, `code`, `message`, `hint`, `next_steps`,
`retryable` and optional `handoff`. Use that recovery data to decide what to
retry; the other rows may already have succeeded. Exit zero can accompany
partial results: inspect `summary.failed`, `summary.unreadable` and stage counts.

Interrupted Skill stages retain item `status` and disk `observed` values in
`stage_details.skills`; package failures retain `tool_install`, including completed,
failed and not-started rows. `code: null` is not success. A package row with
`phase: version` and `code: 0` completed installation before verification failed.
Inspect these records before retrying; cancellation stops execution.
`stage_details` adds document `files`, Skill `links`/`fx`/`tools`, and tool-check,
hook and MCP `items` where those stages ran. Rules rows are nested under
`stage_details.docs.rules.items`. Skill tool rows retain exit `code`, a concise
`note`, and the companion's structured `failure` when supplied. `code: null`
means no exit result is available; consult item status and `ran` where supplied.
A dry run executes no command, but an interrupted process may also lack an exit result. `stages` keeps its existing
counter shape; details supplement those counts rather than replacing them.
`fx init` nests this result under `sync`; its `written` field confirms local
registration work, not complete synchronization or readiness.

Document writes use a captured file snapshot. `DOCS_WRITE_CONFLICT` preserves a
concurrent edit or unsafe path; inspect the path and retry from its current content.
Each document row has `action` (the plan) and `result` (`planned`, `done`, `skipped`,
`failed`, `not_started`). On failure, read `files` from partial stdout, or
`stage_details.docs.files` inside sync and `sync.stage_details.docs.files` inside init. Completed file rows remain in the
failure summary. Retry the same document operation after resolving the blocker;
unchanged files are skipped. Approved foreign replacements move the original
object to a unique sibling `.fx-backup[-N]` before a guarded write.

`fx manifest render --check` — exit 11 (`DOCS_STALE`) when the manifest repository's AGENTS.md regions differ from the manifest.

`fx hook list` — `items[]` with agent, action, activation, path, context and handoff,
plus workspace/root, the effective enabled setting, and dated observations.
`activation: unverified` means native trust/execution has not been established;
a matching projection alone is not readiness. An observation whose code is
`HOOK_PHASE_UNREPORTED` names a background phase that never answered, so its
absence of findings is unknown rather than clean; run its `command` to find out. `fx hook enable [--dry-run]`
enables this workspace and projects selected hosts. `fx hook disable [--dry-run]`
disables it and removes owned entries. Global `hooks` / `FX_HOOKS` gates all
workspaces; local `hooks.enabled` gates one. `agent unpick` remains global and
adds per-workspace hook cleanup results. Lifecycle dispatch is an internal,
fail-open host entry and is not a command to run for ordinary diagnostics.

## Source contributions and recording

`fx source push <paths...> --issue <id> --title <title> [--message] [--new]
[--pr <id|url>] [--dry-run]` returns one record with workspace, action, files,
branch, base/tree/commit identities, target, target_branch, planned message/title,
pull_request, findings, validated, written, fetched and retired operation IDs.
Nullable fields are explicit. `create`, `update`, `resume`, `associate`, `unchanged`,
`recover`, `needs-fetch` and `cancelled` are distinct actions. A preview does not
write Git objects, refs or journals. --pr must resolve to the current repository
and recorded source/target branches; an arbitrary URL is never used as a request
destination. Private manifest addresses are permitted, credentials/personnel content
are rejected, and only selected whole files enter validation and the commit.

`fx manifest record-probe <repo> --env <env> --platform <platform>` returns a
recording record instead of a list. `where --probe --record` is a compatibility entry:
action (`preview`, `recorded`, `unchanged`, `skipped`), file, scope, path,
before/after confidence, note, row, written and handoff.
The row retains the normal where/probe fields and includes probe_template. Dry-run
sets after to null; only a real definite probe can set verified or not_found.
Stale documents, aliases/anchors or conflicting writes are refused.

## MCP

`mcp list` returns `{items, has_more, orphaned}`. `mcp show <name>` returns one
resource with symbolic bindings, projections and readiness. `can mcp:<name>`
optionally accepts `--agent <id>`; MCP resources are workspace-scoped, so `--env`
is not applicable. Use `sync --only mcp` for projection and `doctor` for repair.

## Standalone companion Skill

`skill path` uses the collection envelope. Each row has an optional `agent`, `path`,
`status` (`installed`, `not_installed`, `foreign`), `version` (nullable) and
`version_state` (`matching`, `older`, `newer`, `unknown`, `missing`). `skill status`
returns `loaded`, `loaded_env`, `loaded_version`, `version_env`, `version_verified`,
`embedded_version`, `installs` and `next`. The declared loaded flag and declared
version are separate; neither proves reading. Neither command needs a workspace.

Install/uninstall detect agents in the selected scope by default; `--agent`
accepts repeated or comma-separated IDs. Path/status list all known agents unless
narrowed. Project detection uses native markers; user detection also recognizes
agent executables on PATH. `--project` selects cwd; `--dir` selects an independent
directory and cannot be combined with `--agent` or `--project`.

Explicit install refreshes recognized copies to the bundled version, including
same-version repair or replacing a newer copy. Init/sync never downgrade newer
copies. Foreign replacements require confirmation and backup. Uninstall removes
recognized copies after confirmation (`--yes` for noninteractive execution), keeps
foreign paths and leaves agent selection unchanged; later sync can reinstall a copy.

`skill install/uninstall` return collection rows with `action`, `status`, `version`
and target fields. Status is `planned` for previews; execution distinguishes
`installed`, `removed`, `not_installed`, `foreign`, `skipped`, `failed` and
`not_started`. On interruption, stdout retains the partial collection with each
row's `observed` state and failure envelope; stderr preserves the original error.
`SKILL_FLAGS`, `SKILL_AGENT` and `SKILL_NO_AGENT` are usage errors.
`SKILL_SOURCE_PROTECTED` rejects writes through shared manifest paths;
`SKILL_BUSY` and `SKILL_TARGET_CHANGED` require inspecting/retrying the target.

`skill show` is an explicit raw-text exception to structured stdout: it always
prints the bundled SKILL.md. It makes no network check and emits no discovery hint.

## Installation audit and inventory

`fx tool history [tool]` returns `{items, has_more: false, scope: "global"}` across FX_HOME. Each
checkpoint has `id`, `at`, `event` (`started`, `installed`, `finished`), `operation`
(`init`, `install`, `update`), nullable `workspace`, `name`, `binary`, `via`, `spec`,
redacted `vector`, nullable `code`, `version_after`, `binary_path`, `failure_code`.
New checkpoints also carry `installation_origin` and `binary_path_before`; legacy
records can lack them and never establish original ownership.
Checkpoints share an operation ID. `code: 0` describes the package manager; a
null version does not prove readiness. Raw process output is absent.

`fx tool inventory` uses the same collection envelope. Rows include `name`, `via`,
`spec`, `binary`, current `binary_path`, recorded `version_after`, `last_operation`,
`last_recorded_at`, `installation_origin`, `recorded`, `installed_by`, `required_by`, `unknown_workspaces`, `state`
and nullable `uninstall_hint`. States are `required`, `unused`, `unknown`,
`unverified`, `not_on_path`, `changed`, `unscoped`, `external`. Unrecorded known
executables have null manager/package/version/operation fields; inspection does
not adopt them. `installed_by` identifies successful operations, not original
ownership. Only confirmed fx-origin `unused` rows have a removal
hint; it is never an executable approval. Sync exposes these rows in
`stage_details.tools.installations` and counts `stages.tools.unused`.

## Service preparation

Explicit init/sync includes `stages.services` and `stage_details.services.items`.
Each item has `id`, `tool`, nullable `env`, `status`, `detail` and optional public
`changes`, structured `failure`, `next_steps`. Status is `configured`, `unchanged`,
`planned`, `blocked` or `failed`; plan problems remain separate. Public configuration
success never establishes personal authentication. `sync --only services` selects
this stage, and `--dry-run` does not write configuration or trust.

Family companion setup uses `config set-context` without automatically adding
`--activate` or `--overwrite`; the first-context default is owned by the companion.
Inspect `CONFIG_CONTEXT_CONFLICT` differences and the overwrite preview before
changing existing settings. Session-backed OpenObserve contexts require a new
context to change their URL/scheme; login uses `auth login --browser`.
Sentry accepts public workspace URL/org defaults and names the instance with
`--url`; it never copies existing credentials into shared configuration.
Changed setup vectors require new exact-command trust.

## Readiness and recovery

`LOGIN_REQUIRED` and non-ready `can`/`where` answers enter this flow.

`login --format json` includes `items`, `has_more`, `summary` and `problems`;
`--list` includes plan problems even with `--quiet`. If a step needs human input
or a later step throws, read the partial result on stdout as well as the error
on stderr. Results distinguish `handoff`, `blocked`, `failed` and `not_started`;
completed steps remain visible. Handoff rows include the required action, and
service preparation rows retain available `failure` and `next_steps` fields.
After resolving the blocker, repeat the same invocation: setup verifies current
state before rerunning actions. Consumers that previously discarded stdout on
nonzero exit must now parse it when present. `self update` also captures installer
output so its stdout remains parseable; inspect the returned installer `code`.

Retain the original task, repository/environment and readiness query while
repairing prerequisites. Authorization already given in this session persists;
perform covered local work without asking again. Readiness and a printed
handoff never authorize external writes, permission changes or credential
creation. Cluster/Rancher restrictions apply throughout setup too.

If fx itself cannot run, follow the root guide's pre-Skill bootstrap and the
manifest source README. Inspect the executable/package identity, runtime and
PATH before reinstalling. A verified local `node <checkout>/bin/fx.js` entry
can stand in for every `fx` command below. Do not use `fx self update` to
recover an executable that cannot start.

1. **Diagnose the selected prerequisite.** Read status, `handoff.summary`,
   `user_steps` and alternatives. Use `fx doctor --tool <tool>` and
   `fx login <tool> --env <env> --dry-run --no-input` for current checks;
   `--list` shows recipes without verifying them. Omit `--env` for an unscoped
   tool. Load the relevant companion Skill for provider-specific setup and
   diagnostics. A failed auth check alone does not identify the root cause.
2. **Complete authorized local preparation.** For `missing_tool`, use the
   returned install/update command, preview it with `--dry-run`, and inspect
   the manager/package/registry before executing. Check `ran`, `code`, `error`
   and `version_after`; exit zero or a null version is not proof of readiness.
   Fix a confirmed PATH/runtime issue before reinstalling. For pending setup,
   inspect recipes via `login --list` and preview checks; preserve working
   configuration. A `kind: run` step can still open a browser or change remote
   credentials: classify its actual effects using the companion Skill.
   Run `fx login <tool> [--env <env>] --skip-manual --no-input --yes` only when
   all selected run effects are authorized and every patch-supplied run/check
   vector is already trusted or explicitly approved. `--yes` also trusts those
   vectors; it is not just a prompt suppressor. If only part is authorized,
   use the companion's supported scoped operation, keeping the same trust
   boundary. Inspect `failed`, `blocked`, `skipped` rows and setup problems.
3. **Hand off only the human part.** Prepare supported local configuration and
   start an authorized login flow when useful; leave QR/device/browser consent,
   obtaining access and new vector approval to the person. For manual/file
   steps, use `title`, `instructions`, `open`, `command` and `expects.path` when
   present. The file path is a destination, not permission to fetch or create
   credentials. Ask concisely what they must do, where, why, and name the check
   you will run afterward. Never request tokens in chat. Continue independent
   authorized work while waiting; do not claim the dependent task is complete.
4. **Verify and resume.** Once local input changes or the person finishes,
   re-run the same scoped `can`/`where` query. Login checks before acting and
   skips already-valid steps; do not reinstall/reinitialize successful setup.
   On `ready`, automatically continue the original task through the companion
   Skill. On the same unchanged failure, diagnose the specific provider error
   or report a concrete blocker and the missing input. Do not loop logins or
   ask for the same authorization again.

| Evidence                                                          | Next decision                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INSTALLER_UNAVAILABLE`, missing runtime or manager               | Read tool docs/local installation guidance, inspect PATH and available managers, perform authorized local install; ask only for unavailable source or required machine access.                                     |
| Registry/package unavailable, install `error` or network failure  | Check the reported registry/package and connectivity; package publication is not guaranteed. Use a documented local source when available. Retry only after a relevant change or a bounded provider-directed wait. |
| `unconfigured`, failed configuration/auth check                   | Inspect the companion's read-only status and scoped doctor details. Initialize only missing configuration; distinguish invalid credentials, network failure and missing permissions before starting login.         |
| `no_access` from fx                                               | This means the environment is outside personal selection, not a remote permission verdict. Select it only within task scope; remote missing scope/forbidden requires the appropriate access decision.              |
| `not_covered`, `CAPABILITY_UNBOUND`, unresolved recipe/coordinate | Inspect manifest providers/validation and maintain confirmed shared facts within scope. Do not substitute another environment or repeatedly ask for login.                                                         |
| `TOOL_UNDECLARED`                                                 | The capability is bound and its provider is known; the tools document does not declare the companion the provider runs. Propose that declaration; do not rebind the capability or install the tool first.          |
| `unknown`, parse error or unexpected failure                      | Inspect focused diagnostics and the companion Skill; preserve uncertainty, redact sensitive output, and report an actionable blocker if evidence cannot resolve it.                                                |

## Concurrent manifest edits

`manifest repo-set` rechecks the captured document under a file lease before
replacing it. If another writer changed it, the path is not a regular file, or
its directory is a symbolic link, `MANIFEST_EDIT_CONFLICT` preserves the existing
content. Inspect the real source path and retry with `--dry-run`; do not remove
locks or overwrite another edit. An identical edit reports `written: false`.
