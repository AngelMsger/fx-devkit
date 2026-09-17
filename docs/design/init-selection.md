# Initialization and personal selection

Repository and environment scopes have three explicit modes: `all` is an absent
scope key and dynamically follows shared declarations; `explicit` is a nonempty
personal list; `none` is an empty list. Personal repositories and the manifest
checkout remain separately managed; the shared repository scope never removes them.

`repo select` and `env select` replace a scope with the supplied names. `--all`
removes that key and `--none` writes an empty list. Names cannot accompany either
flag. Existing `pick` and `unpick` keep their additive and subtractive meanings.
Picking under dynamic all is a no-op, while unpicking expands the current universe
into an explicit list. Duplicate additions cannot create duplicate entries.

Scope edits return `before_mode`, `mode`, `before`, `after`, and `next_steps`.
They change only the personal layer, preserving the sibling scope and all business
checkouts. Repository changes require a later `sync` to clone new selections.
List rows expose `selection_mode`; the environment all-scope notice recommends
`env select` when a person wants to narrow the environment set.

`init --repos api,web` establishes an explicit shared selection before registration
and business-repository synchronization. `--no-repos` establishes `none`; the two
flags are exclusive. Neither limits declared tool, service or agent preparation.
An omitted selection preserves the existing personal scope, including on retries.
The manifest is validated and names are checked before registration and repository
cloning; an unavailable remote manifest may first require acquiring its source.

Initialization separates planned effects in `plan` from completed facts.
`registered` indicates actual registration, including on repeated initialization;
`default_workspace` indicates whether this workspace is the actual default.
`manifest: not_written` means preview did not materialize or refresh a source.
The previous initialization booleans described intended/new changes; consumers
should use `plan.registration` and `plan.default_workspace` for those decisions.

Local directory, stdin and local Git previews inspect content without copying it.
A local Git preview reads committed HEAD because materialization clones committed
content. Directory inspection rejects missing manifests and symlink payloads before
validation. Source inspection supplies a read-only document reader to the same
manifest loaders used during application.

The repository preview and ordinary sync share `planRepositories` and domain
`planSync`. Initialization preview reads checkout state but does not call provider
commands, install tools, write caches, register a workspace or grant trust. The plan
lists clone/update/skip actions, registration/source/personal-layer destinations,
opted-in global tools, companion Skills and declared MCP names. Exact resource
ownership conflicts, host selection, installation presence and service readiness
remain explicitly unchecked until preparation. Business remote access, incoming
commits and branch availability are also explicitly unchecked.

Remote source previews do not fetch or clone. They return `source_inspected:false`,
`selection.validated:false`, `repositories:null`, and recovery explaining how to
inspect a local source. This does not assert source validity, selection validity or
readiness. On application, the source, selection and normal command trust gates are
validated before tools or business-repository cloning execute.
