---
name: fx-workspace
version: 0.10.0
description: 'Use only when the user explicitly asks for the fx workspace CLI or manifest, or the current task is inside an fx-managed workspace or routed by its fx-derived AGENTS.md. Drive workspace init and sync, repository status and selection, manifest validation and editing, companion tools and login, doctor, agent Skills, repository ownership, environment coordinates and readiness through can/where, and release checks across dependencies, branches, builds and errors. Do not use for generic Sentry, OpenObserve, Jenkins, Kubernetes, logs, errors or builds outside an fx-managed workspace.'
metadata:
  requires:
    bins: ['fx']
  cliHelp: 'fx --help; fx <command> --help'
---

# fx workspace

Use fx for a manifest-managed workspace. Companion tools own their service APIs
and credentials. Outside a managed workspace, use the relevant product tool
unless the user explicitly asks for fx.

Run `fx self info --format json` once when the running version is not yet known.
Keep that executable prefix; its `initialization_guide` and `bundled_skill`
identify the instructions shipped with this version.

Choose the guide for the user's task:

| Task                                                                                          | Guide                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Prepare a workspace from a manifest, or resume unfinished preparation                         | [Initialization](references/initialization.md)   |
| Query, synchronize or maintain an existing workspace; route a service task; edit the manifest | [Workspace tasks](references/workspace-tasks.md) |
| Interpret a particular response field or advanced recovery contract                           | [Response contracts](references/commands.md)     |

For initialization, the source and target directory are sufficient. Follow the
initialization guide and `preparation.next`; it already includes verification.
Continue the user's original task on `complete`, or hand off the named missing
prerequisites. A list of other fx capabilities is not an initialization checklist.
No Skill-loaded declaration is needed for initialization. Read the other guides
only when that task or a specific failure needs them.
