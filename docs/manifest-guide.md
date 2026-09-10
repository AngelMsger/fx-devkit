# Create a manifest source

A public installation of fx supplies the CLI, default tool definitions and the
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

## Start with a small declaration

For a team using the Bitbucket companion, create
`team-workspace/manifest/workspace.yaml`:

```yaml
schema_version: 2
providers:
  code-host:
    provider: bitbucket-cli
    vars:
      host: ssh://git@git.example.com:12345
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
This example requires the Bitbucket companion and access to the configured host;
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
checkouts or remove submodule bookkeeping. See the [import contract](design/import.md).

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

Maintain shared declarations in the registered source checkout and personal
selections through `repo pick/unpick`, `env pick/unpick` and `agent pick/unpick`.
Agent selection applies across workspaces in the same FX_HOME. For contributing
source changes through a verified personal fork, see
[source contributions](design/source-contributions.md).
