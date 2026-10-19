# Architecture and contracts

`fx` turns shared workspace declarations into local checkouts, agent resources
and answers about platform access. It owns workspace orchestration; companion
CLIs own authentication and service protocols. The manifest is shared knowledge,
while machine selections, trust decisions and operation receipts stay in FX_HOME.

## Boundaries

The [engineering rules](../../AGENTS.md#architecture) own the layers, their
responsibilities and the import rules ESLint enforces; [validation](../validation.md)
owns test ownership.

Application owns preparation, recovery and result aggregation. Composition supplies
ports and registers implementations; it does not interpret their results. Shared
workflows include initialization preview, sync stages, tool version probes and
registered-workspace cleanup. Resource owners retain their reconciliation policy.

## Main flows

Initialization acquires a manifest source, validates its declarations and creates
a registered workspace. Shared declarations and the personal selection layer
produce the effective workspace; personal choices do not duplicate shared facts.
Git sources can refresh safely, while directory and stdin sources are snapshots.

Sync plans repository changes and managed resource projections, then applies
write gates before effects. Repository updates preserve user work; [repository status](status-recovery.md)
describes uncommitted-work visibility and live access checks. Guides, Skills,
hooks, MCP entries and rules use ownership checks so unrelated content survives.
Lifecycle dispatch reuses only the bounded background subset: it does not sync
business repositories or make contribution writes.

Readiness resolves a capability or tool to its binding and environment, then
runs read-only checks through ports. `where` combines that readiness with declared
coordinates. A printed command is an entry for the caller, never implicit
permission to execute it. `doctor` and `release` collect findings; successful
report generation is distinct from passing every requested check.

Source contributions capture selected whole files against a verified base,
validate the candidate and preserve the source checkout's HEAD, index and working
files. Explicit execution uses a verified personal fork and a recoverable PR
workflow. It is separate from the read-only ports used by platform diagnostics.

## Contract index

| Contract                                            | What it owns                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| [Runtime and commands](runtime.md)                  | Output, configuration, trust and process lifetimes                 |
| [Workspace identity](workspace-management.md)       | Registry discovery, relocation, source rebinding and owned cleanup |
| [Root layout](root-layout.md)                       | The workbench, accounted root entries and stray reporting          |
| [Initialization and selection](init-selection.md)   | Scope modes, first-clone selection and truthful source previews    |
| [Repository status](status-recovery.md)             | Uncommitted work and live code-host readability                    |
| [Setup and readiness](setup.md)                     | Manifest and selector validation, step identities and evidence     |
| [Release checklist](release.md)                     | Policy resolution, check order and build-currency semantics        |
| [Import](import.md)                                 | Repository discovery and inference without changing checkouts      |
| [Harness](harness.md)                               | MCP/rules declarations, projection ownership and readiness         |
| [Lifecycle](lifecycle.md)                           | Host dispatch, deadlines, background work and recovery             |
| [Windows](windows.md)                               | Native process/filesystem adapters, terminal and host protocols    |
| [Source contributions](source-contributions.md)     | Candidate validation, source isolation, fork/PR recovery           |
| [Probe recording](probe-recording.md)               | Conditional recording of dated coordinate evidence                 |
| [Registry configuration](registry-configuration.md) | Runtime Registry selection, self-update and publication boundaries |

[CLI reference](../cli/README.md) owns command syntax; the shipped
[Skill command guide](../../skills/fx-workspace/references/commands.md) explains
response interpretation and recovery. Keep behavioral facts with their owning
contract instead of appending feature notes to unrelated pages.

Design pages describe current contracts. [Validation](../validation.md) explains
checks and support boundaries; [evaluation](../eval/README.md) describes how to
collect team-specific evidence outside the public source repository.
