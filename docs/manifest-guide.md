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
  CLAUDE.md              # optional: host-specific entry guidance
  docs/                  # optional: team documentation
  skills/                # optional: team agent Skills
```

Only `manifest/workspace.yaml` is required. Omitted environment, member and
harness documents leave those capabilities unconfigured. Omitting `tools.yaml`
uses the bundled tool catalog; it does not remove companion requirements.
Keep credentials in the owning tools, not in these documents.

Bundled tools declare minimum versions. Inspect the effective requirement with
`fx tool show <tool>` and preview an upgrade with `fx tool update <tool> --dry-run`.
Teams can override `min_version` in `manifest/tools.yaml` to maintain a different
compatibility baseline. Version floors do not pin npm installations to that exact release.

## Install a team tool during initialization

With fx 0.1.1 or newer, a team can opt a tool into installation during `fx init`:

```yaml
schema_version: 2
min_cli: '0.1.1'
tools:
  - name: example-team-tool
    install_on_init: true
    install: [{ via: npm, spec: '@example/team-tool' }]
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
The other implemented code-host provider, `local-git`, works with a directory of
bare repositories; it is not an adapter for an arbitrary hosted Git service.

From the directory containing `team-workspace/`, preview and initialize:

```sh
fx init ./work --from ./team-workspace --dry-run
fx init ./work --from ./team-workspace
cd work
fx manifest validate --strict
fx manifest lint
fx manifest providers
fx login --list
fx doctor
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
recover them from repository metadata. Then preview adoption:

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

Adoption is automatic; `--adopt` is a legacy flag. Existing guides or Skill
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
source links so manual discovery does not depend on a host-specific Skill link.
Metadata changes, additions and removals are picked up by `fx sync --only docs,skills`.
The catalog is a discovery aid, not proof of native installation or loaded context.
It applies at the workspace root and does not modify business-repository guides.

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
Sentry accepts only `base_url` and `org`. Identical declarations can share a local
destination; incompatible settings for the same destination block preparation.
Conflicting legacy variables must be removed rather than defining a second source.

Only these public fields may be distributed. Usernames, email addresses, passwords,
PAT values, API tokens, cookies and browser sessions are personal and forbidden in
`service`. Each member obtains and stores credentials through their own companion
CLI. Unknown service fields fail validation even outside strict mode; credentials
in service URLs are rejected without echoing the value.

Minimum companion versions for native presets: Bitbucket/Confluence 0.20.0,
Jenkins 0.9.0, OpenObserve 0.13.0. Declare matching `tools.yaml` version floors.
`fx init`, explicit `fx sync` and `fx login` prepare service settings through
trusted commands; `fx sync --only services --dry-run` previews. Existing non-empty
conflicts are reported, never automatically overwritten or activated. Sentry uses
public workspace `.sentryclirc` defaults with equivalent preservation behavior.
