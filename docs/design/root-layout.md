# Root layout

The managed root is a plain directory, so nothing reports a new entry there the
way Git reports an untracked file. fx names one place for output that belongs to
no repository, decides which root entries are accounted for and reports the rest.
It never creates, moves or removes any of them.

## The workbench

`.workbench/` at the workspace root holds what a task produces outside a
repository. The name is a fixed part of the CLI contract rather than a manifest
or personal setting: guides, agent memory and reports cite paths under it, and a
setting would make those citations depend on the machine.

| Path                                   | Holds                                                               | Lifetime                                           |
| -------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| `.workbench/<YYYY-MM-DD>-<topic>/`     | One directory per task: reports, plans, evidence, demos and scripts | Kept; not renamed or moved once something cites it |
| `.workbench/worktrees/<repo>-<topic>/` | Targets of `git worktree add` for a repository                      | Until the branch lands                             |
| `.workbench/tmp/`                      | Reproducible or bulky material                                      | Disposable at any time                             |

`tmp` and `worktrees` are reserved names; every other first-level entry is a task
directory. Lifetime follows location: nothing may cite `tmp/`, and a task
directory keeps its path, so whether something can be deleted never depends on
finding what refers to it.

fx owns nothing under the workbench. Sync does not create it, and relocation,
source rebinding and unregistration leave it in place. Repository discovery
during import skips hidden directories, so worktrees kept there are not taken
for repositories.

The `workspace-layout` guide region states these rules to agents. Like every
region, it is appended to a derived guide whose source has no markers for it.

## Accounted entries

A first-level entry of the root is accounted for when it is one of:

- the first path segment of a declared repository, selected or not, of a
  repository registered on this machine, or of the manifest source repository;
- a derived guide;
- the first segment of a project path that any host in the `AgentHostSpec`
  inventory reads, whether or not that agent is selected;
- a file that a bound provider declares as its service preparation;
- the workbench;
- operating-system or editor state: `.DS_Store`, `Thumbs.db`, `desktop.ini`,
  `.vscode`, `.idea`, `*.code-workspace` and `*.iml`.

Anything else is stray. Hidden entries are judged like visible ones, because
agents favor hidden names for exactly the output this contract relocates. A stray
entry has a kind: `checkout` when it contains `.git`, otherwise `directory`,
`file` or `link`.

## Reporting

One inspection feeds three existing outlets and adds no command or flag.

| Outlet    | Shape                                                                                         |
| --------- | --------------------------------------------------------------------------------------------- |
| `doctor`  | Group `root`: one `warn` finding per stray entry, identified by its name, or one `ok` finding |
| `status`  | Trailer `stray_entries`: the stray names, empty when there are none                           |
| Lifecycle | Background phase `root`: `ROOT_STRAY` with a bounded digest of names, or `ROOT_ACCOUNTED`     |

A stray entry is clutter, not a broken workspace. Its finding is never required,
so it changes neither `preparation.state` nor the exit status. Only an
unregistered checkout carries a command, `fx repo add`; where any other entry
goes is its owner's decision. The background phase is local and read-only, and
runs before the phases that reach the network or a companion.
