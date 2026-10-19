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

The documentation follows current source. See the [version history](CHANGELOG.md)
for release changes; an installed package's help and bundled Skill describe
that executable.

You also need a team manifest. Use an existing source or
[create one from your checkouts](docs/manifest-guide.md).

## Install

The internal package is `@fx/devkit`; the public package is `@angelmsger/fx` on
npmjs. Both provide `fx`.

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

Install from npmjs:

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
fx --version
```

<!-- /distribution -->

See the [installation guide](docs/user-guide.md#install) for source installations,
PowerShell commands and Registry routing. For updates, use
[Support and updates](docs/support.md#updates).

## Quick start

You need two things: the manifest source supplied by your team and a directory
for the workspace. Preview the plan, then apply it:

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
```

The [quick start](docs/user-guide.md#quick-start) explains what init prepares,
how to continue after a sign-in or approval, and how to
[limit the first download](docs/user-guide.md#choose-repositories-before-downloading).

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
| List capabilities              | `fx can`                                              |
| Check a capability             | `fx can <capability> --env <environment>`             |
| Refresh guides and Skills      | `fx sync --only docs,skills`                          |
| Check what is ready to release | `fx release check`                                    |

Use `repo list`, `env list`, `agent list` and `tool list` to discover valid names.
Use `repo select` and `env select` to choose an exact set, `--all` to follow the
team's full set including future additions, or `--none` to select nothing.
`pick/unpick` add or remove individual names. First-time setup can limit cloning
with `fx init ./work --from <manifest-repository> --repos example-api,example-web --dry-run`.
`where` prints coordinates and commands; it does not execute those commands.
`release check` shows what each repository would release and whether it is ready; it
never publishes or deploys.
The [CLI reference](docs/cli/README.md) and `fx <command> --help` own exact syntax.

## For coding agents

Run `fx self info --format json`, then read `SKILL.md` in its `bundled_skill`
directory, or run `fx skill show`. Global Skill installation is optional. Start
sessions at the registered workspace root to use team guidance.

The [user guide](docs/user-guide.md#for-coding-agents) explains structured
results, completion verdicts and recovery; the bundled
[Skill](skills/fx-workspace/SKILL.md) routes each task to its reference.

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
