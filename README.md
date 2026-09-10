# fx-devkit

**One manifest for your repositories, tools, and coding agents.**

[![Status: pre-release](https://img.shields.io/badge/status-pre--release-dfbf6b?style=flat-square&labelColor=101211)](https://angelmsger.github.io/fx-devkit/docs/getting-started/#install)
[![Node.js: 22 or newer](https://img.shields.io/badge/Node.js-%E2%89%A522-c4f36b?style=flat-square&labelColor=101211)](#requirements)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-c4f36b?style=flat-square&labelColor=101211)](https://github.com/AngelMsger/fx-devkit/blob/main/LICENSE)
[![Structured output: JSON](https://img.shields.io/badge/output-JSON-c4f36b?style=flat-square&labelColor=101211)](#for-coding-agents)

[Website](https://angelmsger.github.io/fx-devkit/) ·
[Documentation](https://angelmsger.github.io/fx-devkit/docs/) ·
[Quick start](#quick-start) ·
[Changelog](https://angelmsger.github.io/fx-devkit/docs/changelog/) ·
[Report an issue](https://github.com/AngelMsger/fx-devkit/issues)

English · [日本語](https://angelmsger.github.io/fx-devkit/ja/docs/getting-started/) ·
[简体中文](https://angelmsger.github.io/fx-devkit/zh-Hans/docs/getting-started/) ·
[繁體中文](https://angelmsger.github.io/fx-devkit/zh-Hant/docs/getting-started/)

`fx` turns a team's manifest into a working multi-repository environment. Sync
checkouts, prepare companion tools, equip coding agents, and find the right place
to investigate a service—all from one shared map.

> **Pre-release:** install from a source checkout using the instructions below.
> Check the package's availability before using a global npm installation.

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
  versioned [team manifest](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/).
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
- A manifest source: use your team's repository or [create your own](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/).
- npm for global installation and `fx self update`, including when using Bun.

macOS and Linux are supported. Native Windows adapters are implemented, but
Windows execution and real host activation remain unverified. Windows targets
PowerShell 5.1/7 and cmd on local NTFS, without requiring WSL, Git Bash,
administrator privileges or Developer Mode. See [platform support](https://angelmsger.github.io/fx-devkit/docs/support/#platform-support).

## Install

The planned public release installs from npm without team registry configuration:

```sh
npm install -g @angelmsger/fx
fx --version
```

This is the installation path for the public release, not a claim that the
package is already available. Use the source checkout as described below for this pre-release.

If your npm configuration redirects the `@angelmsger` scope to an old registry,
explicitly select public npm for this installation:

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
```

In PowerShell, use `.cmd` entries if local policy prevents running npm's `.ps1`
shims; fx does not require changing that policy:

```powershell
npm.cmd install -g @angelmsger/fx
fx.cmd --version
```

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

### Skills

Selected agents receive a link to the manifest's team Skills and a versioned copy
of fx's bundled Skill. Foreign directories and files are preserved. Windows uses
directory junctions for the live team tree. Use `skill list` to inspect delivery
and `sync --only skills` to reconcile it.

### Team MCP and rules

Harness declarations project owned MCP entries and rule pointers into selected
hosts. Secret values remain environment references. `mcp list/show` and
`can mcp:<name>` explain prerequisites; a correct configuration does not prove
native host activation. See [agent usage](https://angelmsger.github.io/fx-devkit/docs/getting-started/#for-coding-agents).

### Workspace lifecycle

Managed hooks may return cached context and schedule manifest/docs/Skills refresh
at session start. They do not sync business repositories or approve trust. Native
project and hook trust remain owned by the host. Use `hook list`, `hook inject`
and `hook remove`; [lifecycle](https://angelmsger.github.io/fx-devkit/docs/getting-started/#for-coding-agents) describes the boundaries.

### Shared source contributions

`source push` previews or submits selected source changes while preserving the
source checkout's HEAD, index and working files. It requires evidence of a personal
fork and its upstream relationship. Inspect `fx source push --help` and the
[command reference](https://angelmsger.github.io/fx-devkit/docs/cli/#fx-source-push) before an actual submission.

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
`fx self info --format json` locates the installed Skill. Set `FX_SKILL_LOADED=1`
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

| Audience/question                             | Source                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Creating or importing a team manifest         | [Manifest guide](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/)            |
| Exact command syntax                          | [Generated CLI reference](https://angelmsger.github.io/fx-devkit/docs/cli/) and `--help` |
| Agent workflow and response interpretation    | [Bundled Skill](https://angelmsger.github.io/fx-devkit/docs/agent-skill/)                |
| Architecture, boundaries and current behavior | [Workspace guide](https://angelmsger.github.io/fx-devkit/docs/getting-started/#concepts) |
| Release contents                              | [Changelog](https://angelmsger.github.io/fx-devkit/docs/changelog/)                      |

## FAQ

### Does fx require a monorepo?

No. Repositories keep their own branches, history, dependencies and build tools.
The managed workspace root is a plain directory. Existing checkouts can be
[imported and adopted](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/#import-existing-checkouts).

### Does my team have to publish its manifest?

No. The toolkit and the team's operational data are separate. Keep the manifest
in a repository with appropriate access controls; credentials stay with their
owning tools. Read the
[public/private boundary](https://angelmsger.github.io/fx-devkit/docs/private-manifest/).

### Is a successful exit code enough to trust a report?

No. `doctor` and `release` can exit zero with failing findings; `init` and `sync`
can return partial results. Inspect `ok`, `complete`, stage outcomes and each
failure's recovery data. See the
[response contracts](https://angelmsger.github.io/fx-devkit/docs/agent-commands/).

## Contributing

Bug reports, focused fixes, documentation improvements and translations are
welcome. Start with the
[contributing guide](https://github.com/AngelMsger/fx-devkit/blob/main/CONTRIBUTING.md)
for local setup, validation and pull-request expectations. Discuss substantial
behavior or provider changes in an issue before building them.

Feature changes include their documentation. Update the English source and
relevant translations together; the website build checks translation freshness.
The [roadmap](https://angelmsger.github.io/fx-devkit/docs/roadmap/) lists potential
extensions separately from current functionality.

## Support and security

For a reproducible bug, [open an issue](https://github.com/AngelMsger/fx-devkit/issues)
with the output of `fx --version`, operating system, command, expected result and a redacted
reproduction. For setup failures, include the relevant `doctor` finding and handoff.

For suspected vulnerabilities, follow the
[security reporting guide](https://github.com/AngelMsger/fx-devkit/blob/main/SECURITY.md).
Keep credentials, personal information and private team coordinates out of public
reports.

## License

Licensed under the [Apache License, Version 2.0](https://github.com/AngelMsger/fx-devkit/blob/main/LICENSE).
