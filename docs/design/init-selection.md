# Initialization and personal selection

Initialization owns the onboarding workflow: inspect and validate, register,
create the target directory, install opted-in tools, prepare public/local settings,
synchronize repositories and Agent resources, then verify required work. Local
source semantic errors and discarded declarations block before registration or
cloning. A remote source may first be acquired, but no business effect precedes
validation. Unknown ordinary extension fields are stripped and reported, as
[setup](setup.md#manifest-verification-alternatives) describes.

Preview and apply share toolchain selection and setup planning. The preview lists
known guide ownership conflicts and exact available command vectors; it never grants
trust. Source guidance stays unchanged: missing discovery regions are appended only
to generated workspace guides, preserving prose and existing region positions.
Malformed or duplicate markers require source repair. Replacing a foreign target
requires approval, keeps a backup and is protected against concurrent writes.

Init --resume --workspace uses the registered directory, managed manifest and
personal selection without materialization or refresh. It verifies current state
and skips successful work. A rejected new input returns the complete original retry
instead of silently continuing an older source. A directory's valid basename is
its default identity; spaces/Unicode get a deterministic safe name, and an existing
physical-root registration is reused. Planning and registration both compare real
paths, including symlink aliases. The resolved name is fixed under its lease, and
registration rechecks current state under that lease.

The [runtime contract](runtime.md) owns preparation output and exit codes; the
[setup policy](setup.md) separates local preparation from personal sign-in.

Repository and environment scopes have three explicit modes: `all` is an absent
scope key and dynamically follows shared declarations; `explicit` is a nonempty
personal list; `none` is an empty list. Personal repositories and the manifest
checkout remain separately managed; the shared repository scope never removes them.

`repo select` and `env select` replace a scope with the supplied names. `--all`
removes that key and `--none` writes an empty list. Names cannot accompany either
flag. `pick` adds names and `unpick` removes them.
Picking under dynamic all is a no-op, while unpicking expands the current universe
into an explicit list. Duplicate additions cannot create duplicate entries.

Scope edits validate the proposed merged layer before writing, including physical
checkout aliases, overlapping paths and paths containing the workspace root. The
same guard protects initialization and local repository registration. Path resolution
uses the nearest existing ancestor for missing checkout leaves. A rejected proposal
leaves the previous layer and its recovery commands usable.

Local-layer updates hold a per-layer lease and atomically replace the YAML file.
Each scoped mutation merges against the current layer inside that transaction,
preserving sibling repository/environment selections, hook preferences and setup
acknowledgments. Public workspace operations additionally hold the shared workspace
operation lease so selection cannot race identity changes.

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
`plan.registration` and `plan.default_workspace` carry the intended changes.

Local directory, stdin and local Git previews inspect content without copying it.
A first local Git preview reads committed HEAD because materialization clones
committed content. Repeated initialization previews the managed worktree when
refresh preserves local tracked or untracked changes, or a task branch. Ignored
files within the distributable source payload also preserve the managed worktree
because fx reads those documents and assets regardless of Git ignore rules.
Ignored non-payload files do not prevent refresh. The same protection decision is
used by preview and refresh; upstream tracking refs can be fetched, but the source
branch and files remain unchanged while these local payloads exist. For a clean managed
branch, local-source ancestry determines whether refresh can fast-forward; a
non-fast-forward preview keeps the managed snapshot. Unknown remote refresh results
remain uninspected instead of claiming future declarations are validated. Directory
inspection rejects missing manifests and symlink payloads before validation. Source
inspection supplies a read-only document reader to the same manifest loaders used
during application.

The repository preview and ordinary sync share `planRepositories` and domain
`planSync`. The repository plan reads local checkout state without querying
business remotes or incoming commits. Resource preparation can inspect local
installations, host selection and file ownership, and run already-authorized
read-only or native dry-run probes. It does not install tools, project resources,
register the workspace or grant new command trust. The plan includes known
conflicts and exact available vectors; its unchecked entries identify what still
needs verification during application.

Remote source previews do not fetch or clone. They return `source_inspected:false`,
`selection.validated:false`, `repositories:null`, and recovery explaining how to
inspect a local source. This does not assert source validity, selection validity or
readiness. On application, the source, selection and normal command trust gates are
validated before tools or business-repository cloning execute.

Initialization previews mark local setup as `prepare_if_needed` and personal/manual
prerequisites as `verify_only`. Only automatic steps expose an executable `command`;
verification vectors remain visible for exact authorization review. Approval never
turns personal authentication into automatic initialization.

Explicit `--workspace` selection accepts a registered name or an exact registered
root directory, resolving symlinks before comparing roots. Names take precedence;
an unknown selector never falls back to another workspace, and a root shared by
multiple registrations requires choosing an unambiguous name.
