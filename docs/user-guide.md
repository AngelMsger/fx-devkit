# Using fx

Install fx, connect your team’s manifest, and work with repositories and coding agents.

## Requirements

- Node.js ≥22 (development uses Node 24), or Bun as an alternative runtime.
- Git on PATH. Companion CLIs can be installed afterward through `fx tool install`.
- A manifest source: use your team's repository or [create your own](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/).
- npm for global installation and `fx self update`, including when using Bun.

macOS and Linux are supported. Native Windows adapters are implemented, but
Windows execution and real host activation remain unverified. Windows targets
PowerShell 5.1/7 and cmd on local NTFS, without requiring WSL, Git Bash,
administrator privileges or Developer Mode. See [platform support](https://angelmsger.github.io/fx-devkit/docs/support/#platform-support).

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
[update guide](https://angelmsger.github.io/fx-devkit/docs/support/#updates).

## Quick start

Create a workspace from the source your team supplies. If you do not have one,
start with the [manifest guide](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/). Replace angle-bracket
placeholders before running commands:

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` first installs missing tools explicitly marked `install_on_init` in the
team manifest, after command trust approval, then synchronizes repositories and
selected agent resources. Existing tool installations are preserved. Registration
can succeed while some synchronization stages fail; inspect the reported failures
and retry the relevant stages after resolving access or setup.

Initialization can adopt an existing directory; `--adopt` is retained for
compatibility and is no longer required. Inspect the plan with `--dry-run`
before adopting or changing an unfamiliar workspace.

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

Limit what this machine tracks with `fx repo pick/unpick` and `fx env pick/unpick`.
`fx config set agents claude-code,codex` selects agent resources; omitting that
setting enables detection. `fx sync --only docs,skills` refreshes just those
resources. Every command's exact syntax is available through `--help`.

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
fields. [Workspace concepts](https://angelmsger.github.io/fx-devkit/docs/getting-started/#concepts) explains their relationships.

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

### Tool installation history

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`, `tool install` and `tool update` persist attempts in
`$FX_HOME/tool-history.json` (default `~/.fx/tool-history.json`). Each attempt has
`started`, optional `installed`, and `finished` checkpoints, including the
workspace, package manager/package, redacted installation vector, exit code,
version and executable paths before and after the operation. `installed` means
that the package manager exited successfully, even if version verification later
fails. A lone `started` record does not prove successful execution. Dry runs,
manual instructions and unchanged tools skipped during init create no records.
The ledger is local operational evidence, excluded from profile exports.

`tool inventory` distinguishes **installation origin** from the definition origin
shown by `tool list/show`:

| installation_origin | Evidence                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `fx`                | A successful fx operation installed a previously absent executable; its recorded path still matches.                                   |
| `external`          | The known executable already existed without an fx installation receipt. Updating or reinstalling it through fx preserves this origin. |
| `unknown`           | Legacy records, interrupted operations or changed/missing paths cannot establish the current origin.                                   |

`external` does not identify who installed the tool; it includes tools installed
by a person or another manager. Observing PATH cannot prove historical ownership
or detect an outside replacement at the same path. Older v1 ledgers remain readable;
new operations write v2 checkpoints. Missing legacy ownership evidence stays unknown.
The new ledger is not intended to be opened by older fx versions.

Inventory checks known tools from bundled definitions and locally registered
manifests, plus packages retained in history after their definitions disappear.
Unrecorded PATH observations have `recorded: false`; package manager, package,
version and operation fields remain null rather than guessed. Inspection does not
write installation receipts or adopt existing executables.

Requirements are recalculated from **all workspaces registered in this FX_HOME**,
including enabled optional tools and bundled defaults. A matching binary or
manager/package keeps a tool `required`. Disable a bundled tool with
`enabled: false`; removing its patch restores the default. Only an installation
with `installation_origin: fx`, completed evidence, a matching executable path
and no remaining workspace requirement can become `unused`. External tools and
unknown origins never receive removal suggestions. `sync` emits `TOOL_UNUSED`
and returns `stage_details.tools.installations`; `doctor` adds advisory findings.
Neither command uninstalls anything.

Unreadable/quarantined manifests or incomplete evidence yield `unknown`; failed
attempts without success are `unverified`. A missing binary is `not_on_path`, a
replaced path is `changed`, and an operation outside a workspace is `unscoped`.
These states do not suggest removal. The check reads local manifests without
refreshing their remotes; other FX_HOME directories and unregistered projects
remain outside its dependency coverage. An invalid ledger blocks new package
operations before execution; preserve and repair it before retrying.

### Skills

The bundled **fx-workspace** Skill teaches agents to use fx, including workspace
initialization and readiness recovery. Install it before creating a workspace:

```sh
fx skill install
fx skill install --agent codex
fx skill status
fx skill path
fx skill show
```

`install` and `uninstall` detect agents in the selected scope by default; explicit
`--agent` accepts repeated or comma-separated IDs. `path` and `status` list all
known agents unless narrowed. Use `--project` for the current directory, or
`--dir ./custom-skills` for `<dir>/fx-workspace`; `--dir` excludes `--agent` and
`--project`. No workspace or service login is needed. Standalone target selection
is independent of configured workspace agents. Project detection uses native
markers; user detection also recognizes agent executables on PATH.

Explicit `skill install` refreshes recognized copies to this CLI's bundled version,
including same-version repairs and replacing a newer copy. `init` and `sync`
reuse same-version copies and never downgrade newer copies. Foreign paths need
confirmation and a backup. Preview with `--dry-run`; read-only posture applies.
`skill uninstall` removes recognized copies after confirmation (`--yes` for a
non-interactive call), preserves foreign paths, and leaves workspace selection
unchanged: a later sync can reinstall a selected host's user copy.

`status` distinguishes installation, version alignment and the `FX_SKILL_LOADED=1`
handshake. Installation does not prove the agent loaded the Skill. `path` reports
installation destinations; `self info` locates the bundled source. `show` prints
raw SKILL.md in every output format. Skill commands are local: no update checks,
manifest refresh, companion installers or service login probes. Non-TTY business
commands provide a structured discovery notice until the Skill is loaded; setup
and Skill commands remain quiet. `FX_SKILL_NOTICE=0` disables that notice.

**Team Skills** are maintained in the manifest's `skills/` tree and linked into
selected agents' project Skill directories by `init` and `sync`. Windows uses
junctions. The workspace root AGENTS.md also lists each Skill's trigger description
and a source link, so agents can read a matching Skill explicitly. Start agents at
the workspace root; this does not promise discovery from child repositories.
Use `agent skills` to inspect workspace delivery and `sync --only docs,skills` to
refresh guides and Skills. Never install the fx companion through a shared team
Skill link: such targets are rejected with `SKILL_SOURCE_PROTECTED`. Use a user
installation or an independent directory.

### Team MCP and rules

Harness declarations project owned MCP entries and rule pointers into selected
hosts. Secret values remain environment references. `mcp list/show` and
`can mcp:<name>` explain prerequisites; a correct configuration does not prove
native host activation. See [agent usage](https://angelmsger.github.io/fx-devkit/docs/getting-started/#for-coding-agents).

### Workspace lifecycle

Managed hooks may return cached context and schedule manifest/docs/Skills refresh
at session start. They do not sync business repositories or approve trust. Native
project and hook trust remain owned by the host. Use `hook list`, `hook enable`
and `hook disable`; [lifecycle](https://angelmsger.github.io/fx-devkit/docs/getting-started/#for-coding-agents) describes the boundaries.

### Shared source contributions

`source push` previews or submits selected source changes while preserving the
source checkout's HEAD, index and working files. It requires evidence of a personal
fork and its upstream relationship. Inspect `fx source push --help` and the
[command reference](https://angelmsger.github.io/fx-devkit/docs/cli/#fx-source-push) before an actual submission.

## Commands

Daily workflows remain top-level; resource operations live under a noun:

`agent skills` inspects workspace Skill delivery; `skill install/show/path/status/uninstall`
manage the bundled companion independently. `manifest repo-set` edits repository
fields; `manifest record-probe <repo> --env <env> --platform <platform>` records
verified coordinate evidence, with `--dry-run` returning a plan without probing.
`where` remains the coordinate query entry. Compatibility entries remain available:
`skill list`, `tool installed`, `hook inject/remove`, `manifest set` and
`where --probe --record` retain their existing operations. Topic help lists canonical
commands first and compatibility mappings separately. Command-name completion and
typo suggestions use canonical names; flags still complete after a typed alias.

For `manifest validate/lint/providers/repo-set/render`, explicit `--workspace` or
`FX_WORKSPACE` selects the registered source even inside another source checkout.
An unknown explicit name fails instead of falling back to that checkout. Without
an explicit selector, these commands use the source checkout around the current
directory before resolving a workspace. `manifest import <dir>` keeps its explicit
input directory. File-output options accept `-o` and `--out`, including render.

Collection flags such as `--only`, repeatable `--env` and `--agent` accept repeated
or comma-separated values. Agent selection is global: pick/unpick results include
`scope: global` and `affected_workspaces`; repository/environment selection reports
`scope: workspace` and `workspace`. Inventory/history cover the entire FX_HOME,
even when `--workspace` is supplied. Completion recognizes option values,
positional arguments and negative flags; regenerate installed completion scripts
after upgrading. Root and topic help accept leading global flags, but help, completion,
`skill show` and `manifest schema` emit their native text/artifact formats.

| Intent                                        | Entry                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Create/adopt and maintain a workspace         | `init`, `sync`, `status`                                                           |
| Configure access and diagnose readiness       | `login`, `doctor`, `can`                                                           |
| Find service coordinates and release evidence | `where`, `release`                                                                 |
| Browse and select repositories                | `repo list/show`, `repo pick/unpick`                                               |
| Register local repositories or find a fork    | `repo add/remove`, `repo fork/open`                                                |
| Select environments and agents                | `env list/show/pick/unpick`, `agent list/pick/unpick`                              |
| Inspect installed resources and tools         | `agent skills`, `mcp list/show`, `tool list/show/install/update/history/inventory` |
| Manage lifecycle resources                    | `hook list/enable/disable`                                                         |
| Find ownership and change shared declarations | `member list/show`, `manifest`, `source push`                                      |
| Manage preferences and fx itself              | `config`, `self info/update`, `completion`                                         |

`list/show` discovers resources; `pick/unpick` changes selection; `add/remove`
changes local registration. Bare topics show their available commands. Unknown commands and invalid
selectors produce structured errors. The
[generated CLI reference](https://angelmsger.github.io/fx-devkit/docs/cli/) owns the full syntax and flags.

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
[agent usage](https://angelmsger.github.io/fx-devkit/docs/getting-started/#for-coding-agents).

## For coding agents

```sh
fx status --format json --no-input
fx sync --dry-run --format json --no-input
fx doctor --format json --no-input
```

stdout is data. JSON collections use `{items, has_more, next?}`. Errors are JSON
on stderr with stable category/code, `hint`, `next_steps` and `retryable`.
Notices and progress also use stderr. `--fields` projects data; `--quiet` suppresses
notices; `--no-input` prevents prompts. Every write supports `--dry-run` and
read-only posture, with explicit `--allow-writes` for a single invocation.

Doctor/release exit zero even with failing findings. Init/sync may also return
partial results with exit zero: inspect `sync.summary` and `sync.stages` for init,
`summary` and `stages` for sync, and each failed item’s `failure`. `stage_details`
retains resource-stage results, including companion failure envelopes and hook/MCP
handoffs. Read report
coverage and handoffs instead of treating the exit code as readiness. A missing user step is
a handoff, never a reason to invent authentication or override host trust.

Use the bundled [fx-workspace Skill](https://angelmsger.github.io/fx-devkit/docs/agent-skill/) and its
[command guide](https://angelmsger.github.io/fx-devkit/docs/agent-commands/) for response semantics.
`fx self info --format json` locates the bundled Skill source. Set `FX_SKILL_LOADED=1`
after reading it, using your shell's environment syntax. The Skill is shipped in
the package; source architecture and verification pages are additional references.

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

## Reading initialization and recovery results

Bitbucket's optional repository and user probes each have a five-second process deadline. An unavailable or timed-out probe does not prevent Git transport; explicit repository access refusals and missing repositories remain authoritative. Cancellation and unexpected exceptions stop the operation. Progress begins during `preflight`, then switches to `apply` for repository changes.

On an interrupted Skill stage, `sync.stage_details.skills` retains `links`, `fx` and `tools`; tool installation retains `tool_install`. Item `status` distinguishes `done`, `failed`, `not_started`, `skipped` and dry-run `planned`. Resource rows include `observed` disk state on failure (`unknown` if observation also fails). A failed write may already have changed the destination. Installer `ran: true` means execution was attempted; `code: null` means no exit result was obtained. A `phase: version` failure with `code: 0` retains the successful package installation. Resolve the failed item before retrying; exceptions do not trigger later writes.

Retrying the same workspace name and source accepts a symlink alias of the registered root. Registration rechecks physical path identity under the configuration lock; a genuinely different root remains a conflict.

Positional arguments come only from argv; stdin is read only when explicitly requested, such as `init --from -`. A quoted multiword command is a usage error. Git clone uses Git credentials independently of the optional code-host API CLI. Git errors distinguish absent branches, transport authentication, connectivity and local conflicts; retry guidance retains the branch and destination.

After source validation and registration, `INIT_PREPARED` shows planned installation vectors and Skill destinations before tool execution or cloning. Missing tools can reveal additional Skill vectors after installation; those still require exact-command approval. A fresh remote-source `init --dry-run` does not fetch the source or claim to know its contents. Foreign-file replacement always needs approval and a backup.

If a later initialization phase throws, stdout retains a partial result with `failed_phase`, `phases`, the structured `failure`, completed repository results and recovery steps. Stages use `done`, `failed` or `not_started` in failure results; successful sync stages keep their normal summary counters. stderr retains the original error and the exit code remains nonzero. An untrusted Skill command is a blocked tool row (`tools_blocked`); independent owned local projections can complete. Inspect blocked and failed rows even when the command exits zero.

Repository progress on stderr reports completed/total, active repositories and elapsed time every five seconds while work is pending. It is a heartbeat, not Git byte progress or an ETA. Human output summarizes unselected repositories and large result lists; `--verbose` exposes unselected rows and `--format json` retains all details. A `FIELDS_UNMATCHED` notice means requested fields are absent from this response, possibly because they are optional; projection stays permissive and empty collections produce no such notice.

`missing_tool`, `outdated_tool` and `disabled_tool` are distinct readiness verdicts. Doctor tool evidence includes `binary_path`, resolved by the same PATH policy used for execution; it can point to a runtime-manager shim. A successful status process with `configured=false` does not establish readiness. Even configured prerequisites do not prove resource permissions or a successful remote query. `no_access` describes an environment outside your personal selection, not a remote ACL denial.

Personal config updates serialize read/modify/write and atomically replace the file. Retry `CONFIG_BUSY` after the competing update finishes. A validated Git-source checkout left by a failed initialization can be reused for the same source; foreign upstreams and local work remain protected.

### Skill ownership and host activation

Team Skill links belong to a workspace. The bundled fx Skill belongs to the user and selected host, is reused across workspaces, and during init/sync never replaces a newer recognized copy with an older version. Explicit `fx skill install` refreshes it to the invoking CLI version. Updates recheck ownership/version under a user-wide lock; foreign copies remain protected. Companion tools own their own Skill installer and version behavior, so fx can invoke those installers again during another workspace sync. Local Skill installation is not inherently a network operation; distinguish caller approval waits from an executing subprocess.

`agent list` exposes `detected`, `selected`, `selection` (automatic or explicit), and `active: null` because detection is not evidence of current activity. Set `fx config set agents <id,...>` explicitly before initialization to limit projections. `FX_HOME` isolates fx configuration, not global user Skills; use a separate HOME as well for experiments.

Grok 1.0.25 requires a Git root to discover project hooks. At a plain workspace root, normal directory trust can enable guides and Skills but does not fix hook discovery. `hook list` reports this activation limitation; run `fx sync --only docs,skills` explicitly. Do not initialize Git at the workspace root. Host execution approval or cancellation is separate from fx execution; auto mode does not disable host permission checks. Hooks fail open with a bounded `HOOK_FAILED_OPEN` diagnostic on stderr that omits raw input and exception text; a projection alone never proves activation.
