# Repository status and validation recovery

`status` preserves the JSON `dirty` field for tracked index or worktree changes,
including staged additions. `untracked` counts non-ignored untracked files, including files inside new
directories and regardless of `status.showUntrackedFiles`; `uncommitted` combines either kind of work. Human output shows
all three and `--dirty` selects `uncommitted`, so new files do not disappear from
a work-in-progress check. Ignored paths are excluded. Empty selection remains an
empty collection rather than inventing a clean checkout.

These presentation fields do not change sync's Git contract. Tracked changes on
the tracked branch still skip a working-tree update. Nonconflicting untracked
files can coexist with a fast-forward; Git refuses updates that would overwrite
them. A task branch still permits only the tracked branch ref update.

Manifest validation judges every reported problem, including missing required
`manifest/workspace.yaml`, in ordinary and strict modes. A missing optional
manifest document has no problem; the bundled tools baseline remains available.
Selecting one document kind validates that requested kind only. Validation prints
its report before returning `MANIFEST_INVALID` when the report is not okay.

Code-host readability is a current observation rather than cached authorization.
Every explicit sync planning pass queries each missing repository once; existing
checkouts continue to use Git. Explicit unreadable listings also query live.
Old cache files are ignored without requiring migration or manual deletion.
Unavailable optional API prerequisites produce `unknown` and preserve the Git
transport fallback. Readability never guarantees a subsequent Git operation.
