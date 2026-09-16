# fx-devkit

**One manifest for your repositories, tools, and coding agents.**

[![Status: pre-release](https://img.shields.io/badge/status-pre--release-dfbf6b?style=flat-square&labelColor=101211)](docs/user-guide.md#install)
[![Node.js: 22 or newer](https://img.shields.io/badge/Node.js-%E2%89%A522-c4f36b?style=flat-square&labelColor=101211)](#requirements)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-c4f36b?style=flat-square&labelColor=101211)](LICENSE)
[![Structured output: JSON](https://img.shields.io/badge/output-JSON-c4f36b?style=flat-square&labelColor=101211)](#for-coding-agents)

[Documentation](docs/README.md) ·
[Quick start](#quick-start) ·
[Changelog](CHANGELOG.md) ·
[Report an issue](docs/support.md#report-an-issue)

English · [日本語](docs/website/i18n/ja/getting-started.md) ·
[简体中文](docs/website/i18n/zh-Hans/getting-started.md) ·
[繁體中文](docs/website/i18n/zh-Hant/getting-started.md)

`fx` turns a team's manifest into a working multi-repository environment. Sync
checkouts, prepare companion tools, equip coding agents, and find the right place
to investigate a service—all from one shared map.

> **Two distribution channels:** internal builds use `@fx/devkit`; public builds
> use `@angelmsger/fx`. Both install the `fx` command. Public release is currently
> on hold; use your team's internal installation source.

## Contents

- [Requirements](#requirements)
- [Installation](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Commands](#commands)
- [Integrations](#integrations)
- [For coding agents](#for-coding-agents)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Contributing and support](#contributing)

## Why

A checkout is only the beginning. Engineers still need the right tools, access,
service coordinates, team conventions, and agent context. fx makes those shared
facts discoverable without turning independent repositories into one build system.

- **Declare once.** Keep repositories, ownership, tools and environments in a
  versioned [team manifest](docs/manifest-guide.md).
- **Protect work in progress.** Sync eligible clean branches while preserving
  dirty, diverged and off-branch checkouts. Preview writes with `--dry-run`.
- **Give agents a shared map.** Distribute team Skills and supported native host
  resources, with structured results and explicit recovery steps.
- **Ask what is ready.** `can` and `doctor` check current setup; `where` locates
  a service's logs, builds, errors and cluster resources.
- **Keep your existing tools.** Companion CLIs own authentication and service
  protocols. Personal selections and trust records remain local.
- **Contribute shared knowledge.** Propose selected source changes through a
  verified personal fork using `source push`.

### A working session

Once the workspace is initialized, these are the everyday entry points:

```sh
fx status                                      # What changed locally?
fx sync --dry-run                              # What would a sync do?
fx can code-host --format json                 # Is this machine ready?
fx where example-api --env test                # Where do I investigate?
fx sync --only docs,skills                     # Refresh shared agent context
fx release --format json                      # Read the release evidence
```

`example-api` and `test` stand for entries in your manifest. `where` prints
commands; it does not execute them. Report generation and actual readiness are
separate: inspect findings, coverage and handoffs.

## Requirements

- Node.js ≥22 (development uses Node 24), or Bun as an alternative runtime.
- Git on PATH. Companion CLIs can be installed afterward through `fx tool install`.
- A manifest source: use your team's repository or [create your own](docs/manifest-guide.md).
- npm for global installation and `fx self update`, including when using Bun.

macOS and Linux are supported. Native Windows adapters are implemented, but
Windows execution and real host activation remain unverified. Windows targets
PowerShell 5.1/7 and cmd on local NTFS, without requiring WSL, Git Bash,
administrator privileges or Developer Mode. See [platform support](docs/support.md#platform-support).

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
[update guide](docs/support.md#updates).

## Quick start

Create a workspace from the source your team supplies. If you do not have one,
start with the [manifest guide](docs/manifest-guide.md). Replace angle-bracket
placeholders before running commands:

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` also synchronizes repositories and selected agent resources. Registration
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
fields. [Workspace concepts](docs/user-guide.md#concepts) explains their relationships.

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
Use `skill list` to inspect workspace delivery and `sync --only docs,skills` to
refresh guides and Skills. Never install the fx companion through a shared team
Skill link: such targets are rejected with `SKILL_SOURCE_PROTECTED`. Use a user
installation or an independent directory.

### Team MCP and rules

Harness declarations project owned MCP entries and rule pointers into selected
hosts. Secret values remain environment references. `mcp list/show` and
`can mcp:<name>` explain prerequisites; a correct configuration does not prove
native host activation. See [agent usage](docs/user-guide.md#for-coding-agents).

### Workspace lifecycle

Managed hooks may return cached context and schedule manifest/docs/Skills refresh
at session start. They do not sync business repositories or approve trust. Native
project and hook trust remain owned by the host. Use `hook list`, `hook inject`
and `hook remove`; [lifecycle](docs/user-guide.md#for-coding-agents) describes the boundaries.

### Shared source contributions

`source push` previews or submits selected source changes while preserving the
source checkout's HEAD, index and working files. It requires evidence of a personal
fork and its upstream relationship. Inspect `fx source push --help` and the
[command reference](docs/cli/README.md#fx-source-push) before an actual submission.

## Commands

Daily workflows remain top-level; resource operations live under a noun:

| Intent                                        | Entry                                                          |
| --------------------------------------------- | -------------------------------------------------------------- |
| Create/adopt and maintain a workspace         | `init`, `sync`, `status`                                       |
| Configure access and diagnose readiness       | `login`, `doctor`, `can`                                       |
| Find service coordinates and release evidence | `where`, `release`                                             |
| Browse and select repositories                | `repo list/show`, `repo pick/unpick`                           |
| Register local repositories or find a fork    | `repo add/remove`, `repo fork/open`                            |
| Select environments and agents                | `env list/show/pick/unpick`, `agent list/pick/unpick`          |
| Inspect installed resources and tools         | `skill list`, `mcp list/show`, `tool list/show/install/update` |
| Manage lifecycle resources                    | `hook list/inject/remove`                                      |
| Find ownership and change shared declarations | `member list/show`, `manifest`, `source push`                  |
| Manage preferences and fx itself              | `config`, `self info/update`, `completion`                     |

`list/show` discovers resources; `pick/unpick` changes selection; `add/remove`
changes local registration. Bare topics show their available commands. Unknown commands and invalid
selectors produce structured errors. The
[generated CLI reference](docs/cli/README.md) owns the full syntax and flags.

## Integrations

The manifest chooses which providers and companion tools a workspace uses.
Bundled tools have minimum version requirements; inspect them with `fx tool show <tool>`
and override `min_version` in the team’s `manifest/tools.yaml` when needed.
Tools marked `install_on_init: true` in that manifest are installed if missing
during `fx init`, after command trust approval. See the [initialization guide](docs/manifest-guide.md#install-a-team-tool-during-initialization).
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
[agent usage](docs/user-guide.md#for-coding-agents).

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

Use the bundled [fx-workspace Skill](skills/fx-workspace/SKILL.md) and its
[command guide](skills/fx-workspace/references/commands.md) for response semantics.
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

## Documentation

| Audience/question                             | Source                                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| Creating or importing a team manifest         | [Manifest guide](docs/manifest-guide.md)                   |
| Exact command syntax                          | [Generated CLI reference](docs/cli/README.md) and `--help` |
| Agent workflow and response interpretation    | [Bundled Skill](skills/fx-workspace/SKILL.md)              |
| Architecture, boundaries and current behavior | [Workspace guide](docs/user-guide.md#concepts)             |
| Release contents                              | [Changelog](CHANGELOG.md)                                  |

## FAQ

### Does fx require a monorepo?

No. Repositories keep their own branches, history, dependencies and build tools.
The managed workspace root is a plain directory. Existing checkouts can be
[imported and adopted](docs/manifest-guide.md#import-existing-checkouts).

### Does my team have to publish its manifest?

No. The toolkit and the team's operational data are separate. Keep the manifest
in a repository with appropriate access controls; credentials stay with their
owning tools. Read the
[public/private boundary](docs/user-privacy.md).

### Is a successful exit code enough to trust a report?

No. `doctor` and `release` can exit zero with failing findings; `init` and `sync`
can return partial results. Inspect `ok`, `complete`, stage outcomes and each
failure's recovery data. See the
[response contracts](skills/fx-workspace/references/commands.md).

## Contributing

Bug reports, focused fixes, documentation improvements and translations are
welcome. Start with the
[contributing guide](CONTRIBUTING.md)
for local setup, validation and pull-request expectations. Discuss substantial
behavior or provider changes in an issue before building them.

Feature changes include their documentation. Update the English source and
relevant translations together; the website build checks translation freshness.
The [roadmap](docs/design/README.md) lists potential
extensions separately from current functionality.

## Support and security

For a reproducible bug, [contact the maintainers](docs/support.md#report-an-issue)
with the output of `fx --version`, operating system, command, expected result and a redacted
reproduction. For setup failures, include the relevant `doctor` finding and handoff.

For suspected vulnerabilities, follow the
[security reporting guide](SECURITY.md).
Keep credentials, personal information and private team coordinates out of shared
reports.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Initialization can complete partially. For phase results, progress, tool readiness and Skill ownership, see the [recovery guide](docs/user-guide.md#reading-initialization-and-recovery-results). Git transport and code-host API setup are independent.
