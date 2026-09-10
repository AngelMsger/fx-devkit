# @angelmsger/fx command reference

Generated from the command registry of version 0.1.0. Do not edit by hand;
run `npm run docs:gen` after changing commands or flags.

## Everyday

| Command | What it answers |
|---|---|
| `fx init` | Create a workspace from a manifest source: the source lands under ~/.fx, the directory is registered and synced |
| `fx sync` | Bring the workspace up to date: clone what is missing, fast-forward what is clean, never touch work in progress |
| `fx login` | Get this machine's access to the platforms the manifest binds: log in, place kubeconfigs, confirm permissions |
| `fx doctor` | Check repositories, tools, login state, agent Skills, the manifest and whether fx or the manifest is behind, in one pass |
| `fx status` | Show every tracked repository: branch, cleanliness, position against upstream |
| `fx can` | Whether a capability or tool can be used right now; when not, what a person must do first |
| `fx where` | Locate repository coordinates; optionally probe or record their existence |
| `fx release` | Whether the repositories about to ship are ready: dependencies, branches, builds and unresolved errors, one finding each |
| `fx completion` | Print a shell completion script for bash, zsh, fish or PowerShell |

## Topics

| Topic | Commands |
|---|---|
| `fx agent` | Coding agents: list, pick the ones fx projects Skills into |
| `fx config` | Personal settings in ~/.fx/config.yaml, and carrying them to another machine |
| `fx env` | Environments: list, show, pick |
| `fx hook` | Workspace lifecycle hooks: inspect, enable and remove managed entries |
| `fx manifest` | The manifest: validate, lint, explain, edit, render its AGENTS.md, import a directory |
| `fx mcp` | Workspace MCP resources, projections and readiness |
| `fx member` | People: list them, show who a name refers to |
| `fx repo` | Repositories: list, show, pick, register, fork, open |
| `fx self` | The fx tool itself: info, update |
| `fx skill` | Skills: the team Skills and fx's own, with their state in each agent |
| `fx source` | Source contributions: validate selected files and propose a pull request |
| `fx tool` | Companion tools: list, show, install, update |

## Global flags

Every command accepts these.

| Flag | Description |
|---|---|
| `--allow-writes` | override read-only posture (read_only / FX_READ_ONLY) for this invocation (default: false) |
| `--command-shell` | shell for generated commands (does not change execution) (one of: auto, posix, powershell, cmd; env: FX_COMMAND_SHELL) |
| `--fields` | comma-separated dot paths to keep in the output, e.g. name,obs.svc |
| `--format` | output format (one of: human, json, ndjson; env: FX_FORMAT) |
| `--no-header` | omit column headings from human list output (default: false) |
| `--no-input` | never prompt; fail with a structured error instead (default: false) |
| `--quiet` | suppress notices on stderr; errors are still reported (default: false) |
| `--verbose` | diagnostic detail on stderr (default: false) |
| `--workspace` | workspace name from ~/.fx/config.yaml; defaults to the registered one containing cwd, then default_workspace (env: FX_WORKSPACE) |
| `--yes` | assume yes for confirmations (default: false) |

## `fx init`

Create a workspace from a manifest source: the source lands under ~/.fx, the directory is registered and synced

Registration can succeed with partial synchronization. Inspect sync.summary, sync.stages and failed item details; exit zero does not establish complete preparation.

Arguments:

| Argument | Required | Description |
|---|---|---|
| `dir` | yes | directory to create, reuse or adopt |

Flags:

| Flag | Description |
|---|---|
| `--adopt` | legacy flag; adoption is automatic (default: false) |
| `--dry-run` | print the plan instead of applying it (default: false) |
| `--from` | git URL or checkout of the manifest repository, a directory holding manifest/, or - for workspace YAML / a source bundle (required) |
| `--jobs` | independent repository checks handled at the same time (default: 4) |
| `--name` | name in ~/.fx/config.yaml; default: the directory name |

Examples:

```bash
fx init ~/Workspaces/fx --from ssh://git@git.example.com:12345/team/workspace-manifest.git
fx init ./ws --from ./manifest --dry-run
cat workspace.yaml | fx init ./ws --from -
```

## `fx sync`

Bring the workspace up to date: clone what is missing, fast-forward what is clean, never touch work in progress

The result may be partial even with exit zero. Inspect summary.failed, summary.unreadable, stages and each failed item's structured failure before retrying.

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |
| `--jobs` | independent repository checks handled at the same time (default: 4) |
| `--only` | run selected stages (repos, docs, skills, hooks, mcp, tools) |
| `--refresh-manifest / --no-refresh-manifest` | pull the manifest repository first; --no-refresh-manifest skips it (default: true) |

Examples:

```bash
fx sync
fx sync --dry-run --format json
```

## `fx login`

Get this machine's access to the platforms the manifest binds: log in, place kubeconfigs, confirm permissions

Arguments:

| Argument | Required | Description |
|---|---|---|
| `tool` | no | only these tools (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | check current state and preview each unfinished action (default: false; exclusive with: --list) |
| `--env` | only these environments (repeatable) |
| `--list` | print the static plan without checking current state (default: false; exclusive with: --dry-run, --skip-manual) |
| `--skip-manual` | only steps fx can run itself (default: false; exclusive with: --list) |

Examples:

```bash
fx login --list
fx login
fx login kubectl --env test
fx login <tool> --dry-run --no-input --format json
fx login --no-input --format json   # inspect pending setup; resume after verification
```

## `fx doctor`

Check repositories, tools, login state, agent Skills, the manifest and whether fx or the manifest is behind, in one pass

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the fix plan instead of applying it (requires: --fix) |
| `--env` | only these environments (login checks) (repeatable) |
| `--fix` | apply the fixes fx can make itself |
| `--tool` | only these tools (tool and login checks) (repeatable) |

Examples:

```bash
fx doctor
fx doctor --env test --format json
fx doctor --fix   # run-type login steps and Skill links; nothing a person must do
```

## `fx status`

Show every tracked repository: branch, cleanliness, position against upstream

Flags:

| Flag | Description |
|---|---|
| `--dirty` | list only repositories with uncommitted changes (default: false) |
| `--dry-run` | print the fetch plan instead of applying it (requires: --fetch) |
| `--fetch` | fetch upstream first (default: report local state only) |
| `--jobs` | independent repository checks handled at the same time (default: 4) |

Examples:

```bash
fx status
fx status --fetch --dirty
```

## `fx can`

Whether a capability or tool can be used right now; when not, what a person must do first

Arguments:

| Argument | Required | Description |
|---|---|---|
| `target` | yes | a capability (e.g. log-store) or a tool name |

Flags:

| Flag | Description |
|---|---|
| `--agent` | the host for an mcp:<name> resource |
| `--env` | the environment; required for environment-scoped capabilities |

Examples:

```bash
fx can log-store --env test --format json
fx can cluster --env test
fx can bitbucket-cli
```

## `fx where`

Locate repository coordinates; optionally probe or record their existence

Queries return a collection. --record writes verified evidence into source environments.yaml and returns a record with action (preview, recorded, unchanged or skipped) and written. --record --dry-run returns the write plan without probing or writing.

Arguments:

| Argument | Required | Description |
|---|---|---|
| `repo` | yes | repository name |

Flags:

| Flag | Description |
|---|---|
| `--check / --no-check` | fill the ready column by running each provider's read-only verify (default: true) |
| `--dry-run` | print the plan instead of applying it (default: false) |
| `--env` | one environment; default: every environment in scope |
| `--jobs` | independent repository checks handled at the same time (default: 4) |
| `--platform` | one platform; default: all |
| `--probe` | ask each platform, read-only, whether the coordinate exists; needs --env (default: false) |
| `--record` | record definite probe evidence in source environments.yaml; needs --probe, --env and --platform (default: false) |

Examples:

```bash
fx where fx-example-api --env test --format json
fx where fx-example-api --env test --platform jenkins --probe --record --dry-run
```

## `fx release`

Whether the repositories about to ship are ready: dependencies, branches, builds and unresolved errors, one finding each

Arguments:

| Argument | Required | Description |
|---|---|---|
| `repo` | no | repository name(s); default: every one on the checklist (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--env` | environment whose errors count; default: release.env |
| `--jobs` | independent repository checks handled at the same time (default: 4) |
| `--only` | only these checks (repeatable; one of: deps, merge, ci, errors) |
| `--since` | how far back a new error counts; default: release.since |
| `--tag` | only repositories carrying this tag (repeatable) |

Examples:

```bash
fx release --format json
fx release fx-example-api --only merge --format json   # the commits behind the finding
```

## `fx completion`

Print a shell completion script for bash, zsh, fish or PowerShell

Arguments:

| Argument | Required | Description |
|---|---|---|
| `shell` | yes | bash, zsh, fish, powershell |

Examples:

```bash
fx completion zsh > ~/.zfunc/_fx
fx completion bash > /usr/local/etc/bash_completion.d/fx
fx completion fish > ~/.config/fish/completions/fx.fish
fx completion powershell | Out-File -Encoding utf8 fx-completion.ps1
```

## `fx agent list`

List the coding agents fx knows: detected on this machine, enabled, and where their Skills live

Examples:

```bash
fx agent list
```

## `fx agent pick`

Add coding agents to the shared selection across workspaces registered in this FX_HOME

Arguments:

| Argument | Required | Description |
|---|---|---|
| `id` | yes | agent id(s), e.g. claude-code (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx agent pick claude-code codex
```

## `fx agent unpick`

Deselect coding agents and reconcile owned resources across workspaces in this FX_HOME

Arguments:

| Argument | Required | Description |
|---|---|---|
| `id` | yes | agent id(s), e.g. claude-code (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx agent unpick claude-code codex
```

## `fx config list`

List every config key with its effective value and source

Examples:

```bash
fx config list
fx config list --format json
```

## `fx config get`

Show the effective value of a config key and where it comes from

Arguments:

| Argument | Required | Description |
|---|---|---|
| `key` | yes | config key |

Flags:

| Flag | Description |
|---|---|
| `--explain` | show every layer, not only the winner (default: false) |

Examples:

```bash
fx config get format --explain
```

## `fx config set`

Set a config key in ~/.fx/config.yaml

Arguments:

| Argument | Required | Description |
|---|---|---|
| `key` | yes | config key |
| `value` | yes | new value; lists are comma-separated |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx config set format json
fx config set read_only true --dry-run
```

## `fx config unset`

Remove a config key from ~/.fx/config.yaml

Arguments:

| Argument | Required | Description |
|---|---|---|
| `key` | yes | config key |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx config unset format
```

## `fx config export`

Write the personal state worth carrying to another machine: config.yaml and each workspace's local.yaml; never trust records, cache or credentials

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the file plan instead of writing it (requires: --out) |
| `-o, --out` | file to write; default stdout (yaml) |

Examples:

```bash
fx config export -o me.yaml
fx config export --format json
```

## `fx config import`

Apply a profile written by `config export`: config keys it names win, each workspace's local.yaml is replaced

Arguments:

| Argument | Required | Description |
|---|---|---|
| `file` | yes | the profile file |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx config import me.yaml --dry-run
fx config import me.yaml
```

## `fx env list`

List the environments, their platforms, and which ones this machine picked

Examples:

```bash
fx env list --format json
```

## `fx env show`

One environment's platform matrix: provider, variables, confidence, notes

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | environment name |

Examples:

```bash
fx env show test
```

## `fx env pick`

Select the environments this machine uses; login, doctor and can expand only these

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | environment name(s) (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx env pick dev test
```

## `fx env unpick`

Drop environments from this machine's scope

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | environment name(s) (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx env unpick selfhosted
```

## `fx hook list`

Show workspace lifecycle capabilities, projections and recent automatic sync evidence

Examples:

```bash
fx hook list --format json
```

## `fx hook inject`

Enable and project lifecycle hooks for the selected agents in this workspace

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx hook inject --format json
```

## `fx hook remove`

Disable workspace lifecycle hooks and remove only fx-managed entries

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx hook remove --format json
```

## `fx manifest validate`

Check every manifest document and report each problem with its path

Flags:

| Flag | Description |
|---|---|
| `--kind` | check one document only (one of: workspace, environments, tools, members, harness) |
| `--strict` | treat unknown fields as errors (default: false) |

Examples:

```bash
fx manifest validate --strict --format json
```

## `fx manifest lint`

Suggest improvements to a valid manifest; never fails

Examples:

```bash
fx manifest lint
```

## `fx manifest explain`

Describe a manifest field: type, whether it is required, what it means

Arguments:

| Argument | Required | Description |
|---|---|---|
| `path` | no | field path, e.g. repos[].branch; omit for the document root |

Flags:

| Flag | Description |
|---|---|
| `--kind` | which document (default: "workspace"; one of: workspace, environments, tools, members, harness, local) |

Examples:

```bash
fx manifest explain repos[].obs.overrides
fx manifest explain --kind tools tools[].setup
```

## `fx manifest schema`

Print the JSON Schema of a manifest document; always JSON, whatever --format says

Flags:

| Flag | Description |
|---|---|
| `--kind` | which document (default: "workspace"; one of: workspace, environments, tools, members, harness, local) |

Examples:

```bash
fx manifest schema --kind tools > tools.schema.json
```

## `fx manifest providers`

Show which provider fulfils each capability, and where the binding comes from

Examples:

```bash
fx manifest providers
```

## `fx manifest set`

Set a scalar field or aka array of a repository in workspace.yaml, touching nothing else

Arguments:

| Argument | Required | Description |
|---|---|---|
| `repo` | yes | repository name |
| `field` | yes | path, desc, branch, project, upstream or aka |
| `value` | yes | new scalar value, or a JSON/YAML string array for aka |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx manifest set fx-example-api branch feature/x --dry-run
fx manifest set fx-example-api desc "Backend monolith"
fx manifest set fx-example-api aka '["backend", "app-builder"]' --dry-run
```

## `fx manifest render`

Regenerate the manifest-derived regions of the manifest repository's AGENTS.md: the checkout under cwd, else the workspace's source copy

Flags:

| Flag | Description |
|---|---|
| `--check` | write nothing; fail when the document is stale (default: false) |
| `--dry-run` | print the plan instead of applying it (default: false) |
| `--out` | create or replace a fully rendered AGENTS.md at this path instead; nothing else is touched |

Examples:

```bash
fx manifest render
fx manifest render --check   # CI: exit 11 when stale
fx manifest render --out /tmp/AGENTS.draft.md
```

## `fx manifest import`

Describe an existing directory of repositories as a manifest, printed or written with -o; the checkouts are never touched

Arguments:

| Argument | Required | Description |
|---|---|---|
| `dir` | yes | the directory to describe |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |
| `-o, --out` | write the manifest to this file instead of printing it |

Examples:

```bash
fx manifest import ~/Workspaces/fx
fx manifest import ~/Workspaces/fx --format json
fx manifest import ~/Workspaces/fx -o fx-workspace/manifest/workspace.yaml
```

## `fx mcp list`

List workspace MCP resources, projections and readiness

Examples:

```bash
fx mcp list --format json
```

## `fx mcp show`

Show one MCP declaration, environment references and readiness

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | declared MCP resource name |

Examples:

```bash
fx mcp show knowledge --format json
```

## `fx member list`

List people, optionally those of one area or one status

Flags:

| Flag | Description |
|---|---|
| `--area` | only people of this area |
| `--status` | only this status: active, initialized, resigned, deactivated |

Examples:

```bash
fx member list --area Platform
```

## `fx member show`

Who a name refers to: by email, id, an account in any system, display name or git author name

Arguments:

| Argument | Required | Description |
|---|---|---|
| `query` | yes | email, id, account handle, name or git name |

Examples:

```bash
fx member show alice
fx member show ou_alice --format json
```

## `fx repo list`

List the repositories of the workspace, picked or not

Flags:

| Flag | Description |
|---|---|
| `--picked` | only the repositories picked here (default: false; exclusive with: --unpicked) |
| `--project` | only repositories of this code-host project |
| `--tag` | only repositories carrying this tag |
| `--unpicked` | only repositories left unpicked (default: false; exclusive with: --picked) |
| `--unreadable` | which the code host denies you (default: false) |

Examples:

```bash
fx repo list --tag backend
fx repo list --unreadable
```

## `fx repo show`

Show one repository: resolved entry, disk state, code-host URLs and owners

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | repository name |

## `fx repo pick`

Select shared repositories to track on this machine

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | repository name(s) (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx repo pick fx-example-api fx-example-auth
```

## `fx repo unpick`

Stop tracking shared repositories on this machine; nothing on disk changes

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | repository name(s) (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx repo unpick fx-example-docs
```

## `fx repo add`

Register a checkout that exists only on this machine

Arguments:

| Argument | Required | Description |
|---|---|---|
| `path` | yes | directory of the checkout |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |
| `--upstream` | upstream URL; defaults to the checkout's upstream or origin remote |

Examples:

```bash
fx repo add ../scratch-x --upstream ssh://git@git.example.com:12345/lab/scratch-x.git
```

## `fx repo remove`

Unregister a machine-local repository; the directory is kept

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | repository name |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

## `fx repo fork`

Create your personal fork on the code host and point origin at it

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | repository name |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

## `fx repo open`

Print the code-host page of a repository, and open it when on a terminal

Arguments:

| Argument | Required | Description |
|---|---|---|
| `name` | yes | repository name |

## `fx self info`

Where this fx is: version, runtime, personal directory, bundled assets, registry, workspace

Examples:

```bash
fx self info --format json
```

## `fx self update`

Update fx from the private registry configured by FX_REGISTRY

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx self update --dry-run
fx self update --yes
```

## `fx skill list`

List team Skills and the fx Skill, with their state in each enabled agent

Flags:

| Flag | Description |
|---|---|
| `--agent` | only these agent ids (repeatable) |

## `fx source push`

Validate selected source files and contribute them through a personal-fork pull request

Creates a commit, pushes the contribution branch to the personal fork, and creates or resumes a pull request. --dry-run validates and returns a plan without committing, pushing or creating a PR.

Arguments:

| Argument | Required | Description |
|---|---|---|
| `paths` | no | source-relative file or directory paths; prompted if omitted (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |
| `--issue` | issue ID for the commit; prompted if omitted |
| `--message` | single-line commit summary |
| `--new` | start a separate contribution instead of reusing a pending PR (default: false) |
| `--pr` | known PR ID or URL to associate after an uncertain creation |
| `--title` | new PR title; prompted if omitted |

Examples:

```bash
fx source push manifest/environments.yaml --issue TASK-123 --title "Update verified coordinates" --dry-run
```

## `fx tool list`

List the companion tools the workspace expects, and where each entry comes from

Examples:

```bash
fx tool list
```

## `fx tool show`

Show one tool: its resolved entry, where each field comes from, who depends on it

Arguments:

| Argument | Required | Description |
|---|---|---|
| `tool` | yes | tool name |

Examples:

```bash
fx tool show bitbucket-cli
```

## `fx tool install`

Install companion tools with the package manager the manifest names

Arguments:

| Argument | Required | Description |
|---|---|---|
| `tool` | no | tool name(s) (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--all` | every enabled tool that is missing (default: false) |
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx tool install openobserve-cli
fx tool install --all --dry-run
```

## `fx tool update`

Update companion tools to their latest published version

Arguments:

| Argument | Required | Description |
|---|---|---|
| `tool` | no | tool name(s); default: every enabled tool (variadic) |

Flags:

| Flag | Description |
|---|---|
| `--dry-run` | print the plan instead of applying it (default: false) |

Examples:

```bash
fx tool update bitbucket-cli
```
