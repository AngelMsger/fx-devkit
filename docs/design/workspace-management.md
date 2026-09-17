# Workspace identity and recovery

The personal registry owns workspace names, roots and manifest sources. Discovery
uses it without requiring a healthy manifest. `workspace list` returns a collection
with `default_workspace` and `selection_error`; `workspace show [name]` returns one
record. Records include source, manifest location, default/current-directory/selected
markers, `selection` (`explicit`, `cwd`, `default`), readiness and a structured error.
Readiness distinguishes `ready`, `root_missing`, `unprepared`, `missing` and `invalid`.
An unfinished identity operation is reported as invalid with
`WORKSPACE_OPERATION_PENDING` and recovery guidance.

Resolution prefers an explicit name, the innermost physical root containing cwd,
then a valid default. Existing registrations without a selected identity are shown
as candidates rather than prompting another initialization. An invalid default
reference has its own diagnostic and cannot be saved through `config set`.
Physical-root aliases cannot be newly registered under different names; legacy
aliases remain discoverable but implicit selection is ambiguous. Explicit selection
continues to work.

Workspace commands reject missing roots before repository synchronization. A missing
source directory is unprepared; an existing source without required workspace YAML
is missing. Recovery carries the registered identity and source and quotes paths.
`self info` always returns its global facts when configuration is readable; its
workspace record reports degraded readiness or `workspace_error` explains why no
identity could be selected.

## Identity operations

All operations support read-only posture and a dry-run plan. Business checkouts,
branches, uncommitted files, global packages and global Skills are preserved.

- `workspace relocate <name> <dir>` rebinds a directory already moved by the user.
  The destination must exist and the previous distinct root must be absent. Identity,
  source, personal selections and preferences are retained. Old owned project
  resources at the moved root are retired, using original hook receipt owner IDs.
  Explicit `sync --workspace <name>` recreates them at the new root.
- `workspace rebind <name> --from <source>` validates a staging source before any
  cleanup, retains a complete backup of the previous source including Git history
  and uncommitted changes, retires old project resources, then installs the source
  under the same identity. Local selection is unchanged; a later sync reports
  unmatched selections and prepares new resources. Preview validates readable local
  and stdin sources; unavailable remote contents are `pending_apply`.
- `workspace unregister <name>` retires owned project resources, archives the
  workspace's personal metadata and source, removes registration and clears its
  default if selected. It does not select an arbitrary replacement default. A missing
  root is reported as `retained_unreachable`; archived ownership evidence remains
  available. Shared resources of legacy same-root registrations are preserved,
  shared Skill links are retargeted when a unique surviving source provides them,
  and source storage still referenced by shared guides is retained.

Project cleanup uses native hook and harness ownership protocols, exact derived
guide source markers, and exact team Skill link targets. Team Skill links use the
same bounded ancestor-path checks as text projections; redirected parent directories
block cleanup, and unlink/retarget recheck the path under a projection lease. Foreign files and unrelated
native entries are preserved. Conflicted receipted resources block identity changes;
registration and recovery metadata survive for a retry. Known shared harness entries
are retained when another same-root identity has matching ownership evidence.

## Serialization and interrupted operations

Public identity-dependent writes hold `workspace-operation:<name>` before taking
workspace, hook, projection or configuration leases. Init plans and applies within
that lease; CLI mutations pin their selected identity before reloading context.
Global agent cleanup takes the same lease per registration and rechecks it before
retiring resources. Write posture is enforced before effectful operation leases.
Dry-run, inspection and idempotent relocation do not acquire write leases. Background
refresh retains its workspace lease and never waits on an operation lease.

Lifecycle writes additionally hold the workspace projection lease. Their personal
`workspace-operation.json` records the previous and next identities and phase before
changing resources or sources. A retry of the same command resumes the operation;
a different identity operation is rejected until recovery completes. Ordinary
workspace commands refuse an unfinished identity operation. Pending recovery verifies that the current registry still matches its recorded
phase before resource cleanup. Registry changes are committed only after resource
cleanup and source validation/backup, and compare the current identity before writing. Recovery backups are never overwritten on retry.
