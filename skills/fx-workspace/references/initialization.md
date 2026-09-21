# Prepare a workspace

Use the supplied manifest and target directory literally, including spaces and
non-ASCII characters. Keep the executable returned by `self info`; another `fx`
may be an older installation. Init prepares its own Skill automatically.

```sh
fx init "<directory>" --from "<source>" --dry-run --format json
fx init "<directory>" --from "<source>" --format json
```

Include `--repos api,web` or `--no-repos` when the task specifies a selection.
Otherwise use the default. fx derives the registration name; do not rename the
target to satisfy a name rule.

Compare the preview's `root` with the requested target and review its effects.
Setup entries marked `prepare_if_needed` may execute their `command`;
`verify_only` entries only check prerequisites and hand unfinished work to its
owner. Personal authentication is never executed by init, including with `--yes`.
Use `--yes` when the exact automatic vectors and file replacements are already
authorized. A remote source not yet inspected is not approval for its commands.

Read `preparation.next` and take that branch:

| kind       | Action                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review`   | This is a preview; no work was performed. Review the plan, then apply.                                                                                                 |
| `complete` | Required preparation is verified. Continue the user's original task, such as reading their requested sample. No additional setup or diagnostic checklist is needed.    |
| `act`      | Run the returned `next_actions` within the task's authorization; retain each action's `argv`, `cwd` and non-secret `env`.                                              |
| `handoff`  | Report the blockers to their owners and wait for the prerequisites to change. Completed setup commands have already been performed; do not invoke them directly again. |

`state` is `planned`, `ready` or `incomplete`. Incomplete exits 12 and preserves
completed work. User actions are marked `actor: user` inside their blocker;
they are not Agent `next_actions`. Do not run personal login or create operator
files to get a green result. Optional host activation is separate from preparation.

After the person resolves the blockers, run the returned `resume` action. It
keeps the managed source and selection, verifies again and skips completed work:

```sh
fx init --resume --workspace <name> --format json
```

Use the complete retry returned with an early source error instead when the new
source was never accepted. Preserve both streams on failure. Default results
contain the decision and recovery; use `--details` only for a specific missing
piece of evidence, without repeating a successful write.

If fx is absent, install the package/source provided by the team within the
authorized prefix. npm configuration supplies Registry routing and authentication;
no separate FX_REGISTRY setup is needed. Verify `self info`, then use this route.
