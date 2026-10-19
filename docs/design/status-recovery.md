# Repository status and code-host readability

## Status fields

`status` reports three facts about a checkout's local work. `dirty` is true for
tracked index or worktree changes, including staged additions. `untracked` counts
non-ignored untracked files, including files inside new directories and regardless
of `status.showUntrackedFiles`. `uncommitted` is true for either kind of work.
Human output shows all three and `--dirty` selects `uncommitted`, so new files do
not disappear from a work-in-progress check. Ignored paths are excluded. An empty
selection is an empty collection rather than an invented clean checkout.

## Relation to sync

Status fields describe a checkout; sync's Git contract decides what happens to it.
Tracked changes on the tracked branch skip a working-tree update. Nonconflicting
untracked files can coexist with a fast-forward; Git refuses updates that would
overwrite them. A task branch permits only the tracked branch ref update.

When the tracked branch cannot be resolved, sync asks the remote for its branches
before calling it absent. An empty upstream, as behind a repository registered before
its first push, is skipped with outcome `empty_remote` and does not block readiness.
An upstream with other branches but not the tracked one is skipped with outcome
`no_remote_branch` and blocks readiness, since the manifest may track the wrong
branch. A branch the remote has but the checkout does not fetch remains a failure.
An unborn local branch fast-forwards once upstream has commits.

## Code-host readability

Code-host readability is a current observation rather than cached authorization:
no readability record, positive or negative, is persisted or read. Every explicit
sync planning pass asks the code host once per missing repository, and an explicit
unreadable listing asks once per repository; existing checkouts use Git. A retry
therefore sees recovered access and changed hosts.

A probe that outlives its [deadline](runtime.md#deadlines-and-process-lifecycle),
or whose optional API prerequisite is unavailable, reads as `unknown` and keeps the
Git transport fallback. An explicit refusal or missing result applies only to the
current operation. Cancellation and unexpected exceptions propagate. Readability
never guarantees a subsequent Git operation.
