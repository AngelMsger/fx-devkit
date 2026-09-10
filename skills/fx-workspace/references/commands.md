# Command reference

The generated repository reference is `docs/cli/README.md`; installed commands
expose the same flags through `fx <command> --help`. Every
command accepts the global flags:

| Flag                           | Meaning                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `--format json\|ndjson\|human` | output format; agents use `json`                                   |
| `--fields a,b.c`               | keep only these dot paths                                          |
| `--workspace <name>`           | a registered workspace instead of the one containing cwd           |
| `--no-input`                   | never prompt; a needed answer becomes a structured error           |
| `--yes`                        | confirm prompts, including trust-on-first-use of manifest commands |
| `--dry-run`                    | on write commands: print the plan, change nothing                  |
| `--allow-writes`               | override read-only posture once                                    |
| `--quiet`                      | drop notices and progress (errors stay)                            |

Every `--help` ends with an `AGENT USAGE` block that restates the output
and error contract.

## Shapes of the answering commands

`fx can <capability|tool> [--env]` — one record:

| Field          | Meaning                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `ready`, `missing_tool`, `unconfigured`, `no_access`, `not_covered`, `unknown`                                                                                                     |
| `tool`         | the companion tool the provider needs, or `null` when none is required; `provider` and `env` identify the target                                                                   |
| `handoff`      | pending preparation or human interaction: `summary`, `user_steps[]` (`id`, `kind`, `title`, optional `instructions`, `open`, `command`, `expects.path`), `command`, `alternatives` |
| `alternatives` | commands that answer part of the question without the tool                                                                                                                         |

A bound provider without a companion tool has no installation or login check;
`ready` means preparation is complete, not that every repository query will succeed.

When a tool has multiple viable platform bindings, `can` returns
`CAN_AMBIGUOUS` rather than choosing by declaration order. Select a capability
and environment, or inspect repository platforms through `where`.

`fx where <repo> [--env] [--platform] [--no-check] [--probe]` — `items[]`, one per platform and environment:

| Field                             | Meaning                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `status`                          | `located` or `not_covered` (the environment has no such platform, or the repository is deliberately uncovered) |
| `ready`                           | the `fx can` status for this platform's tool in this environment; `null` under `--no-check`                    |
| `handoff`                         | as in `fx can`, when `ready` is not `ready`                                                                    |
| `command`                         | a shell line to show the person or run yourself once `ready` says so; `null` when not covered                  |
| `url`                             | the page behind it, when the provider knows one                                                                |
| `confidence`                      | `verified`, `derived`, `unverified`, `not_covered`, `not_found` — the weakest declared                         |
| `notes`                           | caveats from the manifest, most specific first                                                                 |
| `vars`                            | the merged variables, for composing another query                                                              |
| `outcome`, `suggested_confidence` | with `--probe` (needs `--env`): what the platform said, read-only, and the confidence to record                |

`fx member show <query>` — `items[]` of people: `id`, `display`, `email`, `status`, `accounts` (per system), `matched_by`, `via`.
`fx repo show <repo>` — the resolved entry, disk state and URLs, plus `owners`: `[]` when the members document names nobody, `null` when the workspace has no members document at all, else items of `area`, `lead`, `scenario`, `devLead`, `roles`, every person as `{id, name, email}` (name and email `null` when the id is not in the document, `all` included); `contact` is the project's contact.

### Diagnostic reports

Login and doctor reject unknown explicit tool/environment selectors before setup
or repair (`TOOL_UNKNOWN` / `ENV_NOT_FOUND`). `login --list` reports conflicting
expanded setup identities as `step_conflict` notices; executing that plan fails
with `SETUP_PLAN_CONFLICT`. Inspect the provider recipes rather than retrying the
same ambiguous setup. Doctor marks its missing verification as incomplete.

`fx doctor` and `fx release` return `ok`, `complete`, `summary {ok, warn, fail}`
and `findings[]`. Findings carry `group`, `id`, `level`, `coverage`, `message`,
`fix` and `handoff`; release findings also carry `evidence`.

Both commands exit 0 when the report was produced, even with failures.
`ok: true` means no `fail` finding. `complete: true` means no requested finding
has `coverage: incomplete`; `not_applicable` marks exclusions and `checked`
marks completed checks. Advisory warnings may still be checked. Inspect
findings and evidence before claiming readiness; neither top-level flag proves
that every capability is ready. For `can`, inspect `status` instead.

Doctor groups are `repos`, `tools`, `login`, `agents`, `manifest`, `self`,
`hooks`, `mcp` and `rules`. `manifest:docs` checks derived guides;
`manifest:upstream` checks source updates; `self:version` checks published CLI
updates. A development build needs no update; an unavailable registry produces
a warning, with a handoff when configuration is missing.

Doctor also returns `repairs`, empty without `--fix`. Each attempt is
`{group, status: planned|completed|failed, failure?}`. Failed attempts retain
structured recovery errors before post-repair findings are collected.
`completed` means the repair ran, not that the subsequent check passed.

`fx release [<repo>...] [--tag] [--only deps,merge,ci,errors] [--env] [--since]
[--jobs]` covers repositories selected by manifest release policy. Its evidence
is grouped by check:

| Group    | Evidence                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `merge`  | `source`, `target`, `ahead[]`, `behind[]`, `filtered`, `unknown[]` directions; commits have `sha`, `author {id, name}`, `date`, `message` |
| `deps`   | `file`, `offending[] {name, version, section, runtime}`                                                                                   |
| `ci`     | `builds[] {side, env, branch, path, number, status, started_at, url, current}`; null `path` means no declared job                         |
| `errors` | `env`, `slug`, `since`, `capped`, `undated`, `issues[] {short_id, title, level, first_seen, last_seen, count, url}`                       |

Uncovered explicit repositories yield `REPO_NOT_COVERED`, unmatched tags
`TAG_NOT_FOUND`, unknown environments `ENV_NOT_FOUND`, and an empty checklist
`CHECKLIST_EMPTY`. `--since` accepts windows such as `14d`, `48h` or `2w`;
invalid windows yield `BAD_SINCE`. Missing platform responses/jobs, undated
issues and builds that cannot be dated against the branch head warn rather
than prove readiness. `RELEASE_OK` / `RELEASE_FAILURES` are closing notices;
inspect report coverage even when the notice says OK.

End-of-command notices (stderr, any format, every command except `self update`, `completion` and lifecycle dispatch): `MANIFEST_OUTDATED` (next step `fx sync`) and `FX_OUTDATED` (`fx self update --yes`, then `fx sync --only skills`). Cached a day (fx) and an hour (manifest), silent on failure, the two probes side by side, each giving its upstream at most two seconds (local reads and writes of the cache and `~/.npmrc` are not under that clock). Off with `FX_UPDATE_CHECK=0`, the `update_check` config key, or `--quiet`; the same switch turns doctor's two live findings into `ok … not checked`. A command that fails before its configuration is read makes no check.

`fx sync` — `items[]` of repository rows, then `summary` and `stages` (`docs`, `skills`, `hooks`, `mcp`, `tools`) in the same envelope. Failed repository rows keep the display `error` and a
`failure` object with `category`, `code`, `message`, `hint`, `next_steps`,
`retryable` and optional `handoff`. Use that recovery data to decide what to
retry; the other rows may already have succeeded. Exit zero can accompany
partial results: inspect `summary.failed`, `summary.unreadable` and stage counts.
`stage_details` adds document `files`, Skill `links`/`fx`/`tools`, and tool-check,
hook and MCP `items` where those stages ran. Rules rows are nested under
`stage_details.docs.rules.items`. Skill tool rows retain exit `code`, a concise
`note`, and the companion's structured `failure` when supplied. `code: null`
means no command executed, including a dry-run plan. `stages` keeps its existing
counter shape; details supplement those counts rather than replacing them.
`fx init` nests this result under `sync`; its `written` field confirms local
registration work, not complete synchronization or readiness.

`fx manifest render --check` — exit 11 (`DOCS_STALE`) when the manifest repository's AGENTS.md regions differ from the manifest.

`fx hook list` — `items[]` with agent, action, activation, path, context and handoff,
plus workspace/root, the effective enabled setting, and dated observations.
`activation: unverified` means native trust/execution has not been established;
a matching projection alone is not readiness. `fx hook inject [--dry-run]`
enables this workspace and projects selected hosts. `fx hook remove [--dry-run]`
disables it and removes owned entries. Global `hooks` / `FX_HOOKS` gates all
workspaces; local `hooks.enabled` gates one. `agent unpick` remains global and
adds per-workspace hook cleanup results. Lifecycle dispatch is an internal,
fail-open host entry and is not a command to run for ordinary diagnostics.

## Source contributions and recording

`fx source push <paths...> --issue <id> --title <title> [--message] [--new]
[--pr <id|url>] [--dry-run]` returns one record with workspace, action, files,
branch, base/tree/commit identities, target, target_branch, planned message/title,
pull_request, findings, validated, written, fetched and retired operation IDs.
Nullable fields are explicit. `create`, `update`, `resume`, `associate`, `unchanged`,
`recover`, `needs-fetch` and `cancelled` are distinct actions. A preview does not
write Git objects, refs or journals. --pr must resolve to the current repository
and recorded source/target branches; an arbitrary URL is never used as a request
destination. Private manifest addresses are permitted, credentials/personnel content
are rejected, and only selected whole files enter validation and the commit.

`fx where ... --probe --record` returns a recording record instead of a list:
action (`preview`, `recorded`, `unchanged`, `skipped`), file, scope, path,
before/after confidence, note, row, written and handoff.
The row retains the normal where/probe fields and includes probe_template. Dry-run
sets after to null; only a real definite probe can set verified or not_found.
Stale documents, aliases/anchors or conflicting writes are refused.

## MCP

`mcp list` returns `{items, has_more, orphaned}`. `mcp show <name>` returns one
resource with symbolic bindings, projections and readiness. `can mcp:<name>`
optionally accepts `--agent <id>`; MCP resources are workspace-scoped, so `--env`
is not applicable. Use `sync --only mcp` for projection and `doctor` for repair.
