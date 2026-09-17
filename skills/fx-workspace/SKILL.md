---
name: fx-workspace
version: 0.1.2
description: 'Use only when the user explicitly asks for the fx workspace CLI or manifest, or the current task is inside an fx-managed workspace or routed by its fx-derived AGENTS.md. Drive workspace init and sync, repository status and selection, manifest validation and editing, companion tools and login, doctor, agent Skills, repository ownership, environment coordinates and readiness through can/where, and release checks across dependencies, branches, builds and errors. Do not use for generic Sentry, OpenObserve, Jenkins, Kubernetes, logs, errors or builds outside an fx-managed workspace.'
metadata:
  requires:
    bins: ['fx']
  cliHelp: 'fx --help; fx <command> --help'
---

# fx workspace

`fx` builds and maintains a shared multi-repository workspace from a private
manifest, and it is the single source for facts that vary by environment,
machine or person: coordinates, people, tool state, readiness. You are one
of its two users; the other is a person. Read this before composing commands.
Outside such a workspace, generic platform work belongs to that platform's
own Skill unless the user explicitly asks to initialize or inspect fx itself.

## Bootstrap and two Skill layers

Before initializing a workspace, `fx skill install` installs this companion for
locally detected agents. `--agent <id>` (repeatable or comma-separated) selects
hosts explicitly; `--project` targets cwd; `--dir <parent>` targets
`<parent>/fx-workspace` and excludes both other flags. Workspace selection is not
required and configured workspace agents do not select standalone install targets.
`fx skill path` lists destinations; `fx skill status` separates installed copies,
version alignment and this session's loaded handshake. `fx skill show` prints the
bundled SKILL.md verbatim, including with `--format json`. `self info` supplies its
source directory for reading references.

Explicit install refreshes a recognized copy to the invoking CLI version, including
same-version repair and downgrading a newer copy. Init/sync only install missing or
upgrade older copies. Writes accept `--dry-run` and preserve read-only posture;
foreign replacement needs confirmation and backup. Uninstall requires confirmation
and removes only recognized copies. A later workspace sync may reinstall them.
These commands perform local work without network update checks or companion probes.

The manifest's project Skills supply team workflows. Read the matching entry in
the workspace root AGENTS.md's Team Skills catalog, then follow its references as
needed. The catalog links directly to source files; native installation or loading
may still need host trust. Do not install this companion into a manifest-linked
project Skill directory: use a user target or independent `--dir` instead.

## Rules that never bend

- Always pass `--format json`, and run fx with `FX_SKILL_LOADED=1` in the
  environment: that tells fx this Skill is loaded and silences its Skill
  notices. stdout is data only; notices, progress and errors are on stderr.
  Collections are `{items, has_more, next?}`.
- Errors are `{error: {category, code, message, hint, next_steps, retryable}}`
  on stderr; the category is the exit code: usage 2, config 3, auth 4,
  permission 5, not_found 6, conflict 11, network 8, internal 1. Follow
  `next_steps`; do not guess.
- Never invent a repository, tool, agent, environment, key or person name:
  `fx repo list`, `fx tool list`, `fx agent list`, `fx env list`,
  `fx config list`, `fx member list` discover them.
- Coordinates come only from `fx where`; people only from
  `fx member show`. Never guess a Sentry project, a log stream, a Jenkins
  job, a namespace or an account handle.
- **fx answers; you act.** Before using a companion tool for a repository in
  an environment, ask `fx where <repo> --env <env>`: each row is one platform
  with its `command` and a `ready` column. fx derives that command from the
  manifest and prints it — it never runs it. Running it is yours to do, once
  the row says `ready`; otherwise inspect its status, `handoff` and alternatives
  through the recovery flow below. Without a repository, ask
  `fx can <capability|tool> [--env <env>]`. The only things fx itself runs
  for diagnosis are read-only checks: the `ready` column, `where --probe`,
  and the queries behind `fx release`. Explicitly authorized source contributions
  may push to a verified personal fork and create a pull request.
- Every write command has `--dry-run`. Preview first when the effect is not
  obvious. A `READONLY_BLOCKED` error means this session forbids writes;
  report it, do not add `--allow-writes` on your own.
- `VECTOR_UNTRUSTED` requires approval of the exact manifest vector. Existing
  approval for that vector in this session counts; broad setup authorization
  does not. Never use `--yes` to bypass an unresolved trust decision.
- `INPUT_REQUIRED` / `CONFIRM_REQUIRED` require the missing input or decision.
  Use an already-authorized answer when supported; otherwise ask specifically
  for what is missing. Foreign configuration/guide/Skill replacement requires
  approval of the concrete replacement and a backup.

## Recover, verify, resume

`LOGIN_REQUIRED` and non-ready `can`/`where` answers enter this flow.
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
| `unknown`, parse error or unexpected failure                      | Inspect focused diagnostics and the companion Skill; preserve uncertainty, redact sensitive output, and report an actionable blocker if evidence cannot resolve it.                                                |

## When you need something

Workspace hooks run when a supported, selected host starts at the workspace
root. They synchronize only the manifest, docs and Skills in the background.
Initial status context contains dated observations, not proof of current
readiness: ask `fx can` or `fx doctor` before acting on an old failure.
Grok does not receive SessionStart context; use `fx hook list --format json`
when lifecycle status matters. A current projection with `activation: unverified`
still needs native project/hook trust reviewed in the host. Relay its handoff;
never bypass host trust or add `--yes` for a manifest vector yourself.

`fx hook remove --format json` disables this workspace; `fx hook inject` enables
and projects it again. `FX_HOOKS=0` is a global invocation override. Starting
directly in a business repository or an external worktree is not covered by
root-level hooks: use `fx sync --only docs,skills --format json` when needed.

`fx where <repo> --env <env> --format json` answers the first four of these
in one call: one row per platform, each carrying its `capability`, the
`command` to run and a `ready` column. Match the row you want by
`capability` — what a platform is _called_ is the manifest's to choose and
yours to read, never to assume.

| Need to                             | Read the row whose `capability` is |
| ----------------------------------- | ---------------------------------- |
| look at runtime errors of a service | `error-tracker`                    |
| search the logs of a service        | `log-store`                        |
| check a build or its console output | `ci`                               |
| see what is running (read-only)     | `cluster`                          |

| Need to                                | Run                                                   |
| -------------------------------------- | ----------------------------------------------------- |
| any of those, without a repository     | `fx can <capability> --env <env>`                     |
| read or fork a repository, open a PR   | `fx can code-host`                                    |
| find a person or who owns a repository | `fx member show <name>`; `fx repo show <repo>` owners |

`fx env show <env>` names an environment's platform instances, if you want to
narrow the call with `--platform <name>`.

## Routing

Everyday, in the order a person meets them:

| Need                                                | Run                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Create a workspace; adopt an existing directory     | `fx init <dir> --from <git url \| directory \| ->`; existing directories are adopted safely           |
| Bring checkouts up to date without touching work    | `fx sync --dry-run --format json`, then `fx sync --format json` (pulls the manifest first)            |
| Walk a person through credentials and contexts      | `fx login [<tool>] [--env <env>]` — use the recovery flow above; `--list` shows the static plan       |
| Is this machine ready; what is missing              | `fx doctor --format json` (read `ok` and the `fail` findings; `--tool <tool>` for one tool)           |
| State of every checkout                             | `fx status --format json` (add `--fetch` to compare with upstream)                                    |
| Can this capability or tool be used right now       | `fx can <capability\|tool> [--env <env>] --format json`                                               |
| Where a service's errors / logs / builds / pods are | `fx where <repo> --env <env> --format json`; `--probe` asks the platform whether it is really there   |
| Is what we are about to ship ready                  | `fx release --format json`; `fx release <repo> --only merge --format json` for one finding's evidence |

Topics:

| Need                                                  | Run                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| What repositories exist, which are on this machine    | `fx repo list --format json`                                                                         |
| One repository: branch, dirtiness, URLs, owners       | `fx repo show <name> --format json`                                                                  |
| Track fewer or more shared repositories               | `fx repo pick <name...>` / `fx repo unpick <name...>`                                                |
| Register a checkout only this machine has             | `fx repo add <path> [--upstream <url>]`; undo with `fx repo remove <name>` (keeps files)             |
| Make or find your fork                                | `fx repo fork <name> --format json`                                                                  |
| Which environments exist, what each has               | `fx env list --format json`; `fx env show <env> --format json`; `fx env pick <env...>` to scope      |
| Who a person is across systems                        | `fx member show <name>`; `fx member list --area <area>`                                              |
| Which coding agents are here                          | `fx agent list --format json`; `fx agent pick\|unpick <id...>` to choose                             |
| Which workspace Skills each agent has                 | `fx skill list --format json`; `fx sync --only skills` links and copies them                         |
| Workspace lifecycle configuration and observations    | `fx hook list --format json`; `fx hook inject --dry-run` / `fx hook remove --dry-run`                |
| Declared MCP resources and readiness                  | `fx mcp list --format json`; `fx can mcp:<name> --format json`                                       |
| Propose selected shared source files                  | `fx source push <paths...> --issue <id> --title <title> --dry-run`                                   |
| Which tools the workspace expects; one in detail      | `fx tool list --format json`; `fx tool show <tool> --format json`                                    |
| Install or update a tool                              | `fx tool install <tool> --dry-run`; `fx tool update <tool>`                                          |
| Audit past tool operations and review unused packages | `fx tool history [tool] --format json`; `fx tool installed --format json`                            |
| Check the manifest                                    | `fx manifest validate --strict --format json`; `fx manifest lint`                                    |
| What a manifest field means                           | `fx manifest explain <path> [--kind <doc>]`; `fx manifest schema --kind <doc>`                       |
| Change one repository field                           | `fx manifest set <repo> <field> <value> --dry-run`                                                   |
| Which provider serves a capability                    | `fx manifest providers --format json`                                                                |
| Keep the manifest repository's AGENTS.md current      | `fx manifest render --check`; `fx manifest render` (the root's derived files: `fx sync --only docs`) |
| Describe a hand-built directory as a manifest         | `fx manifest import <dir> --format json`; `-o <file>` writes it, nothing else is touched             |
| Personal settings                                     | `fx config list`; `fx config get <key> --explain`; `fx config set <key> <value>`                     |
| Carry personal settings to another machine            | `fx config export -o me.yaml`; `fx config import me.yaml --dry-run`                                  |
| Where this fx is, and updating it                     | `fx self info --format json`; `fx self update`                                                       |

## Contributing shared knowledge

`fx source push <source-relative paths...> --issue <id> --title <title> --dry-run
--format json` previews the selected whole-file contribution. Inspect `action`,
`validated`, `files`, `target`, `branch` and `written`. `needs-fetch` with
`validated: false` is not a validated contribution. Applying requires write
posture and confirmation; never infer authorization from a preview.

The workflow preserves source HEAD, its real index, working files and unrelated
staged changes. A covering file set can update an existing open PR; --new requests
a separate branch. An unchanged tree does not push again. On an uncertain PR
creation, do not blindly repeat it: inspect the known PR and use --pr with its ID
or URL. If none was created, --new starts a separately identified contribution.
Missing fork-parent evidence is a companion upgrade/verification handoff, not
permission to infer a fork from its URL.

`fx where <repo> --env <env> --platform <platform> --probe --record --dry-run
--format json` previews conditional recording without a network probe. Applying
records only this invocation's definite resource evidence. `written: false`, a
null `after`, or a handoff is not successful recording. Repository-scoped results
never certify sibling repositories; notes retain templates and dates, not expanded
values. Contribute the resulting source change through source push when authorized.

For `@fx/devkit`, set FX_REGISTRY from the private team coordinate; `@angelmsger/fx` defaults to npmjs. This controls self-update checks and
`fx self update`; the generic package contains no registry address. This setting
does not grant write permission and does not configure npm authentication.

## Initialization tool installs

From fx 0.1.1, a manifest tool with `install_on_init: true` is installed during
`fx init` only when its binary is missing. This can write to the package manager's
global installation prefix. Review the exact installation and version-check
vectors through the usual trust flow; broad setup intent does not approve an
unknown vector. Existing binaries are preserved and ordinary `fx sync` never
installs packages. npm configuration owns private Registry access.

Check `tool_install` records on successful init. Dry runs do not materialize the
source and return `tool_install: null`; they never run installers. A failed
installation or version check stops init after registration may have occurred.
Resolve the reported installer/access/PATH problem and retry the same source and
directory; do not reinitialize unrelated workspaces or create credentials.

## Installation history and unused tools

`fx tool history [tool] --format json` reads persistent init/install/update
checkpoints, even after a tool leaves the manifest. `installed` records package
manager success separately from version verification; `started` alone proves
neither execution nor success. Dry runs and skipped existing tools leave no
records. History is local to FX_HOME, excluded from config export, and has no
backfill for older or externally installed packages.

`fx tool installed --format json` compares recorded packages against all locally
registered manifests. `required_by` lists enabled binary/package consumers;
`unknown_workspaces` prevents a removal suggestion when a source is unreadable.
`unused` is advisory: verify unregistered projects and other FX_HOME directories
before any manual removal. Sync emits `TOOL_UNUSED`, and doctor reports the same
candidates. Neither performs uninstallation. `unknown`, `unverified`, `changed`,
`not_on_path` and `unscoped` do not authorize cleanup. History persists after
manual removal; never delete it to hide an unresolved or failed operation.

## What sync will and will not do

`fx sync` clones what is missing, fetches, and fast-forwards a clean
checkout on its tracked branch. On any other branch it only moves the
branch ref. It never checks out, resets, stashes, merges or rebases; a dirty
or diverged checkout is reported as `skip_dirty` / `skip_diverged` with the
reason. Read the `action` and `result` of each item. Afterwards it derives
the root's AGENTS.md and CLAUDE.md from the manifest source, links team
Skills into agents, reconciles lifecycle/MCP projections and rules pointers,
and reports tool state. Inspect stage outcomes as well as repository rows.
Failed rows retain structured `failure` recovery data alongside the display
`error`; retry only the relevant work.

The workspace root is a plain directory, not a repository: never run git
there. The manifest repository is checked out under
`~/.fx/workspaces/<name>/source` (`fx self info`, or the `origin: manifest`
row of `fx repo list`), and that checkout is where it is edited: branch,
commit, push to your fork, open a pull request. `fx sync` fast-forwards it
only while it is clean on its default branch; on a branch or with changes it
reports `MANIFEST_REFRESH_KEPT` and uses what is checked out.

Directory sources include the manifest documents, source AGENTS.md/CLAUDE.md,
README.md, docs/ and skills/ resources. A local Git checkout uses its committed
snapshot. Stdin accepts either workspace.yaml alone or a complete `source_version: 1`
bundle with a `files` mapping (see the CLI README); omitted docs and Skills cannot
be reconstructed from workspace.yaml alone.

Existing user guides and Skill locations require confirmation before replacement.
Approved replacements preserve originals at unique `.fx-backup` paths. A preview
never prompts or writes; `INPUT_REQUIRED` names the conflict when no terminal is
available. Relay the paths for review rather than approving them on the user's behalf.

## Before a release

`fx release --format json` is doctor's report over the repositories on the
release checklist (the manifest's `release` block and `release.covered`):
`findings[]` of `group` (`deps`, `merge`, `ci`, `errors`), `id` (the
repository), `level`, `message`, and `evidence`. Read it as you read doctor:
`fail` is an item that cannot be ticked; `warn` is a check fx could not make
(a tool not ready, a platform that did not answer) and carries `handoff` or
`fix` for a person; `ok` includes "not checked" with the reason, which is an
declared exclusion rather than a passing check. `report.ok` is false only on
`fail`; a true value does not prove complete coverage. Inspect warnings and
skipped checks before claiming the requested release criteria are satisfied.
`complete: false` means a requested check has `coverage: incomplete`; exclusions
are `not_applicable`, completed checks are `checked`. A complete report can still
contain failures or advisory warnings.

- `merge`: `evidence.ahead` are commits on the source branch missing from
  the target, `evidence.behind` the reverse, `evidence.unknown` a direction
  nobody could compare; each `author` is resolved
  through members (`id` null when nobody matched the git name). Those
  authors are who to remind; `fx repo show <repo>` names the owner when
  nobody is. Merge and bot commits are filtered and counted in `filtered`.
- `deps`: `evidence.offending` lists every pre-release pin with its
  section; only runtime sections fail the check.
- `ci`: `evidence.builds` has both jobs with `current`, whether the last
  success started after the branch head (a time, not a revision: Jenkins
  does not say which commit it built); a build that ran before it, or did
  not succeed, fails. A job the platform does not have where the manifest
  says, or a success nothing can date, warns.
- `errors`: `evidence.issues` are the unresolved issues first seen inside
  `since`; use `sentry issue view <short_id>` for the stack when asked to
  explain one. The tracker was asked for activity inside the window, so it
  may hold older issues too; `evidence.undated` counts open issues it could
  not date, and `evidence.capped` says the list is a floor.

`--only`, `--tag`, repository names, `--env` and `--since` narrow the
report; naming a repository that is off the checklist is an error, not an
empty pass. fx produces no checklist format: how the report becomes a ticked
table or an incident list is your work, from these findings.

## When fx says something is behind

Commands other than Skill management, self-update, completion and lifecycle dispatch may end with one or two notices on stderr; the command's own
result is unchanged. `MANIFEST_OUTDATED`: the manifest repository has new
commits upstream since the last sync; run `fx sync` (a checkout parked on a
branch answers `MANIFEST_REFRESH_KEPT`, which is intended). `FX_OUTDATED`:
a newer fx is published; tell the user, and with their agreement run
`fx self update --yes`, then `fx skill install` so the Skill copies
follow. `fx doctor` asks both upstreams live (`self:version`,
`manifest:upstream`). The checks are cached (a day for fx, an hour for the
manifest), give an upstream at most two seconds (local reads and writes of
the cache and `~/.npmrc` are not under that clock), and are silent when it
does not answer;
`FX_UPDATE_CHECK=0` or `fx config set update_check false` turns them off,
doctor's included.

## Team Skills, and contributing one

Agent selection is shared by all workspaces registered in the same FX_HOME.
`agent unpick` reconciles owned resources across those workspaces; repository
and environment selection remain workspace-local.

The team's Skills are the `skills/` directory of the manifest repository,
linked as a whole into each agent's project Skill directory at the workspace
root (`<root>/.claude/skills`, `<root>/.agents/skills`, …). Agents discover
them from the root; started inside one of the repositories, an agent does
not see them, so start from the root when a task needs them.

To contribute a Skill, write it where the agent would look for it:
`<root>/.claude/skills/<name>/SKILL.md` (frontmatter `name: <name>` and a
`description`). Through the link it is already in the manifest checkout.
Then:

1. `fx manifest lint --format json` — the Skill rules are the `skills` kind.
2. `fx repo fork <manifest repository> --format json` — creates your fork,
   or finds it, and sets it as `origin` (idempotent; `fx sync` sets `origin`
   too once the code host knows you).
3. In the checkout (`fx repo show <manifest repository> --format json` gives
   its `path`): branch, commit, `git push -u origin <branch>`, then open a
   pull request (`fx can code-host` first). Never push to `upstream`.
4. Once merged, every workspace picks the Skill up on its next `fx sync`.
   Return the checkout to its default branch, or every sync will keep
   reporting `MANIFEST_REFRESH_KEPT`.

See [references/commands.md](references/commands.md) for the output shapes
of the answering commands.

## Workspace reference entries

`fx can issue-tracker`, `fx can knowledge-base` and `fx can im` can return
an `entry` from the manifest binding. Once status is ready, load the
companion Skill and use that entry for discovery. fx does not proxy
business queries or send messages. Lark uses the user identity explicitly;
a successful read check does not authorize a write.

`repo show` and `where` accept exact repository aliases and return the
canonical name. Use canonical names for mutations; an ambiguous alias is
a conflict, not permission to choose arbitrarily. Named links are
references, not commands to execute.

The source AGENTS.md owns team rules as prose. Its five generated regions
are project-index, capabilities, environments, ask-fx and team-skills. Before rendering
a source that still has the retired rules block, preserve any unique
instructions in prose; complete standalone retired blocks are removed.

## Workspace MCP resources

Use `fx mcp list --format json` to discover declarations and projections, then
`fx can mcp:<name> --format json` for current readiness. `fx mcp show <name>`
shows variable references and setup steps, never their values. Follow handoffs;
configuration presence does not prove native host activation.

`fx sync --only mcp --dry-run` previews managed entries. A person reviews new
startup/check vectors and reference bindings before actual projection. Rules
pointers are maintained by `sync --only docs`. Foreign entries stay untouched;
`agent unpick` removes only owned resources and preserves shared entries.

## Result and ownership details

Read partial init stdout even after a nonzero exit: failed_phase, phases and sync retain completed effects. Do not repeat completed work blindly. Skill tools_blocked rows preserve exact-command trust while independent local projections may succeed. Diagnose caller approval waits separately from local Skill copies. Readiness distinguishes outdated_tool and disabled_tool from missing_tool; doctor evidence.binary_path identifies the resolved executable. Per-user fx Skills are shared across workspaces and never downgraded; FX_HOME does not isolate HOME. Grok 1.0.25 cannot discover project hooks at a plain workspace root: use explicit fx sync --only docs,skills after normal host trust, never git init as a workaround.
