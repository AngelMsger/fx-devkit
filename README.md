# fx-devkit

`fx` turns a team's manifest into a multi-repository workspace: clone and sync
repositories, configure companion CLIs, equip coding agents, and discover where
to investigate a service. People use readable output; agents use structured
results with explicit readiness and recovery steps.

The project is `fx-devkit`. Its npm package name is `@angelmsger/fx`, providing
the `fx` command.
Public npm distribution is being prepared; it will not require a private registry.
The current checkout still has distribution blockers listed in the
[release checklist](https://angelmsger.github.io/fx-devkit/docs/public-release/).

## Contents

- [Requirements](#requirements)
- [Installation](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Commands](#commands)
- [For coding agents](#for-coding-agents)
- [Configuration](#configuration)
- [Development and documentation](#development)

## Why

The intended users are engineering team members and the coding agents assisting
them. The source can be shared independently of operational data: each team keeps
its manifest, ownership, service coordinates and access configuration private.
See [the public/private boundary](https://angelmsger.github.io/fx-devkit/docs/private-manifest/).

Repository URLs, ownership, environment coordinates and tool requirements belong
in one shared manifest. Personal selections and credentials belong on each
machine. fx connects the two without turning workspace updates into destructive
Git operations or taking over the companion tools' service APIs.

## Requirements

- Node.js ≥22 (development uses Node 24), or Bun as an alternative runtime.
- Git on PATH. Companion CLIs can be installed afterward through `fx tool install`.
- A manifest source: use your team's repository or [create your own](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/).
- npm for global installation and `fx self update`, including when using Bun.

macOS and Linux are supported. Native Windows adapters are implemented, but
Windows execution and real host activation remain unverified. Windows targets
PowerShell 5.1/7 and cmd on local NTFS, without requiring WSL, Git Bash,
administrator privileges or Developer Mode. See [acceptance limits](https://angelmsger.github.io/fx-devkit/docs/design/windows/).

## Install

The planned public release installs from npm without team registry configuration:

```sh
npm install -g @angelmsger/fx
fx --version
```

This is the installation path for the public release, not a claim that the
package is already available. Until the [release checklist](https://angelmsger.github.io/fx-devkit/docs/public-release/)
is complete, run the source checkout as described below.

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

`fx self info --format json` reports the runtime and effective update registry.
The public-release target is public npm by default, with no required `FX_REGISTRY`.
The current implementation still requires a private registry for update checks
and `fx self update`; see the [registry transition](https://angelmsger.github.io/fx-devkit/docs/design/registry-configuration/).
A source checkout is updated through Git and rebuilt with `npm ci` and
`npm run build`; `self update` installs the global npm package.

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
fields. [Architecture](https://angelmsger.github.io/fx-devkit/docs/design/) explains their relationships.

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
native host activation. See [harness contracts](https://angelmsger.github.io/fx-devkit/docs/design/harness/).

### Workspace lifecycle

Managed hooks may return cached context and schedule manifest/docs/Skills refresh
at session start. They do not sync business repositories or approve trust. Native
project and hook trust remain owned by the host. Use `hook list`, `hook inject`
and `hook remove`; [lifecycle](https://angelmsger.github.io/fx-devkit/docs/design/lifecycle/) describes the boundaries.

### Shared source contributions

`source push` previews or submits selected source changes while preserving the
source checkout's HEAD, index and working files. It requires evidence of a personal
fork and its upstream relationship. Inspect `fx source push --help` and the
[source contract](https://angelmsger.github.io/fx-devkit/docs/design/source-contributions/) before an actual submission.

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

## Development

Use the versions pinned in package.json. After `npm ci`, the required local gates
are lint, typecheck, Node/Bun unit tests, e2e, fresh CLI docs checks and the package
boundary scanner. Read [AGENTS.md](https://github.com/AngelMsger/fx-devkit/blob/main/AGENTS.md) for commands and contributor rules.
Windows acceptance has its own `npm run check:windows` entry; a POSIX test run is
not evidence of native Windows behavior.

Live companion contracts are opt-in with `npm run test:contract`. They are
read-only and require explicit test coordinates: `FX_TEST_BITBUCKET_HOST` and
`FX_TEST_BITBUCKET_REPO`; `FX_TEST_JENKINS_JOB` with optional
`FX_TEST_JENKINS_CONTEXT`; or `FX_TEST_SENTRY_HOST`, `FX_TEST_SENTRY_ORG` and
`FX_TEST_SENTRY_PROJECT`. Missing coordinates skip those contracts; configured
but failing access fails them.

Publication is separate from development. The current Jenkinsfile publishes on
`v*` tags through `scripts/publish.mjs`, whose private-only guard still blocks
public npm. Complete the [release checklist](https://angelmsger.github.io/fx-devkit/docs/public-release/) before
using that pipeline for a public release.

## Website

The static homepage and documentation live in `docs/website/`, with English, Japanese,
Simplified Chinese and Traditional Chinese versions. User guides are localized;
untranslated technical references are explicitly labeled in the selected language.
GitHub Pages is the deployment baseline, including repository subpaths.
Documentation pages are generated from this repository’s Markdown. Run `npm --prefix docs/website ci`,
`npm run site:build`, then `npm run site:dev` to preview them. See the
[website guide](https://angelmsger.github.io/fx-devkit/docs/website/) for maintenance and hosting.

## Documentation

| Audience/question                              | Source                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Creating or importing a team manifest          | [Manifest guide](https://angelmsger.github.io/fx-devkit/docs/manifest-guide/)            |
| Exact command syntax                           | [Generated CLI reference](https://angelmsger.github.io/fx-devkit/docs/cli/) and `--help` |
| Agent workflow and response interpretation     | [Bundled Skill](https://angelmsger.github.io/fx-devkit/docs/agent-skill/)                |
| Architecture, boundaries and current behavior  | [Design index](https://angelmsger.github.io/fx-devkit/docs/design/)                      |
| Contributor rules and checks                   | [AGENTS.md](https://github.com/AngelMsger/fx-devkit/blob/main/AGENTS.md)                 |
| Current delivery evidence and remaining limits | [Validation](https://angelmsger.github.io/fx-devkit/docs/validation/)                    |
| Release contents                               | [Changelog](https://angelmsger.github.io/fx-devkit/docs/changelog/)                      |

## License

Licensed under the [Apache License, Version 2.0](https://github.com/AngelMsger/fx-devkit/blob/main/LICENSE).
