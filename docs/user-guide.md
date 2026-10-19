# Using fx

Install fx, connect your team’s manifest, and work with repositories and coding agents.

See the [version history](../CHANGELOG.md) for release changes. Check
`fx <command> --help` and the Skill bundled with your installed executable for
the features it supports.

Choose the section for your task:

- New workspace: [install](#install), then [quick start](#quick-start).
- Large workspace: [choose repositories before downloading](#choose-repositories-before-downloading).
- Interrupted setup: [read the result and recover](#reading-initialization-and-recovery-results).
- Coding agent: [use structured results and the bundled Skill](#for-coding-agents).

## Requirements

- Node.js ≥22 (development uses Node 24), or Bun as an alternative runtime.
- Git on PATH. Companion CLIs can be installed afterward through `fx tool install`.
- A manifest source: use your team's repository or [create your own](manifest-guide.md).
- npm for global installation and `fx self update`, including when using Bun.

macOS and Linux are supported. Native Windows adapters are implemented, but
Windows execution and real host activation remain unverified. Windows targets
PowerShell 5.1/7 and cmd on local NTFS, without requiring WSL, Git Bash,
administrator privileges or Developer Mode. See [platform support](support.md#platform-support).

## Install

<!-- distribution:internal -->

### Internal package

The internal distribution uses `@fx/devkit` through your team's private Registry. Obtain its URL and npm
access from your team. Existing npm scope configuration is reused; `FX_REGISTRY`
is an optional override, not a required installation setting. These commands
require the version to be available in that Registry.

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
npm install -g @fx/devkit
fx --version
```

The URL above is fictional. `npm login --scope=@fx --registry=...` associates the
scope with that Registry. If it is already configured, only the install command
is needed. `fx self info --format json` reports the effective `registry` and
`registry_source` without changing npm configuration.

In PowerShell, use `.cmd` entries if local policy blocks `.ps1` shims:

```powershell
npm.cmd login --registry=https://npm.example.com/ --scope=@fx
npm.cmd install -g @fx/devkit
fx.cmd --version
```

<!-- /distribution -->

<!-- distribution:public -->

### Public package

The public distribution uses `@angelmsger/fx` from npmjs. It does not require your
team's private Registry.

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
fx --version
```

In PowerShell, use `npm.cmd` and `fx.cmd` if the execution policy blocks `.ps1` shims.
<!-- /distribution -->

### Run from source

In the fx-devkit checkout, using the development versions in `package.json`:

```sh
npm ci
npm run build
node bin/fx.js --help
node bin/fx.js --version
```

In the examples below, replace `fx` with `node /absolute/path/to/fx-devkit/bin/fx.js`
when running from source. Building is required because the launcher loads `dist/`.

### Updates

For a source installation, update your checkout and run `npm ci` and
`npm run build` again. `fx self info --format json` shows the running version
and configured package registry. See the
[update guide](support.md#updates).

## Quick start

You need two things: the manifest source supplied by your team and a directory
for the workspace. You can ask your coding agent: “Use fx to prepare this manifest
in this directory.” If you are running the commands yourself:

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
```

fx checks the source, prepares authorized local tools and configuration, clones
the selected repositories, and prepares the Agent guides and Skills. The name
is derived from the directory and avoids existing registrations. Existing files
and completed work are preserved.
Review the displayed commands before approving new manifest actions.

When fx reports **Ready to work**, you can start. If it needs personal sign-in,
access or approval, it reports the remaining items together. Complete those
items and use the printed continuation command:

```sh
fx init --resume --workspace work
```

The terminal output prints each personal sign-in command and a continuation command. Run personal sign-in in your own terminal, then use the continuation after the listed prerequisites change.

A continuation verifies current state and skips completed preparation. It does
not reimport a directory source or rebuild checkouts. You do not need to choose
internal stages or run a separate diagnostic sequence to finish initialization.

New workspaces select all shared repositories. To limit the first download,
[choose repositories](#choose-repositories-before-downloading) and add `--repos`
to the initial preview and apply. Existing directories are adopted automatically.
For everyday updates use `fx sync`; `fx status` shows repository state.

## Find and manage workspaces

`fx workspace list` works from any directory, including when no default is set
or a registered workspace has a missing root or manifest. `fx workspace show <name>`
reports its identity, source, health and selection context without requiring a
healthy manifest. Use `fx status --workspace <name>` to inspect one explicitly;
otherwise the containing workspace takes precedence over `default_workspace`.

```sh
fx workspace list
fx workspace show work
fx status --workspace work
fx config set default_workspace work
```

When a directory has already moved, use `workspace relocate <name> <new-dir>` to
update its registration. It does not move or clone the checkouts. Use
`workspace rebind <name> --from <source>` to change the manifest source while
preserving that workspace's identity and personal selections. A second name for
the same physical directory is not a migration.

`workspace unregister <name>` ends management while retaining business
checkouts. Preview lifecycle changes with `--dry-run` and inspect any owned
resource cleanup or conflict before applying. Foreign files are preserved.

## Choose repositories before downloading

Limit the initial download by passing `--repos` to init. The selected names must
exist in the inspected manifest. `--no-repos` starts with an empty repository
selection. Repeating init without either flag retains an existing selection.

```sh
fx init ./work --from <manifest-repository> --repos example-api --dry-run
fx init ./work --from <manifest-repository> --repos example-api
```

For an existing workspace, `select` replaces the collection; `pick` adds names
and `unpick` removes them. Selection changes do not delete files, and changing
selection alone does not download a checkout. Run sync when ready to obtain or
update selected repositories.

```sh
fx repo select example-api
fx repo pick example-web
fx sync --dry-run
fx sync
fx repo select --all
fx env select dev
fx env select --none
fx env select --all
```

Manifests using explicit Git URLs without a code-host binding need no code-host username to synchronize repositories.

The catalog remains available even when a repository has not been downloaded. Ask your Agent to work on that repository, or run `fx repo show <name>`: its `next_steps` select the missing repository and synchronize checkouts in the correct workspace. Then continue in the reported path.

`--all` follows the team's full shared collection, including future additions.
An explicit list containing every current name remains a fixed list. `--none`
selects no shared entries. Machine-local repositories and the manifest checkout
remain separately managed. Lists and selection results identify the active mode,
so an empty selection cannot be confused with an unset default.

Only these commands change the environment selection. `fx login` never asks for
it: with none set it covers every declared environment and says how to narrow
it, and `--env` limits one invocation without changing the selection.

## Read repository status

`fx status` identifies the workspace and includes untracked-file counts.
`fx status --dirty` finds both tracked modifications and newly created,
untracked files. JSON preserves `dirty` for tracked/index modifications and
adds `uncommitted` for either kind of work. Ignored files are not untracked
work. An empty result explains whether no repositories are selected or no
selected repositories match the filter.

The workspace root is not a Git repository, so `fx status` also returns
`stray_entries`: files and directories at the root that are not a checkout, a
derived guide, the Go workspace fx keeps, agent or service configuration, or the
workbench. `fx doctor`
lists each one in its `root` group as a warning that does not affect readiness.

Sync preserves working files and branches. Read the planned action: tracked
modifications can cause `skip_dirty`, while a checkout on another branch can
update only the tracked branch reference. A status report does not itself run
fetch; add `--fetch` explicitly when remote comparisons must be refreshed.

## Concepts

### The workspace and the manifest

A workspace is a registered plain directory containing independent checkouts and
managed agent resources. The manifest lives separately under
`~/.fx/workspaces/<name>/source`. fx never runs Git at the managed workspace root.
Sync preserves dirty, diverged and off-branch work rather than checking out,
resetting or stashing it.

Output that belongs to no repository goes under `.workbench/` at the workspace
root: one dated directory per task for reports, plans and evidence,
`worktrees/` for `git worktree add` targets, and `tmp/` for anything disposable.
The derived guide gives agents the same rules. fx never writes inside it.

The root `AGENTS.md` is the one guide fx derives, and agents read it on their
own. Claude Code does from 2.1.277, provided no `CLAUDE.md` or `CLAUDE.local.md`
sits at the workspace root or above it. One that does is read in place of the
guide, so start it with `@AGENTS.md`.

The manifest's workspace, environments, tools and members documents describe
shared facts; optional harness declarations describe MCP resources and rules.
Use `fx manifest explain '<path>'` or `fx manifest schema --kind <kind>` to inspect
fields.

### Your personal layer

Configuration registers roots and preferences. Agent selection is shared by all
workspaces registered in the same FX_HOME. Per-workspace local layers select
repositories and environments and carry personal overrides. `repo add`
registers a local reference; `repo remove` removes that reference, never its files.
A profile export carries settings to another machine without copying credentials,
trust records or manifest checkouts.

### Capabilities and providers

A capability describes an intent such as code hosting, CI, logs or error tracking.
A provider implements it through its companion CLI. The manifest binds capabilities
to providers and environment-specific coordinates. Use `can` for readiness,
`where` for service coordinates, and `release check` for the declared release checklist.

A workspace binds `code-host`, `issue-tracker`, `knowledge-base`, `im`,
`calendar`, `meeting`, `task` and `worklog` once; an environment binds
`error-tracker`, `log-store`, `metrics`, `ci` and `cluster` per platform
instance. `fx can` without a target lists them with what serves each one in this
workspace; `fx manifest providers` lists what is bound and what each capability
accepts. `calendar` is where schedules and availability live; `meeting` is the
conferencing system that holds online meetings, their recordings and minutes,
so a team that schedules in one product and meets in another binds both. On
WeCom, `wecom-calendar` lists the schedules its bot can see through the WeCom CLI,
while `wecom-calendar-cli` searches a local mirror of each member's own calendars,
history included; each member signs in and fills the mirror with
`wecom-calendar-cli sync` themselves.

`metrics` is served by `prometheus-cli`. Its coordinate is a service's scrape
job: `where` prints an `up{job="..."}` query that returns the label set of that
service's targets, the starting point for writing further selectors. A selector
that matches nothing still succeeds, so metrics offer no existence probe and
`where --probe` reports `unknown` for them rather than a guess.

### Companion tools and trust

`tool list/show` explains requirements; `tool install/update` uses available
installers; `login` guides setup. Companions own authentication, including which
service a stored credential may reach. Commands fx defines for bundled tools run
without confirmation; command vectors your team's `tools.yaml` adds or overrides
require trust once, and a changed vector requires new trust.
Acknowledging a manual step never substitutes for a successful verification.

Tool definitions combine the bundled catalog with the selected workspace's
`tools.yaml` patch, and the workspace's toolchain is the part of that the
workspace actually uses: the tools its bound providers drive, plus the tools its
patch names. `fx tool list` reports which of the two put each tool there, and
`--catalog` also lists the tools fx knows that nothing selects. Workspace
selection is `--workspace`, `FX_WORKSPACE`, the registered root containing the
current directory, then `default_workspace`. Without a resolved workspace there
are no bindings to read, so tool commands list the bundled catalog. The package
manager owns installation locations; tools are shared across workspaces.

`tool install` and `tool update` require names or `--all`, never both. Install's
`--all` selects enabled tools missing from PATH; update's `--all` selects all
enabled tools in the selected toolchain. Named operations can explicitly select
a disabled tool. No-argument invocations fail before package operations.

Doctor checks tools declared by the workspace and dependencies of providers
active in the selected environments. Bundled tools the workspace does not use
are still checked on request with `doctor --tool <name>`; their absence does not
make an unrelated workspace unhealthy. The toolchain itself spans every
environment the manifest declares, because installation is machine-wide, while
`doctor` narrows its checks to the environments in scope. A disabled dependency
of an active provider remains an incomplete requirement, not a passing check.
Init and sync use the same relevant tool scope. Missing optional tools remain
visible without blocking preparation. An enabled `install_on_init` tool must be
verified; a disabled optional tool does not become required merely because that
installation flag is set.

The bundled Sentry tool can be installed with npm (`sentry`), including during init when the manifest opts in.

### Shared service settings and personal credentials

A manifest can declare public `service` settings such as URLs, contexts,
organizations and authentication methods. `init`, explicit `sync` and `login`
prepare them through the companions' own commands; background hooks only check.
The declared authentication method is the default for a context fx creates. If your
own context already reaches the declared service, it is ready however you signed in.
Preview service changes with `fx sync --only services --dry-run`.

Configuration and authentication are separate. Each member obtains and stores
credentials through the companion CLI. Existing conflicting settings are preserved
and reported for review; sync never signs in or activates another context. It does
associate a login you already have for the same service with the workspace's
context, on every run, so there is nothing to remember after you sign in elsewhere. Sentry
uses public workspace `.sentryclirc` defaults and preserves foreign files.

In sync results, inspect `stages.services` and `stage_details.services.items`
(`sync.*` for init). Default JSON retains blocked/failed rows; `--details` also
shows successful rows. See [service presets](manifest-guide.md#public-service-presets)
for the declaration format and [response contracts](../skills/fx-workspace/references/commands.md#service-preparation)
for recovery details.

### Tool installation history

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`, `tool install` and `tool update` record attempts in
`$FX_HOME/tool-history.json`. `installed` means the package manager succeeded;
version verification can still fail. A lone `started` record does not establish
success. Dry runs and init's skipped existing tools create no records.

Inventory separates installation origin from the definition source shown by
`tool list/show`:

| installation_origin | Meaning                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `fx`                | fx installed a previously absent executable and the recorded path still matches.              |
| `external`          | The executable existed without an fx installation receipt; updating it preserves this origin. |
| `unknown`           | The available records or current path cannot establish origin.                                |

Requirements cover all workspaces registered in this `FX_HOME`, including enabled
optional tools and bundled defaults. Only a confirmed fx installation with no
remaining requirement can be `unused`. The suggestion is advisory: unregistered
projects and other `FX_HOME` directories are outside this check. `sync` and
`doctor` never uninstall packages. Unreadable manifests or incomplete evidence
cannot establish that removal is safe.

Inspection does not adopt PATH tools or reconstruct older installation history.
See [inventory fields](../skills/fx-workspace/references/commands.md#installation-audit-and-inventory)
and [local data](user-privacy.md#what-stays-on-your-machine) for details.

### Skills

The bundled **fx-workspace** Skill teaches agents to use fx. It can be read
without installation or a registered workspace:

```sh
fx self info --format json   # bundled_skill and bundled_skill_version
fx skill show               # print the bundled SKILL.md
fx skill status             # installed copies and their versions
```

To make a copy discoverable by a host, use `fx skill install --agent codex`.
`--project` targets the current directory; `--dir ./custom-skills` targets an
independent directory and excludes `--agent` and `--project`. Standalone Skill
commands choose their own targets, independently of workspace agent selection.
See the [Skill reference](../skills/fx-workspace/references/commands.md#standalone-companion-skill)
for detection, replacement and uninstall behavior.

Explicit `skill install` refreshes recognized copies to the invoking CLI version,
including same-version repair or replacement of a newer copy. `init/sync` reuse
same-version copies and never downgrade newer ones. Foreign replacements require
confirmation and backup. Uninstalling a copy does not unselect its host, so later
sync may install it again.

`skill status` reports installation versions and `activation: unverified`.
An installed file is not proof that the host loaded it. Read the bundled guide
when needed.

**Team Skills** live in the manifest's `skills/` tree. Init/sync link that tree into
selected hosts and generate a catalog in the root AGENTS.md. Start at the workspace
root; child-repository discovery is not guaranteed. Refresh with
`fx sync --only docs,skills`. Never install the bundled companion through a shared
team Skill link; use a user copy or an independent directory.

### Team MCP and rules

Harness declarations project owned MCP entries and rule pointers into selected
hosts. Secret values remain environment references. `mcp list/show` and
`can mcp:<name>` explain prerequisites; a correct configuration does not prove
native host activation.

### Workspace lifecycle

Managed hooks may return cached context and schedule manifest/docs/Skills refresh
at session start. They do not sync business repositories or approve trust. Native
project and hook trust remain owned by the host. Use `hook list`, `hook enable`
and `hook disable`; [host activation](#skill-ownership-and-host-activation) explains
the unverified states `hook list` reports.

### Shared source contributions

`source push` previews or submits selected source changes while preserving the
source checkout's HEAD, index and working files. It requires evidence of a personal
fork and its upstream relationship, and a manifest source hosted on Bitbucket or
GitHub. Inspect `fx source push --help` and the
[command reference](cli/README.md#fx-source-push) before an actual submission.

## Commands

Daily workflows remain top-level; resource operations live under a noun.
Use `fx <topic> --help` for canonical commands and compatibility aliases.
Flags describe whether they accept repeated or comma-separated values.
`select` takes space-separated names; init's `--repos` takes a comma-separated list.

| Intent                                        | Entry                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Create/adopt and maintain a workspace         | `init`, `sync`, `status`                                                           |
| Discover or change workspace registrations    | `workspace list/show/unregister/relocate/rebind`                                   |
| Configure access and diagnose readiness       | `login`, `doctor`, `can`                                                           |
| Find service coordinates and release evidence | `where`, `release check`                                                           |
| Browse and select repositories                | `repo list/show/select`, `repo pick/unpick`                                        |
| Register local repositories or find a fork    | `repo add/remove`, `repo fork/open`                                                |
| Select environments and agents                | `env list/show/select/pick/unpick`, `agent list/pick/unpick`                       |
| Inspect installed resources and tools         | `agent skills`, `mcp list/show`, `tool list/show/install/update/history/inventory` |
| Manage lifecycle resources                    | `hook list/enable/disable`                                                         |
| Find ownership and change shared declarations | `member list/show`, `manifest`, `source push`                                      |
| Manage preferences and fx itself              | `config`, `self info/update`, `completion`                                         |

`list/show` discovers resources; `select` replaces a selection; `pick/unpick`
adds/removes selected names; `add/remove`
changes local registration. Bare topics show their available commands. Unknown commands and invalid
selectors produce structured errors. The
[generated CLI reference](cli/README.md) owns the full syntax and flags.

## Integrations

The manifest chooses which providers and companion tools a workspace uses. Run
`fx manifest providers` for what each capability is bound to in your workspace,
and `fx tool list --catalog` for every companion tool fx knows, including those
nothing here selects. Communication and knowledge entries hand off to companion
tools; fx does not proxy every service API.

Agent discovery includes Claude Code, Codex CLI, Cursor and other registered
hosts. **Skill delivery, hooks, MCP and rules have different support per host.**
Use `fx agent list`, `fx hook list` and `fx mcp list` to inspect the relevant
capabilities instead of assuming feature parity.

## For coding agents

Start with `fx self info --format json`. For initialization, read the returned
`initialization_guide`; it is the short route from a source and directory to a
verified workspace. Keep the exact executable prefix. The full
[Skill](../skills/fx-workspace/SKILL.md) covers other tasks.

stdout contains results; stderr contains progress, notices and structured errors.
Use `--format json` and capture both streams. Workflow JSON keeps the preparation
verdict and every blocker; `--details` adds full stage evidence. Human output starts
with the task result and next action. Human `release check` output opens each
repository with what it would ship: the version its target branch declares, the head
commits of both branches, and how many commits on the source branch are not merged
into the target yet. Each repository with a failing or warning check gets its own
block with all of its checks, a problem every repository shares is stated once above
them, and the repositories whose checks all passed close the output one line each;
`--details` lists their checks too. On a terminal, human output
adds colour and symbols, fits tables to the width and prints an error as text; a pipe or a file
receives plain text and the JSON error envelope, and `NO_COLOR` removes the colour.
While a command works, the terminal also shows one status line with the time elapsed, how far
counted work has come and what it is waiting on; the line disappears when the
command ends, and a pipe, a file, JSON output and `--quiet` never receive it. While
git or an installer runs, which may ask for a host key or a passphrase on the same
terminal, the line is printed every five seconds instead of being redrawn. `--fields`
projects the complete report in any format, using flat keys for dot paths, for example:

```sh
fx sync --format json --fields operation,preparation.state,items,summary
```

| Result                   | Completion decision                                                                |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `init`, `sync`, `doctor` | `preparation.state`: `planned`, `ready`, or `incomplete`, for `preparation.scope`. |
| `release check`          | `ok`, `complete`, the findings and `repos`; it does not publish or deploy.         |
| `can`                    | `status` and the handoff for that capability.                                      |

Ready preparation exits 0; incomplete preparation exits 12. Preview is only a
plan. Fatal configuration/execution errors retain their category exit codes and
may include partial stdout. `doctor.coverage` describes diagnostic coverage
separately; optional native activation can remain unverified without blocking
required work. A projection file alone does not establish host activation.

Init executes authorized local preparation itself. Completed setup steps stay
visible in the result; do not repeat them while authentication is pending.

When capturing output for further analysis, use a location inside the authorized
task directory; Read-only posture cannot control shell redirection.

Read `preparation.next` first: review a preview, continue the original task when
complete, perform Agent actions, or hand off missing prerequisites.
`next_actions` contains Agent work only; personal actions stay on their blockers
with `actor: user`. Run `resume` after conditions change.

Read all `preparation.blockers` together. `next_actions` provide exact argument
vectors, working directories, optional environment coordinates and approval
requirements. Preserve the returned `argv`, `cwd` and `env`; `resume` continues the
registered workspace. Existing approval persists; new vectors need review. Never
infer success from registration or a clone, repeat a write to obtain more detail,
or copy personal credentials into a manifest.

For file conflicts, `stage_details.docs.files` (under `sync` in init) preserves
completed and unstarted writes. Foreign replacements require approval and retain
a sibling backup. See the [response contracts](../skills/fx-workspace/references/commands.md).

## Configuration

### What lives in `~/.fx`

Global configuration registers workspaces and preferences. Each workspace has its
manifest checkout, personal layer and owned projection state. Trust records and
caches stay on this machine. `FX_HOME` relocates fx's personal directory without
changing where companion tools store credentials.

### Settings

Use `fx config list` for the complete settings catalog, including default values,
environment names and effective sources. `fx config get <key> --explain` shows
applicable layers. Explicit flags override environment, file and built-in defaults;
get/list describe the same invocation. `config export/import` transfers a profile.
Import merges workspace registrations by name and retains registrations absent
from the profile. It replaces named personal layers, but refuses to change an
existing workspace's root or source: use `workspace relocate` or `workspace rebind`
first. Use `workspace unregister` to remove a registration deliberately.
The import plan lists registrations and preparation still needed; missing
manifest checkouts are restored with the printed init commands. Export does not
copy manifest checkouts, trust or credentials.

`format` controls result format. `command_shell` controls generated command text,
not execution: `auto` chooses PowerShell on Windows and POSIX elsewhere. Override
it with `--command-shell` or `FX_COMMAND_SHELL`; cmd users can set it to `cmd`.
Manifest-authored shell templates remain verbatim, and canonical evidence/trust
identities do not change with presentation.

Shell completion is opt-in. For example, PowerShell users can generate a script
and dot-source it in their own profile:

```powershell
fx.cmd completion powershell | Out-File -Encoding utf8 "$HOME\fx-completion.ps1"
. "$HOME\fx-completion.ps1"
```

Bash, zsh and fish are also available through `fx completion <shell>`.

### Agent selection

`fx config set agents codex` selects specific hosts; `fx config set agents ''`
selects none. An empty `FX_AGENTS` also selects none. Unset both overrides to
restore detection. Selection is global across workspaces in this `FX_HOME`.
`FX_HOME` relocates fx state, not global Skills or companion credential storage.

## Reading initialization and recovery results

Follow the continuation action in the result. If new source input was rejected
before acceptance, it returns the full original retry; otherwise resume uses the
managed source and existing selection. Registration and written files are effects,
not completion. `preparation.state` and its blockers own that decision.

Source validation identifies invalid fields before workspace effects. A local
preview inspects directories, stdin or committed Git contents; a fresh remote
source remains `source_inspected: false` until acquired. Known guide conflicts
and planned command vectors are shown before application; no preview grants trust.
Plain source guides are supported: missing fx regions are appended to generated
target guides, preserving source prose. Ambiguous markers require source repair.

Completed repositories, local preparation and user files survive a partial failure.
Resolve all reported prerequisites, then use the returned action. Existing installs
and successful setup checks are skipped on continuation. Relative verification
files are resolved from the workspace root. Names are generated for directories
with spaces or Unicode; use the returned workspace identity instead of guessing it.

`SKILL_WRITE_DENIED` identifies the protected path. Changing FX_HOME does not move
global Skill locks. Available repository/guide work can continue with
`fx sync --only repos,docs --no-refresh-manifest`, without claiming Skill repair.
Foreign replacement still requires approval and preserves a sibling backup.
Git-source refresh protects local work, and ordinary retries recheck repository
readability. [Support](support.md#troubleshooting) explains discovery and updates.

### Resume login after a handoff

When `login` needs human input, complete the authorized handoff and repeat the
same invocation. fx checks current state before rerunning actions; then recheck
the original `can` or `doctor` query and continue your task.

Machine callers must read partial stdout even after a nonzero exit, alongside
the error on stderr. Completed steps remain visible; `handoff`, `blocked`,
`failed` and `not_started` distinguish the remaining work. See the
[login response contract](../skills/fx-workspace/references/commands.md#readiness-and-recovery)
for summaries, plan problems and per-step recovery fields.

A step handed over says what its check answered. Its `check` carries the tool's own
message and, where fx can read the failure, the cause: authentication that was not
established, a permission the service refused or a connection that could not be
completed. The step's instructions then describe what resolves that cause, so read
them before signing in again. Most checks name no cause; go by the tool's message and
the step's guidance then.

A check that gave no answer, because its tool did not start or it ran out of time, is
never handed to a person. `can` and `where` list it as `unfinished` and answer
`unknown` when nothing else failed; `login` stops with that error and keeps the
partial result on stdout; `doctor` reports the finding with incomplete coverage. An
earlier fx omits these fields; `fx doctor --tool <tool> --env <env>` shows the tool's
message for one tool.

### Skill ownership and host activation

Bundled user Skills are shared across workspaces and protected by a user-wide
lock. Team Skill links belong to their workspace; companion installers own their
own version behavior. A matching file alone does not prove native activation.

Inspect `hook list` for supported and unverified states. In the tested Grok 1.0.25
host, project hooks require a Git root; normal directory trust does not enable them
at a plain workspace root. Use explicit `fx sync --only docs,skills`, and keep the
workspace root a plain directory. Host execution approval remains independent of fx.

### Reuse a login you already have

Initialization keeps the team's context names. Compatible companion CLIs match
an existing login to the same service and reuse its identity before asking you
to sign in. Tokens stay in the companion's credential store, and your current
context and existing identities are preserved. If several identities match,
choose a source with the companion's `auth reuse --from-context` command; network
or keychain failures are diagnosed separately from missing credentials.
