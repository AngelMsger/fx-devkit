# Using fx

Install fx, connect your team’s manifest, and work with repositories and coding agents.

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
access from your team, then set `FX_REGISTRY` before installing. The public npm
release is on hold. These commands require the version to be available in that Registry.

```sh
export FX_REGISTRY=https://npm.example.com/
npm login --registry="$FX_REGISTRY"
npm install -g @fx/devkit --registry="$FX_REGISTRY" --@fx:registry="$FX_REGISTRY"
fx --version
```

The URL above is fictional. Explicitly selecting both registries prevents an
existing scope setting from redirecting this installation.

In PowerShell, use `.cmd` entries if local policy blocks `.ps1` shims:

```powershell
$env:FX_REGISTRY = 'https://npm.example.com/'
npm.cmd login --registry=$env:FX_REGISTRY
npm.cmd install -g @fx/devkit --registry=$env:FX_REGISTRY --@fx:registry=$env:FX_REGISTRY
fx.cmd --version
```

<!-- /distribution -->

<!-- distribution:public -->

### Public package

The public distribution uses `@angelmsger/fx` from npmjs. It does not require your
team's private Registry. Public publication is currently on hold; use this command
only once your selected release is available.

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

Create a workspace from the source your team supplies. If you do not have one,
start with the [manifest guide](manifest-guide.md). Replace angle-bracket
placeholders before running commands:

```sh
fx init ./work --name work --from <manifest-repository> --dry-run
fx init ./work --name work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` first installs missing tools explicitly marked `install_on_init` in the
team manifest and enabled, after command trust approval, then synchronizes repositories and
selected agent resources. Existing tool installations are preserved. Registration
can succeed while some synchronization stages fail; inspect the reported failures
and retry the relevant stages after resolving access or setup.

Initialization can adopt an existing directory; `--adopt` is retained for
compatibility and is no longer required. Inspect the plan with `--dry-run`
before adopting or changing an unfamiliar workspace. When a checkout has only
`origin` and its URL exactly matches the declared upstream, sync adds `upstream`
without changing `origin`, the current branch or local files. The plan exposes
`upstream_to_add`; the result records `upstream_added`. Conflicting remotes remain
unchanged and need review.

Bring repositories up to date and inspect a service:

```sh
fx sync --dry-run
fx sync
fx status
fx repo list
fx where <repo> --env <environment>
fx can <capability> --env <environment>
```

`where` prints coordinates and commands; it does not execute those commands.
`can` and `doctor` check readiness now. Follow their handoffs when configuration,
authentication or access is missing. A generated report is not itself a passing
check: inspect `ok`, `complete` and individual findings.

Choose exact sets with `fx repo select` and `fx env select`; use `pick/unpick`
to add or remove individual names.
`fx config set agents claude-code,codex` selects agent resources; omitting that
setting enables detection. `fx sync --only docs,skills` refreshes just those
resources. Every command's exact syntax is available through `--help`.

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

`--all` follows the team's full shared collection, including future additions.
An explicit list containing every current name remains a fixed list. `--none`
selects no shared entries. Machine-local repositories and the manifest checkout
remain separately managed. Lists and selection results identify the active mode,
so an empty selection cannot be confused with an unset default.

## Read repository status

`fx status` identifies the workspace and includes untracked-file counts.
`fx status --dirty` finds both tracked modifications and newly created,
untracked files. JSON preserves `dirty` for tracked/index modifications and
adds `uncommitted` for either kind of work. Ignored files are not untracked
work. An empty result explains whether no repositories are selected or no
selected repositories match the filter.

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
`where` for service coordinates, and `release` for the declared release checklist.

### Companion tools and trust

`tool list/show` explains requirements; `tool install/update` uses available
installers; `login` guides setup. Companions own authentication. Manifest-supplied
execution vectors require trust, and a changed vector requires new trust.
Acknowledging a manual step never substitutes for a successful verification.

Tool definitions combine the bundled baseline with the selected workspace's
`tools.yaml` patch. Workspace selection is `--workspace`, `FX_WORKSPACE`, the
registered root containing the current directory, then `default_workspace`.
Without a resolved workspace, tool commands use the bundled baseline. The package
manager owns installation locations; tools are shared across workspaces.

`tool install` and `tool update` require names or `--all`, never both. Install's
`--all` selects enabled tools missing from PATH; update's `--all` selects all
enabled tools in the selected toolchain. Named operations can explicitly select
a disabled tool. No-argument invocations fail before package operations.

Doctor checks tools declared by the workspace and dependencies of providers
active in the selected environments. Bundled tools the workspace does not
declare are still checked on request with `doctor --tool <name>`; their absence
does not make an unrelated workspace unhealthy. An opt-in tool is not in the
toolchain at all until the workspace names it, so `tool list`, `tool install`
and a scoped `doctor --tool` do not see it. A disabled dependency of
an active provider remains an incomplete requirement, not a passing check.
Init and sync use the same relevant tool scope. Missing optional tools remain
visible without blocking preparation. An enabled `install_on_init` tool must be
verified; a disabled optional tool does not become required merely because that
installation flag is set.

### Shared service settings and personal credentials

A manifest can declare public `service` settings such as URLs, contexts,
organizations and authentication methods. `init`, explicit `sync` and `login`
prepare them through trusted companion commands; background hooks only check.
Preview service changes with `fx sync --only services --dry-run`.

Configuration and authentication are separate. Each member obtains and stores
credentials through the companion CLI. Existing conflicting settings are preserved
and reported for review; sync never signs in or activates another context. Sentry
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
fx skill status             # installed copies and the declared session version
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

Installation, version alignment and declared loading are separate facts. After
reading the bundled instructions, agents declare `FX_SKILL_LOADED=1` and
`FX_SKILL_VERSION=<bundled_skill_version>`; a declaration is not proof of reading.
Bootstrap commands stay quiet. Other non-TTY commands provide advisory guidance
until the version matches; `FX_SKILL_NOTICE=0` suppresses it.

**Team Skills** live in the manifest's `skills/` tree. Init/sync link that tree into
selected hosts and generate a catalog in the root AGENTS.md. Start at the workspace
root; child-repository discovery is not guaranteed. Refresh with
`fx sync --only docs,skills`. Never install the bundled companion through a shared
team Skill link; use a user copy or an independent directory.

### Team MCP and rules

Harness declarations project owned MCP entries and rule pointers into selected
hosts. Secret values remain environment references. `mcp list/show` and
`can mcp:<name>` explain prerequisites; a correct configuration does not prove
native host activation. See [agent usage](user-guide.md#for-coding-agents).

### Workspace lifecycle

Managed hooks may return cached context and schedule manifest/docs/Skills refresh
at session start. They do not sync business repositories or approve trust. Native
project and hook trust remain owned by the host. Use `hook list`, `hook enable`
and `hook disable`; [lifecycle](user-guide.md#for-coding-agents) describes the boundaries.

### Shared source contributions

`source push` previews or submits selected source changes while preserving the
source checkout's HEAD, index and working files. It requires evidence of a personal
fork and its upstream relationship. Inspect `fx source push --help` and the
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
| Find service coordinates and release evidence | `where`, `release`                                                                 |
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

The manifest chooses which providers and companion tools a workspace uses.
These are the currently implemented provider families:

| Capability                 | Providers                                  |
| -------------------------- | ------------------------------------------ |
| Code hosting               | Bitbucket CLI; local bare Git repositories |
| CI                         | Jenkins CLI                                |
| Logs                       | OpenObserve CLI                            |
| Error tracking             | Sentry CLI                                 |
| Cluster discovery          | kubectl, with read-only query vectors      |
| Issues and knowledge       | Feishu Project; Confluence CLI             |
| Communication entry points | Lark CLI; WeCom CLI                        |

Run `fx manifest providers` and `fx tool list` for your workspace's actual
bindings. Communication and knowledge entries hand off to companion tools;
fx does not proxy every service API.

Agent discovery includes Claude Code, Codex CLI, Cursor and other registered
hosts. **Skill delivery, hooks, MCP and rules have different support per host.**
Use `fx agent list`, `fx hook list` and `fx mcp list` to inspect the relevant
capabilities instead of assuming feature parity. See the
[agent usage](user-guide.md#for-coding-agents).

## For coding agents

Start with `fx self info --format json`, read the returned bundled Skill (or
`fx skill show`), then declare `FX_SKILL_LOADED=1` and the matching
`FX_SKILL_VERSION`. Use the [Skill](../skills/fx-workspace/SKILL.md) for task routing.

stdout carries results; stderr carries notices, progress and error envelopes.
Keep the streams separate. Collections use `{items, has_more, next?}`.
`--no-input` prevents prompts; `--quiet` suppresses notices and progress.

`init`, `sync`, `doctor` and `release` default to JSON summaries. They preserve
counts, exceptions and recovery actions; `omitted` counts rows/evidence left out.
Use `--details` for full results. Explicit `--fields` projects the full result,
in every output format, while `--verbose` controls diagnostics. JSON/NDJSON emit
one projected report object; human output shows the selected key/value pairs.
For example, `fx sync --fields operation,preparation_complete,items,summary` keeps
those report fields and omits stage details. Dotted paths retain flat keys.
Without `--fields`, human/NDJSON behavior is unchanged. Fact queries such as
`repo list`, `where` and `can` still project each item and retain collection metadata.

| Result              | What to read                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `init`, `sync`      | `operation` and `preparation_complete`: previews use `null`; apply is complete only for selected repositories and requested stages. |
| `doctor`, `release` | `ok` means no failure findings; `complete` means no requested check lacks coverage. Warnings still matter.                          |
| `can`               | `status` and any `handoff`; readiness is separate from a specific remote query succeeding.                                          |

Doctor/release can exit zero with failing findings. Init/sync can report partial
success, and errors may follow partial stdout. A protected dirty/diverged checkout,
blocked or failed stage, or unverified activation prevents preparation from being
complete. Excluded resources do not. Preparation does not establish remote health.

Choose the output view before executing a write. For an authorized sync, capture
the full result once and inspect the same file afterward:

```sh
fx sync --format json --details > sync-result.json
```

Read that JSON with a parser; do not truncate it with byte limits or repeat sync
just to obtain details. Partial results and the original stderr error must both
be considered. See [response contracts](../skills/fx-workspace/references/commands.md).

## Migrating to 0.2.0

- Workflow JSON now defaults to summaries. Scripts that need successful rows or
  finding evidence should add `--details`; existing `--fields` projections still
  use the full result.
- An explicit empty agent selection now means none. Use `config unset agents`
  and remove any `FX_AGENTS` override to restore automatic detection.
- Agents declare `FX_SKILL_VERSION` after reading the current bundled Skill.
  The old `FX_SKILL_LOADED=1` boolean alone does not verify the version.

These contracts are described in [agent usage](#for-coding-agents) and
[agent selection](#agent-selection).

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

`init` can register a workspace before a later phase fails. Read partial stdout
even after a nonzero exit, then resolve the reported cause before retrying the
same name, source and directory. A symlink alias of the same root is accepted;
a different root remains a conflict.

| Evidence                            | Meaning and next step                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `registered` / `written`            | Whether registration exists / this invocation wrote local state; neither proves preparation completed.       |
| `failed_phase`, `phases`, `failure` | Identify where init stopped and retain the original recovery steps.                                          |
| `sync.stages`, `sync.stage_details` | Init's repository/resource outcomes; sync exposes these without the `sync` prefix.                           |
| `tool_install`                      | Installation attempts; `code: null` is not success. A version-check failure can follow a successful install. |
| `observed`                          | Disk state after a Skill failure; a failed write may already have changed the destination.                   |

Choose a targeted recovery after fixing the cause. For `SKILL_WRITE_DENIED`, inspect
the denied path; changing `FX_HOME` does not relocate shared Skill locks. Local
repository/guide work can continue with
`fx sync --only repos,docs --no-refresh-manifest`. This does not fix the Skill
stage. Do not retry the same permission failure or approve an untrusted vector
without the required authorization.

`INIT_PREPARED` reports the plan before installers/cloning. Init's dry run inspects
local directory, stdin and committed local Git inputs and describes repository
actions without applying them. A fresh remote-source dry run does not fetch the
source: `source_inspected: false` identifies that boundary, and any requested
selection remains unverified until source inspection. Follow the preview's
next steps to inspect a local checkout when its contents must be reviewed first.
The plan separates intended registration/materialization from actual state;
`registered` is no longer shorthand for a planned or newly created registration.
Git manifest refresh and preview preserve modified, untracked and ignored source
payload files that fx reads. This source-specific protection does not change the
business checkout synchronization policy.
Progress on stderr reports active repositories and elapsed time; it is not a Git
transfer percentage or ETA. Full JSON requires `--details`.

For missing or outdated tools, login, manifest validation and updates, use
[Support](support.md#troubleshooting). `no_access` means an environment is outside
personal selection, not a remote ACL denial. Git transport uses its own credentials;
optional code-host API probes are separate.
Repository readability is probed again on normal retries, so an earlier missing
repository does not remain blocked by an old negative cache.

### Skill ownership and host activation

Bundled user Skills are shared across workspaces and protected by a user-wide
lock. Team Skill links belong to their workspace; companion installers own their
own version behavior. A matching file alone does not prove native activation.

Inspect `hook list` for supported and unverified states. In the tested Grok 1.0.25
host, project hooks require a Git root; normal directory trust does not enable them
at a plain workspace root. Use explicit `fx sync --only docs,skills`, and keep the
workspace root a plain directory. Host execution approval remains independent of fx.
