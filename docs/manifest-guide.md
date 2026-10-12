# Create a manifest source

An installation of fx supplies the CLI, default tool definitions and the
bundled agent Skill. Each team supplies its own workspace declaration. Start with
an existing team's source, import current checkouts, or create the minimal source
below. A private package registry is not part of the manifest format.

## Source layout

Keep the source outside the directory that will contain business checkouts:

```text
team-workspace/
  manifest/
    workspace.yaml       # required: repositories and workspace providers
    environments.yaml    # optional: environments and platform coordinates
    tools.yaml           # optional: overrides to bundled companion tools
    members.yaml         # optional: people; requires sensitive: true
    harness.yaml         # optional: MCP resources and rules
  AGENTS.md              # optional: team guidance and managed regions
  docs/                  # optional: team documentation
  skills/                # optional: team agent Skills
```

Only `manifest/workspace.yaml` is required. Omitted environment, member and
harness documents leave those capabilities unconfigured. Keep credentials in the
owning tools, not in these documents.

fx assumes no tool. The CLIs it bundles are a catalog of what it knows how to
drive, and a workspace's toolchain is read off the providers it binds: binding
`ci` to `jenkins-cli` is what puts the Jenkins companion in the toolchain, with
its version floor, install method and commands maintained by fx. Most teams
therefore need no `tools.yaml` at all.

Declare a tool there when no binding brings it — a tool the team runs on its own,
or one fx does not know:

```yaml
schema_version: 3
tools:
  - name: example-team-tool
    install: [{ via: npm, spec: '@example/team-tool' }]
```

Naming a bundled tool is also the whole declaration, and it keeps fx's commands
trusted, so nobody confirms them by hand. Override a field only where the team
differs from the bundled facts: a field the patch sets belongs to the team, and
fx asks a person before running what it carries.

`fx tool list` names the tools this workspace has and why each one is there —
`binding` for a tool a bound provider drives, `manifest` for one this document
names. `fx tool list --catalog` adds the tools fx knows that nothing here
selects, which is how to find what binding a capability would bring.

A capability may also name a provider fx does not implement, as long as this
document declares a tool of that name. fx then offers no entry coordinate for it
and answers readiness from that tool alone.

Bundled tools declare minimum versions. Inspect the effective requirement with
`fx tool show <tool>` and preview an upgrade with `fx tool update <tool> --dry-run`.
Teams can override `min_version` in `manifest/tools.yaml` to maintain a different
compatibility baseline. Version floors do not pin npm installations to that exact release.

## Install a team tool during initialization

A team can opt a tool into installation during `fx init`:

```yaml
schema_version: 3
min_cli: '0.4.0'
tools:
  - name: example-team-tool
    install_on_init: true
    install: [{ via: npm, spec: '@example/team-tool' }]
```

A team that installs everything on a new machine sets the flag once under
`defaults`, and an entry opts out of it:

```yaml
schema_version: 3
defaults:
  install_on_init: true
tools:
  - name: example-optional-tool
    install_on_init: false
```

The package and executable above are fictional. npm uses the user's Registry and
authentication configuration; keep credentials out of the manifest. `fx init`
installs only missing, enabled tools explicitly marked `install_on_init`, before
repository and Skill synchronization. It asks for trust in the exact installation
and version-check commands. Existing installations are preserved, even when below
the minimum version; use `fx tool update` for an upgrade. `fx sync` never installs
packages, and initialization does not sign in to companion services.

Successful initialization reports installations in `tool_install`. A dry run does
not materialize the manifest or run installers; `tool_install` and `sync` are null
until execution. Read-only mode blocks installation. If installation or version
verification fails, init reports `INIT_TOOL_INSTALL_FAILED`; registration may
already exist, so resolve npm access or PATH and retry the same directory/source.

## Local preparation and personal sign-in

Tools documents use schema 3. Every run step declares its purpose explicitly:

```yaml
schema_version: 3
tools:
  - name: example-team-tool
    required: true
    install: [{ via: npm, spec: '@example/team-tool' }]
    install_on_init: true
    setup:
      - id: local
        kind: run
        phase: prepare
        title: Prepare local files
        run: [prepare]
        verify: { file: ~/.example-tool/ready }
```

`prepare` runs non-interactively during initialization after exact-command approval.
`authenticate` is verified during init but left for personal sign-in when missing.
Manual/file steps are checked and handed off. Existing successful checks skip the
action; `init --resume` continues unfinished work. Declaring a custom executable
does not imply that it has an authentication command; declare `auth` when needed.

Invalid entries stop preparation rather than silently removing requirements.
An ordinary source AGENTS.md is sufficient: fx appends missing discovery regions
to the generated target guide while preserving source prose and existing region
positions. Ambiguous marker pairs must be corrected by the source maintainer.

## Start with a small declaration

For a team using the Bitbucket companion, create
`team-workspace/manifest/workspace.yaml`:

```yaml
schema_version: 2
providers:
  code-host:
    provider: bitbucket-cli
    vars:
      host: ssh://git@git.example.com
      web: https://git.example.com
defaults:
  upstream_project: example
  branch: main
projects:
  example:
    label: Example team
    contact: Ask your repository administrator
repos:
  - name: example-api
    desc: Example API service
```

Replace the fictional host, project, repository and branch with verified values.
Git cloning requires Git access to the configured host; API operations require the Bitbucket companion;
it is not a live demo service. Use `fx tool show bitbucket-cli` to inspect setup.
The other implemented code-host providers are `github`, which drives the GitHub CLI
`gh` and whose `host` is a clone prefix such as `https://github.com` (a GitHub
Enterprise server is named the same way), and `local-git`, which works with a
directory of bare repositories; `local-git` is not an adapter for an arbitrary
hosted Git service.

`fx manifest providers` lists every capability and what is bound to it. A
capability may have more than one implementation — `issue-tracker` accepts
`feishu-project` or `jira-cli`, `knowledge-base` accepts `confluence` or
`lark-wiki` — and one companion CLI may serve several capabilities, as lark-cli
does for `im` and `knowledge-base`. It is still installed and checked once.

From the directory containing `team-workspace/`, preview and initialize:

```sh
fx init ./work --from ./team-workspace --dry-run
fx init ./work --from ./team-workspace
cd work
fx manifest validate --strict
fx manifest lint
fx manifest providers
fx init --resume --workspace work
```

Inspect init's synchronization results and resolve any setup handoffs. A valid
manifest does not prove repository access, tool readiness or agent activation.

For field details, quote paths containing brackets so shells such as zsh do not
expand them as filename patterns:

```sh
fx manifest explain 'repos[].upstream'
fx manifest explain --kind tools 'tools[].setup'
fx manifest schema --kind environments
```

## Import existing checkouts

Use a source directory outside the existing workspace:

```sh
fx manifest import ./existing-work --format json
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml --dry-run
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml
```

Review inferred branches, upstreams, projects and unresolved entries in the
report and candidate. Add team rules and Skills separately; import does not
recover them from repository metadata. Provider inference requires evidence:
verified local bare repositories can produce a `local-git` binding. Unrecognized
or mixed hosting remains explicit upstream URLs with review notes, without a
guessed provider. A project the code host could not answer for is reported as
unanswered rather than absent, so the entry's review note or skip reason shows
that the search was incomplete. HTTP remotes carrying credentials or
query/fragment data are skipped without echoing that data. Then preview adoption:

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

Adoption is automatic; `--adopt` is a legacy flag. If only `origin` exists and its
URL exactly matches the declared upstream, sync adds `upstream` while preserving
`origin`, branch and local files; conflicts remain unchanged. Existing guides or Skill
locations may require a reviewed replacement with backup. Import does not alter
checkouts or remove submodule bookkeeping. See the [import commands](cli/README.md#fx-manifest-import).

## Share and maintain the source

A directory source is a snapshot. A local Git source uses committed content;
uncommitted manifest edits are not included. For ongoing team updates, commit
the reviewed source to a repository with appropriate access controls and supply
its Git URL to `fx init`.

A registered workspace keeps its source under
`~/.fx/workspaces/<name>/source`. `fx sync` refreshes eligible Git sources before
synchronizing; directory and stdin snapshots do not track subsequent source edits.
Use `fx self info --format json` to identify the active workspace and source.
Changing the source of an already registered root is not an implicit migration.
Use `fx workspace rebind <name> --from <source> --dry-run` to preview an explicit
source change while preserving the workspace identity and personal selection.

`manifest repo-set` rechecks the captured document under a file lease before
replacing it. If another writer changed it, the path is not a regular file, or
its directory is a symbolic link, `MANIFEST_EDIT_CONFLICT` preserves the existing
content. Inspect the real source path and retry with `--dry-run`; do not remove
locks or overwrite another edit. An identical edit reports `written: false`.

`manifest validate/lint/providers/repo-set/render` honour `--workspace` and
`FX_WORKSPACE` before looking for a source checkout around the current directory.
An unknown explicit workspace is an error. Without an explicit selection, the
nearby source checkout still takes priority, so standalone source maintenance
continues to work. `manifest import <dir>` reads the directory argument;
`manifest record-probe` uses the selected registered workspace. Render accepts
both `-o <file>` and `--out <file>` for an alternate output.

Maintain shared declarations in the registered source checkout and personal
selections through `repo pick/unpick`, `env pick/unpick` and `agent pick/unpick`.
Agent selection applies across workspaces in the same FX_HOME. For contributing
source changes through a verified personal fork, see
[source contribution commands](cli/README.md#fx-source-push).

## Environment example

Put these fictional examples in `manifest/workspace.yaml` and
`manifest/environments.yaml`, respectively. `obs.svc: api` resolves the stream to
`example_api_test`. The coordinate remains `unverified` until checked; declaring
it does not configure the CLI or grant access.

```yaml
schema_version: 2
defaults: { branch: main }
repos:
  - name: example-api
    upstream: https://git.example.com/team/example-api.git
    obs: { svc: api }
```

```yaml
schema_version: 2
platforms:
  logs:
    provider: openobserve-cli
    capability: log-store
    label: Application logs
    command: openobserve-cli search run --use-context {context} --sql "SELECT * FROM {stream} LIMIT 20" --since 1h
envs:
  test:
    label: Test
    platforms:
      logs:
        vars: { context: test, stream: 'example_{svc}_test' }
        confidence: unverified
```

```sh
fx manifest validate --strict --format json
fx where example-api --env test --format json
fx doctor --tool openobserve-cli --format json
```

A metrics platform follows the same shape. Its coordinate variable is `job`, the
scrape job of the service. Declare a pattern only where job names really follow
one; otherwise record each verified job on its repository under
`obs.overrides.<platform>.<env>.vars`, and a repository without one gets no
command instead of a guessed selector.

```yaml
platforms:
  metrics:
    provider: prometheus-cli
    capability: metrics
envs:
  test:
    platforms:
      metrics:
        service:
          base_url: https://metrics.example.com
          context: test
          auth_scheme: none
        vars: { job: 'example-{svc}' }
        confidence: unverified
```

A ci platform names the job that builds each environment. `jenkins-cli` takes a
job `path` per environment. `github-actions` drives `gh` as well: the platform
names the repository as `OWNER/NAME`, or `HOST/OWNER/NAME` on a GitHub Enterprise
server, and each environment names the workflow and the branch and trigger whose
runs build it, so a pull request or a manual run does not stand in for the build
of record.

```yaml
platforms:
  actions:
    provider: github-actions
    capability: ci
    vars: { repository: 'example/{repo}' }
envs:
  prod:
    platforms:
      actions:
        vars: { workflow: ci.yml, branch: main, event: push }
```

## Declaring team Skills in AGENTS.md

Keep each team Skill at `skills/<name>/SKILL.md`, with frontmatter `name` and
`description`. Add this generated region where the discovery catalog belongs:

```markdown
<!-- fx:begin team-skills -->
<!-- fx:end team-skills -->
```

`fx manifest render` fills it with names, trigger descriptions and source links.
New guide skeletons include the region. Existing guides without it receive a
missing-region notice; fx does not insert blocks into human prose automatically.
The manifest source uses relative links. Workspace-derived guides use resolved
source links so manual discovery does not depend on a host-specific Skill link;
the same goes for any relative link in the source guide that names a file of the
source, such as `CONTRIBUTING.md`.
Metadata changes, additions and removals are picked up by `fx sync --only docs,skills`.
The catalog is a discovery aid, not proof of native installation or loaded context.
It applies at the workspace root and does not modify business-repository guides.

Document rendering compares the file with its planning snapshot before writing.
`DOCS_WRITE_CONFLICT` means a concurrent edit or unsafe path was preserved. Inspect
the path, use its real directory when a parent is linked, then preview and retry.
Document rows separate planned `action` from execution `result`: `planned`, `done`,
`skipped`, `failed` or `not_started`. A nonzero exit can follow a completed file;
read partial stdout (`files` for render, `stage_details.docs.files` for sync, or
`sync.stage_details.docs.files` for init) before
resuming. Retrying skips unchanged files. Approved foreign replacement moves the
original file, directory or link itself to an unused `.fx-backup[-N]` sibling;
existing backups remain intact.

## Placing workspace layout rules in AGENTS.md

The `workspace-layout` region tells agents where output that belongs to no
repository goes: `.workbench/` at the workspace root. A workspace-derived guide
always carries it, appended at the end when the source has no markers. Add the
markers beside your other workspace rules to place it there instead:

```markdown
<!-- fx:begin workspace-layout -->
<!-- fx:end workspace-layout -->
```

## Keep a Go workspace at the root

When several repositories are Go modules that build against each other, ask fx to
keep a `go.work` at the workspace root:

```yaml
schema_version: 2
min_cli: '0.11.0'
go:
  workspace: true
```

`fx init` and `fx sync` then list in `go.work` every selected repository whose
checkout has a `go.mod` at its top, at the newest `go` version those modules
require. Each module builds against its siblings' checkouts instead of the
versions its `go.mod` pins; build with `GOWORK=off` to use the pinned ones. A
repository that is not selected or not cloned yet is left out, so the file never
names a missing module. `fx sync --only go` refreshes the file alone.

fx marks the file on its first line and replaces or removes only a `go.work` it
wrote. A person's own `go.work` is reported and left alone; move it aside to let
fx keep the file. Without the setting, the next sync removes the `go.work` fx
wrote. `go.work` and `go.work.sum` belong to the workspace, so `fx doctor` does
not report them as stray.

## Public service presets

fx 0.2.0 supports optional `service` to workspace provider bindings, platform defaults
and per-environment platform overrides. Declare `min_cli: '0.2.0'` in documents
using it. Environment overrides inherit the platform's service fields.

```yaml
providers:
  code-host:
    provider: bitbucket-cli
    vars: { host: 'ssh://git@git.example.com' }
    service:
      base_url: https://git.example.com/deploy
      context: team
      flavor: datacenter
      auth_scheme: pat
```

`base_url` is the full HTTP(S) URL, including any deployment prefix. Keep SSH
clone coordinates separate. `context` selects a native CLI context. Bitbucket and
Confluence also accept `flavor`; OpenObserve requires `org`; family companions
require `auth_scheme` and optionally accept a public `credential_url` page.
`auth_scheme` is how fx creates a missing context and which sign-in `fx login`
offers; it is not a condition of readiness. A member whose context for the same
`base_url` signs in another way is ready as they are.
Prometheus accepts `auth_scheme: none` for a server that takes no sign-in: its
readiness is whether the server answers, and no login is requested. Use `basic`
or `bearer` only where a gateway in front of it requires one.
Sentry accepts only `base_url` and `org`. A platform that names no `provider` is
checked against the provider its own name implies, the same one `fx manifest
providers` reports for it. Identical declarations can share a local
destination; incompatible settings for the same destination block preparation.
Conflicting legacy variables must be removed rather than defining a second source.

Only these public fields may be distributed. Usernames, email addresses, passwords,
PAT values, API tokens, cookies and browser sessions are personal and forbidden in
`service`. Each member obtains and stores credentials through their own companion
CLI. Unknown service fields fail validation even outside strict mode; credentials
in service URLs are rejected without echoing the value.

Minimum companion versions for native presets: Bitbucket/Confluence 0.20.0,
Jenkins 0.9.0, OpenObserve 0.13.0, Prometheus 0.2.0. Declare matching
`tools.yaml` version floors.
`fx init`, explicit `fx sync` and `fx login` prepare service settings through
trusted commands; `fx sync --only services --dry-run` previews. Existing non-empty
conflicts are reported, never automatically overwritten or activated. Sentry uses
public workspace `.sentryclirc` defaults with equivalent preservation behavior.
