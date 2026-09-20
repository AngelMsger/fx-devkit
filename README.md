# fx-devkit

**One manifest for your repositories, tools, and coding agents.**

[![Node.js: 22 or newer](https://img.shields.io/badge/Node.js-%E2%89%A522-c4f36b?style=flat-square&labelColor=101211)](#requirements)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-c4f36b?style=flat-square&labelColor=101211)](LICENSE)

[Documentation](docs/README.md) · [Quick start](#quick-start) ·
[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

English · [日本語](docs/website/i18n/ja/getting-started.md) ·
[简体中文](docs/website/i18n/zh-Hans/getting-started.md) ·
[繁體中文](docs/website/i18n/zh-Hant/getting-started.md)

`fx` prepares a multi-repository workspace from your team's versioned manifest.
It synchronizes checkouts, prepares companion tools and agent resources, and
locates services, owners and environment-specific diagnostics. Each repository
keeps its own history, branches, dependencies and build system.

- Preview writes with `--dry-run`; sync preserves dirty and diverged checkouts.
- Share repository, tool and environment definitions while keeping personal
  selections and credentials local.
- Use human output interactively or JSON with explicit status and recovery steps.
- Keep authentication and service APIs in the companion tools you already use.

## Requirements

Use Node.js 22 or newer, Git and npm. Bun is also supported as an alternative
runtime. macOS and Linux are supported; native Windows execution and agent host
activation remain unverified. See [platform support](docs/support.md#platform-support).

The documentation follows current source. [Unreleased changes](CHANGELOG.md#unreleased)
may not be available in an installed package; its help and bundled Skill describe
that executable.

You also need a team manifest. Use an existing source or
[create one from your checkouts](docs/manifest-guide.md).

## Install

The internal package is `@fx/devkit`; the separately gated public package is
`@angelmsger/fx`. Both provide `fx`. Public publication is currently paused.

<!-- distribution:internal -->

For the internal package, use your team's existing npm configuration. If its
`@fx` scope is not configured yet, sign in once with the team Registry URL.
The URL below is fictional:

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
npm install -g @fx/devkit
fx --version
```

<!-- /distribution -->

<!-- distribution:public -->

When a public release is available, install from npmjs:

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
fx --version
```

<!-- /distribution -->

See the [installation guide](docs/user-guide.md#install) for source installations,
PowerShell commands and Registry routing. For updates, use
[Support and updates](docs/support.md#updates).

## Quick start

Replace `<manifest-repository>` with the source your team supplies. New workspaces
select all shared repositories by default; add `--repos <name,...>` to both init
commands to limit the first download:

```sh
fx init ./work --name work --from <manifest-repository> --dry-run
fx init ./work --name work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` registers the workspace, installs missing tools opted into initialization,
and synchronizes the selected repositories and resources. Partial success is
possible: registration and exit zero alone do not prove preparation is complete.
Read `preparation_complete` and recovery steps before continuing.

The workspace root is a plain directory. Its manifest source is stored separately
under `~/.fx/workspaces/<name>/source`; business repositories remain independent.

## Everyday commands

| Task                           | Command                                               |
| ------------------------------ | ----------------------------------------------------- |
| Find managed workspaces        | `fx workspace list` / `fx workspace show <name>`      |
| Inspect checkouts              | `fx status`                                           |
| Preview updates                | `fx sync --dry-run`                                   |
| Replace a repository selection | `fx repo select <name...>` / `fx repo select --all`   |
| Select repositories            | `fx repo pick <name...>` / `fx repo unpick <name...>` |
| Select environments            | `fx env pick <name...>` / `fx env unpick <name...>`   |
| Find a service                 | `fx where <repo> --env <environment>`                 |
| Check a capability             | `fx can <capability> --env <environment>`             |
| Refresh guides and Skills      | `fx sync --only docs,skills`                          |
| Inspect release checks         | `fx release --format json`                            |

Use `repo list`, `env list`, `agent list` and `tool list` to discover valid names.
Use `repo select` and `env select` to choose an exact set, `--all` to follow the
team's full set including future additions, or `--none` to select nothing.
`pick/unpick` add or remove individual names. First-time setup can limit cloning
with `fx init ./work --from <manifest-repository> --repos example-api,example-web --dry-run`.
`where` prints coordinates and commands; it does not execute those commands.
`release` reports on your repositories; it does not publish packages or deploy them.
The [CLI reference](docs/cli/README.md) and `fx <command> --help` own exact syntax.

## For coding agents

Run `fx self info --format json`, then read `SKILL.md` in its `bundled_skill`
directory, or run `fx skill show`. After reading, set `FX_SKILL_LOADED=1` and
`FX_SKILL_VERSION` to the returned `bundled_skill_version`. Global Skill installation
is optional. Start sessions at the registered workspace root to use team guidance.

Document updates recheck their planning snapshots and return `DOCS_WRITE_CONFLICT`
when they detect an intervening change. Partial docs results distinguish completed and
pending writes; inspect them before retrying.

`login` preserves partial results on stdout when it needs human input or a later
step fails. Read those results alongside stderr errors before retrying; the
[user guide](docs/user-guide.md) describes the result and recovery fields.

`init`, `sync`, `doctor` and `release` summarize JSON by default. Use `--details`
for full results or `--fields` to select fields from those results in any output
format. Explicit projection emits one report object in JSON/NDJSON and selected
key/value pairs in human output. Keep stdout
separate from diagnostic stderr. Do not repeat a write just to obtain a different
view of its output.

For `init/sync`, inspect `operation` and `preparation_complete`; preview completion
is `null`. For `doctor/release`, inspect both `ok` and coverage `complete`, plus
warnings and recovery steps. See the [bundled Skill](skills/fx-workspace/SKILL.md)
and [response contracts](skills/fx-workspace/references/commands.md).

## Configuration

`fx config list` shows settings and their sources. `fx config get <key> --explain`
shows the effective value. Explicit flags override environment, file and defaults.

Agent selection applies across workspaces in the same `FX_HOME`:
`fx config set agents codex` selects Codex; `fx config set agents ''` selects none.
`fx config unset agents` restores detection when `FX_AGENTS` is also unset.
`FX_HOME` relocates fx state, but not global Skills or companion credentials.

For service presets, tool installation history, host resources and shell
completion, see the [user guide](docs/user-guide.md). For information sharing and
local data, see [Your data and credentials](docs/user-privacy.md).

## Contributing and support

[CONTRIBUTING.md](CONTRIBUTING.md) covers local setup, checks and pull requests.
[Architecture](docs/design/README.md) describes current contracts;
[Roadmap](docs/roadmap.md) lists possible extensions.

Report reproducible problems through [support](docs/support.md#report-an-issue).
Include the version, operating system, command and a redacted reproduction.
Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

Licensed under the [Apache License, Version 2.0](LICENSE).
