# Work in an existing workspace

Use this reference for tasks after initialization. For preparing a new workspace
or resuming its preparation, use the [initialization guide](initialization.md).

## Start with the running version

1. If the running version is not yet known, run `fx self info --format json`.
   Read `SKILL.md` in the returned
   `bundled_skill` directory, or run `fx skill show`. A global copy can be older.
   Keep the exact executable prefix that returned this result for every later command.
   The examples use `fx` as shorthand: if discovery used an absolute path or
   `node <checkout>/bin/fx.js`, keep using that prefix. Bare `fx` can resolve to
   a different installation after shell startup.
2. Use `--format json` for machine-readable results. Rediscover the bundled
   version when the executable changes; no environment acknowledgement is needed.
3. Discover the task's resources using the routes below. For team-specific
   workflows, read the matching Skill from the root AGENTS.md catalog.

Global Skill installation is optional. Do not install the bundled companion into
a manifest-linked team Skill directory. Installation, refresh and ownership are
covered by the [Skill reference](commands.md#standalone-companion-skill).

## Read a result before continuing

- `init`, `sync`, `doctor`, `release` default to JSON summaries. `omitted` counts
  normal rows/evidence; exceptions and recovery remain. Start with the summary;
  use `--fields` for needed evidence or `--details` when all rows are necessary.
  Explicit `--fields` projects the full result in any format: JSON/NDJSON emit one
  object; human output shows selected key/value pairs. Set the view before a write;
  capture its output once instead of repeating the write to retrieve details.
- For `init/sync/doctor`, read `preparation.state` and `preparation.scope`.
  `planned` is a preview, `ready` is verified required work, and `incomplete`
  retains all blockers and exits 12. Follow `preparation.next`; `next_actions` are Agent work, while `resume` waits
  for changed prerequisites.
  Optional activation stays separate. Doctor's `coverage` describes diagnostics.
- For `release`, inspect `ok`, coverage `complete` and warning/failure findings.
  It can exit zero with failures and does not publish anything.
- For `login`, retain `summary`, `problems` and step recovery fields. `handoff`
  needs input; `blocked` has an unfinished prerequisite; `not_started` was not attempted.
- Read partial stdout after a nonzero exit. It preserves completed effects and
  the failed phase. Keep stderr separate and parse JSON rather than truncating it.
- For `SKILL_WRITE_DENIED`, inspect the denied path and preserve completed work.
  Continue available source analysis or `sync --only repos,docs --no-refresh-manifest`.
  Retry Skill writes only after access changes; do not move shared locks.

See [report views](commands.md#workflow-report-views) and
[diagnostic fields](commands.md#diagnostic-reports) when interpreting a result.

## Execution boundaries

Use `--workspace <name-or-root>` to select a registered workspace directly.
Use `workspace list/show` to discover registered roots and their health from any
directory, including when manifest loading fails. Use `repo list`, `env list`, `agent list`, `tool list`, `config list` and
`member list` to discover names. `repo show` and `where` resolve exact aliases;
use canonical names for mutations. An ambiguous match is not permission to guess.

Before querying a service, use `fx where <repo> --env <env>` and select its
`capability` row. Without a repository, use `fx can <capability|tool> [--env <env>]`.
Inspect `ready`/`status`, coordinates and handoffs, then use the companion's Skill.
A printed command is not permission for a write. fx's diagnostic provider queries
are read-only; source contributions use a separate explicit write workflow.

- Manifest vectors need exact-command trust. Existing approval for that vector
  counts; broad setup intent does not. `--yes` also approves vectors, so never
  use it to bypass an unresolved `VECTOR_UNTRUSTED` decision.
- Every write supports `--dry-run`; preview unfamiliar effects. Respect
  `READONLY_BLOCKED` and do not add `--allow-writes` without authorization.
- For `INPUT_REQUIRED` / `CONFIRM_REQUIRED`, reuse already-authorized input.
  Ask only for a missing decision or human-only step. Foreign guide/configuration/Skill replacement needs concrete approval
  and a backup.
- Inspect scoped public connection settings and their provenance. Never dump
  environment variables, read credential stores or copy personal credentials.
  A blocked check is unverified, not proof that credentials are missing or expired.
- Member results belong on stdout, not in logs or shared instructions. Keep
  private coordinates and evaluation evidence in the team's controlled source.

Errors on stderr use `{error: {category, code, message, hint, next_steps, retryable}}`.
Follow the supplied recovery. The [command reference](commands.md)
describes output exceptions and error/coverage fields.

## Recover, verify, resume

`LOGIN_REQUIRED` or a non-ready result enters recovery. Retain the original task
and its scoped `can`/`where` query.
Authorization persists across steps; a handoff does not expand it.

1. Diagnose the selected tool/environment with `doctor --tool <tool>` and
   `login <tool> --env <env> --dry-run --no-input`. Omit `--env` for unscoped tools.
   `login --list` describes recipes without verifying them. Load the companion's
   Skill before provider-specific setup.
2. Perform authorized local preparation. Verify the package, registry and exact
   vectors before installation. Preserve working configuration; fix confirmed
   PATH/runtime problems before reinstalling. A run step may still open a browser
   or create credentials, so inspect its effects.
3. Hand off only what requires the person: consent, access, credentials or a new
   approval. Never request tokens in chat. Continue independent work while waiting.
4. Re-run the same readiness check and resume the original task on `ready`.
   Do not repeat unchanged failures or reinitialize successful setup.

`no_access` means an environment is outside personal selection. `not_covered`
means missing declared coverage. Neither establishes a remote permission denial.
See [detailed recovery](commands.md#readiness-and-recovery) for tool,
registry, authentication and trust failures.

If fx cannot start, follow the workspace's bootstrap guidance. Inspect the entry,
runtime and PATH before reinstalling. A verified `node <checkout>/bin/fx.js` can
stand in for `fx`; `self update` cannot repair an entry that cannot execute.

## Routing

| Task                                       | Entry                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Discover or repair workspace identity      | `fx workspace list/show`; `workspace relocate/rebind/unregister --dry-run`               |
| Choose an exact repository/environment set | `fx repo select <names...>`; `fx env select <names...>`; `--all` or `--none`             |
| Inspect checkouts                          | `fx status`; `--fetch` refreshes remote comparisons                                      |
| Update selected repositories/resources     | `fx sync --dry-run`; use `--only` to narrow stages                                       |
| Select repositories or environments        | `fx repo pick/unpick`; `fx env pick/unpick`                                              |
| Inspect one repository and owners          | `fx repo show <repo>`; `fx member show <name>`                                           |
| Find service diagnostics                   | `fx where <repo> --env <env>`                                                            |
| Check tools/access                         | `fx can <capability-or-tool>`; `fx doctor --tool <tool>`                                 |
| Inspect repository release criteria        | `fx release <repo> --only merge --details`                                               |
| Install/update a companion                 | `fx tool install <tool> --dry-run`; `fx tool update <tool> --dry-run`                    |
| Review tool provenance                     | `fx tool history [tool]`; `fx tool inventory`                                            |
| Inspect host resources                     | `fx agent skills`; `fx hook list`; `fx mcp list/show`                                    |
| Inspect declarations                       | `fx manifest validate --strict`; `fx manifest explain '<path>'`; `fx manifest providers` |
| Edit/render shared facts                   | `fx manifest repo-set`; `fx manifest record-probe`; `fx manifest render --check`         |
| Import existing checkouts                  | `fx manifest import <dir> --format json`                                                 |
| Contribute selected source files           | `fx source push <paths...> --issue <id> --title <title> --dry-run`                       |
| Inspect personal settings                  | `fx config list`; `fx config get <key> --explain`                                        |

Match the returned row by `capability`, not by a platform name from another manifest:

| Need                         | Capability      |
| ---------------------------- | --------------- |
| Runtime errors               | `error-tracker` |
| Service logs                 | `log-store`     |
| Service metrics              | `metrics`       |
| Builds and console output    | `ci`            |
| Read-only cluster inspection | `cluster`       |

For environment-wide queries use `fx can <capability> --env <env>`; for repository
hosting use `fx can code-host`.

`select` replaces a collection, `pick/unpick` add/remove names, `--all` follows
future shared additions and `--none` selects nothing. Initial `--repos` or
`--no-repos` applies before cloning; an init retry without them preserves selection.
Inspect preview coverage: remote source contents may be uninspected. `status --dirty`
includes untracked files; `dirty` itself keeps its tracked-change meaning and
`uncommitted` combines both. Use the reported workspace and empty reason.

Use `--format json` for results and `--help` for exact arguments. The table's
`pick/unpick` notation means separate commands. Bare topics show their commands;
help and completion prefer canonical names while preserving compatibility aliases.
`release` evaluates a checklist; it does not publish packages or deploy services.

## What sync will and will not do

Sync clones missing repositories and fast-forwards eligible clean branches. When
a different branch is checked out, it updates only the tracked branch ref.
It never checks out, resets, stashes, merges or rebases. Dirty or diverged work is
reported as `skip_dirty` / `skip_diverged`; inspect repository and resource outcomes.

The workspace root is a plain directory. Do not initialize or run Git there.
Write output that belongs to no repository under `.workbench/` as the derived
guide's workspace layout describes, not at the root; `status` returns what is
left there as `stray_entries`.
The manifest checkout is `~/.fx/workspaces/<name>/source`; `repo list` identifies
it with `origin: manifest`. Sync refreshes it only on a clean default branch;
`MANIFEST_REFRESH_KEPT` means the current branch or changes were preserved.
Directory/stdin sources are snapshots. A local Git source uses committed content.

Edit shared facts and team Skills in the source checkout. Team Skills live at
`skills/<name>/SKILL.md`; changes through a managed project link also change that
source. Validate with `manifest lint` and contribute through the verified personal
fork when authorized. Never push directly to upstream. See
[source contribution recovery](commands.md#source-contributions-and-recording)
for uncertain PR creation and conditional evidence recording.

## Selection and host resources

Agent selection spans all workspaces in this `FX_HOME`. `agent unpick` reconciles
owned resources across them; repository/environment selection remains local.
`agents: []` or empty `FX_AGENTS` selects none. Unset both overrides to restore
detection. `FX_HOME` does not isolate global Skill paths or companion credentials.

For manifest inspection/editing, explicit `--workspace`/`FX_WORKSPACE` wins over
source discovery around cwd. An unknown explicit name fails. Inspect the selected
source before editing. Tool operations use that workspace's merged baseline/patch;
`tool install/update` require names or `--all`. Inventory/history span all FX_HOME.

Start hosts at the workspace root. A Skill/hook/MCP projection does not establish
native activation or trust. `hook list` reports support and dated observations;
`mcp show` reports references, not secret values. Hooks refresh only the bounded
manifest/docs/Skills/readiness subset and never sync business repositories or
approve trust. Use `sync --only docs,skills` when root hooks are unavailable.
The tested Grok 1.0.25 host requires a Git root for project hook discovery; keep
using the plain workspace root and explicit sync.

## Tools, service settings and updates

Init installs only missing, enabled tools explicitly marked `install_on_init`.
This can write to a global package prefix. Existing binaries are preserved; ordinary
sync never installs packages. `tool_install` and history distinguish installation
from version verification. Inventory's `unused` is a suggestion, never uninstall
authorization; inspect unregistered projects before removing anything manually.

Service declarations contain public connection settings and authentication methods,
never personal credentials. Init/explicit sync prepare them before repository
queries; background hooks only check. Conflicts preserve existing settings.
Follow the [service reference](commands.md#service-preparation) for
native context conflicts and scoped login.

fx reuses npm's effective user/global scope Registry, then its default Registry;
`FX_REGISTRY` is an optional override. `self info` reports `registry_source`.
Project npmrc does not redirect global self-update. Internal `@fx/devkit` still
needs a private target; public `@angelmsger/fx` can fall back to npmjs. Normal
metadata reads use npm authentication, including `NPM_CONFIG_USERCONFIG`.
`FX_OUTDATED` and `MANIFEST_OUTDATED` are advisory. Update within the user's scope,
then rediscover the running version and read its bundled Skill. `fx skill install`
refreshes installed copies explicitly. See [update notices](commands.md#update-notices).
