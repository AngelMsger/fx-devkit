# Runtime and command contracts

The CLI turns an invocation into a planned workflow and returns evidence. It
owns neither companion authentication nor the platforms those companions serve.
Application policies operate through ports; adapters translate actual processes,
files and service responses. [Architecture](README.md) shows these boundaries.

## Invocation and output

The command registry owns the tree. Everyday workspace commands are top-level;
resource groups use list/show for discovery, pick/unpick for selection, and
add/remove for locally registered references. Installation and update operate on
tools, while login and doctor establish readiness. Hidden lifecycle entries are
not public discovery results. Parser definitions also own global flag arity,
allowed values, routing, help and completion.

Human is the default format. JSON collections are `{items, has_more, next?}`;
NDJSON streams records and, where applicable, a final trailer. stdout contains
only the requested data. Notices, progress and optional diagnostics use stderr.
Errors carry category, stable code, message, hint, next_steps and retryable;
handoffs describe the user's missing action. They remain a JSON envelope even in
human mode on any stderr a program may read. A terminal in human mode prints the
code, message, hint, next steps and handoff as text; category and retryability
stay with the exit code and the envelope. A `FIELDS_UNMATCHED` notice follows the
same rule. An error raised before parsing, such as an unknown command or flag,
already follows the format the invocation asks for by flag, environment or file.
While that is undecided, because the configuration is unreadable or names no
format, it leaves as the envelope.

The human format is decorated per stream, and only on a terminal: a pipe, a file
and CI receive plain text with nothing shortened whatever the environment says,
and JSON/NDJSON are never decorated. Redirecting stdout while stderr faces a
person decorates stderr only. Colour, symbols and width are separate abilities of
a terminal. Colour comes from the sixteen-colour set and is removed by `NO_COLOR`
and `TERM=dumb`; a console that cannot draw the status symbols keeps colour alone.
Tables fit the width with the last column left free: the first column keeps its
width and the widest of the others is shortened. A blocker's reason that is too
long for the line wraps under its own column. Layout is otherwise the same in
both forms. Columns align by terminal
width, counting wide characters and emoji as two. A list inside a record prints
one line per item, or one field per line once any item runs long, and omits empty
fields. `Display` owns appearance; a view names roles and marks and never emits a
control sequence or measures the terminal itself.

A command that has run for half a second shows a status line on a stderr that
faces a person in the human format: a busy indicator, the command, the time since
it started, how far counted work has come and what has been under way for a
second or more, the longest first. It is one line, never wraps, is redrawn in
place and is gone when the command ends or is interrupted. `--quiet`, `TERM=dumb`,
a pipe, a file, CI and the machine formats have none, so a program reads exactly
what it read without it.

Two places feed the line without any workflow asking: the command base starts it
for every command, and the one subprocess port reports each call it waits on under
the caller's diagnostic phase, or the executable's name alone, never its
arguments. A workflow that knows its size adds a count through `Tally`: doctor
counts its checks, sync, status and release their repositories, login its steps.
What is said through the `Activity` port is never a record. Progress records stay
with `Reporter` and reach every reader in every format; on a terminal showing the
line, a `start` or `running` record is the line's to say and prints no line of its
own, while every outcome still does.

Everything else written to that terminal goes around the line: results, notices,
outcomes, diagnostics and errors are written above it. A question to the person
and a child process that owns the terminal take it over until they are done, and
the steps that had begun are written down first as the heading of what follows.

The line is redrawn only while no child can write to the terminal behind fx's
back. A piped child given a deadline or a cancellation signal leads its own
session and has no terminal; one given neither stays in fx's session, where git,
ssh or an installer may ask about a host key, a passphrase or a password. While
such a child runs, and on Windows while any child runs, nothing is redrawn: the
line is cleared before the child starts and is printed as an ordinary line every
five seconds instead, so a question is never wiped and fx is still never silent.

Repository work also reaches programs as a `repos` progress record when each phase
begins, every five seconds after that and once at the end: `phase` (`preflight` or
`apply`), completed and total counts, the active names and elapsed milliseconds. A
terminal showing the status line reads the same count there instead.

`--no-input` and a non-TTY stdin never wait for a person. Missing input becomes
`INPUT_REQUIRED` or `CONFIRM_REQUIRED`. Positional arguments disable implicit stdin
parsing; an explicit stdin source remains supported. Self-update captures installer
output rather than inheriting stdout.

## Workflow report views

The CLI renderer summarizes JSON for init/sync/doctor/release, including partial
results; application values remain complete. A summary exposes `output_mode` and
`omitted` counts, keeps exception rows and exact trust/recovery data, and removes
successful rows and large finding evidence. `--details` returns the complete values;
on a fact query the result is already complete.

Init/sync/doctor emit a single structured result in JSON/NDJSON; their default human
view shows the task verdict, blockers and the next action. Release emits one report
object in JSON/NDJSON. Its human view groups findings by repository: a repository
with a failing or warning check lists all of its checks, a non-ok finding every
repository shares is stated once above them, and repositories whose checks all
passed share one closing line unless `--details` lists them too. Ordinary
collection commands keep their tables.

Explicit `--fields` projects before any summary filter, and `--details` does not
change an explicit projection. Every workflow report uses its complete top-level
result as the projection source, including sync's items and trailer fields and
doctor/release's findings and summary. JSON and NDJSON emit one projected object;
human output uses key/value layout. Dotted paths remain literal output keys and
collect aligned values through arrays, using null for missing values in individual
rows. Empty arrays preserve `[]` without claiming evidence that a nested field is
unknown. Fact collections project each row, keeping their collection metadata and
default per-row NDJSON format. Human rendering may abbreviate large nested values;
JSON/NDJSON preserve the complete projected values.

Only selected fields reach stdout. Error envelopes and notices stay independent on
stderr and are never projected, so include nested recovery fields in the projection
when they are needed. Unknown top-level fields produce one non-fatal
`FIELDS_UNMATCHED` notice, none for an empty collection, and `--quiet` suppresses it.

## Preparation contract

Init/sync keep preview/apply in `operation`. Init/sync/doctor expose one
`preparation` contract: `state` (planned/ready/incomplete), scoped resources,
completed check IDs, required blockers, optional warnings, unchecked evidence,
concrete next_actions and a continuation action. Typed stage checks own the
verdict; rendering never decides readiness by searching nested result strings.
Only required checks block. Native activation remains separate from local
projection and service readiness; optional unverified activation is not a permanent
initialization failure. Doctor reports diagnostic coverage separately.

`preparation.next` names the current decision: review the preview, continue the
original task on complete, act on Agent recovery, or hand off missing prerequisites.
`next_actions` contains only Agent actions available for the current blockers;
personal actions remain on their blockers with `actor: user`. `resume` is separate
and is used after prerequisites change, not an unconditional next action.

Actions carry their actor, exact argv, cwd and requires_approval, plus optional env
coordinates for FX_HOME, HOME, USERPROFILE and FX_AGENTS. Preserve these coordinates
when continuing; they contain no credentials. The CLI binds fx actions to the running
executable; an error before the root exists uses an existing invocation directory
for retry.

A planned or ready report exits zero. An incomplete report exits 12 with
`PREPARATION_INCOMPLETE`, and its structured result survives that exit. A fatal
error keeps its own category, which maps to an exit code from 1 to 11, and its
partial result. Release has no preparation verdict: it exits zero and reports `ok`
and `complete` as the [release checklist](release.md) defines them. Registration or
`written: true` does not prove readiness. Workspace discovery reports
`registration_status`, which is not a readiness verdict;
[workspace identity](workspace-management.md) owns its values.

The human view of an incomplete report lists what is blocked under its check id, one
row for checks that say the same thing and are resolved by the same commands, and
marks a check that could not run apart from one that failed. The person's commands,
the repairs fx can make and the continuation follow. It spells the executable `fx`
when PATH resolves one, and joins actions that differ only in their `--env` or
`--tool` selection into one command. When both streams are terminals that view
replaces the PREPARATION_INCOMPLETE error; in every other case stderr still receives
it. Default summaries retain every blocker/action and local setup outcome, including
completed steps, and selected initialization repository/guide/Skill effects, and
omit redundant execution plans.

Init and sync notices state the canonical preparation verdict and distinguish
repository counts from overall stage completion. A missing required tool can
leave preparation incomplete even when every selected checkout synchronized.

## Partial results

A partial workflow error keeps its original category and code, and the partial
result is rendered before the error envelope. Read stdout alongside the stderr
error.

Login keeps completed and pending step rows on stdout when a later check fails or
requires human input; the
[Skill command guide](../../skills/fx-workspace/references/commands.md#readiness-and-recovery)
owns their statuses and recovery fields.

Init/sync keep the synchronization summary, stage counts and item failures.
`stages` holds summary counts; `stage_details` holds the document, Skill, tool, hook
and MCP rows, and init exposes both under `sync`. The executing Skill/package stage
owns per-item `status` and partial results; an exception stops subsequent execution
and retains prior rows. Sync nests a failing stage's partial result under
`stage_details[stage]` without replacing its contents.

A companion Skill error keeps its structured `failure` and emits
`SKILL_INSTALL_FAILED` on stderr, so neither quiet output nor aggregation hides its
identity and recovery data. Skill recovery includes separate disk `observed` values
because a failed operation may have written already; failed observations remain
`unknown`. Package rows preserve the installer exit code even if a later version
probe throws (`phase: version`).

Document rendering and derivation share `ProjectionStore` snapshots and locked
compare-and-replace writes. `action` describes the plan; per-file `result` records
`planned`, `done`, `skipped`, `failed` or `not_started`. `DOCS_WRITE_CONFLICT`
preserves current content. Partial errors retain prior file results, including
when the subsequent native rules projection fails. Summary rendering keeps all
file rows in a failed docs stage. It does not infer completion from a planned action.

## Configuration

The domain config codec owns the stored configuration shape for both local files
and exported profiles. Infrastructure reads/writes that shape; application owns
selection and precedence. The settings catalog owns descriptions, environment
names, defaults and the supported CLI override mappings.

Precedence is explicit flag, environment, file, default. `config get`,
`config list` and ordinary command execution use the same values. A parser-filled
environment value is not an explicit flag. `--explain` names only applicable
layers: a setting without a CLI override does not advertise a nonexistent flag.
Malformed configuration fails with actionable configuration errors.
Explicit empty agent lists survive scalar conversion in every entrypoint,
including hooks and harness cleanup; an unset value alone selects detection.

Configuration transactions hold a cross-process lease over read/modify/write,
await asynchronous decisions while holding it and use atomic replacement.

The manifest source carries shared facts; personal config registers workspaces
and sets preferences, including agent selection across registered workspaces;
local layers select repositories and environments and carry repository overrides.
Profiles carry settings/local layers but no credentials, trust,
cache or manifest checkout. Their paths may need adjustment on another machine.

`manifest repo-set` rechecks the captured document under a file lease and leaves
the document as it is when replacing it would not be safe. The
[Skill command guide](../../skills/fx-workspace/references/commands.md#concurrent-manifest-edits)
owns the `MANIFEST_EDIT_CONFLICT` response.

## Personal stores

Each store owns its schema and compatibility policy. User-editable `config.yaml`
and workspace `local.yaml` reject unknown keys on read with `CONFIG_INVALID` and
`LOCAL_INVALID`, respectively. Configuration updates also validate the new values;
local-layer workflows supply typed selections and overrides to their store.

Hook and harness metadata, contribution journals and tool history use schemas
checked against their domain types. Their reads ignore unknown fields and their
writes reject values outside the contract. A subsequent write drops unknown fields,
so older versions can read newer files without promising to preserve fields they
do not understand. Recognized ownership and version markers still apply; the
[tool-history contract](setup.md#tool-installation-evidence) describes its versioned
ledger. These policies do not imply that every personal file has a schema or uses
the same versioning rules.

Configuration, trust, resource metadata and journals share atomic file replacement.
Each store owns its codec, lock scope, ownership checks and error contract.
Contribution journals, harness ownership and tool history flush the file before
rename and the containing directory afterward on POSIX. Projections retain file
permissions. Workspace journal parent checks reject foreign ancestors within FX_HOME.

Cache failures are misses, never command failures. Reads reject non-files and
symlinked entries or directories. Writes replace a linked entry without following
it and leave linked directories alone. Concurrent replacement of the cache directory
by its owner is outside this guarantee.

## Planned effects and readiness

Write use cases plan before gating. Dry-run returns the plan and makes no effect;
actual writes honor read-only posture and explicit replacement/ownership checks.
A batch preserves each failure's structured recovery instead of replacing it
with a success-shaped summary. Source and projection plans are rechecked before
application so stale evidence cannot overwrite intervening work.

Approved foreign replacement uses `FileSystem.moveToBackup`: a same-directory
rename under projection leases, preserving the original object and existing
backup paths. Callers must still compare the vacated destination with absence
before creating a document. These leases coordinate fx processes, not an
adversarial writer outside fx; native Windows evidence remains a separate gate.

Command vectors authored by the team patch pass through TrustGate, and a changed
vector requires new approval bound to its exact identity. Bundled defaults and
provider recipes are trusted with whatever public settings a service declaration
fills in; a companion's own context matching decides where its stored credentials
may go. A patch that substitutes a tool's executable makes every vector of that
tool patch-authored. A companion Skill installation is approved as the command the
patch wrote: the agent name or directory fx appends is not part of that identity,
and an approval recorded earlier for a whole vector still counts. Installer
vectors are assembled by fx from installer and package data. Execution is an
argument-vector contract, not a raw shell string API. Windows batch interpretation
is an adapter concern. `command_shell` affects presentation only: it does not
change execution vectors, their trust identity or canonical recorded evidence.

Acknowledging a setup step records an action, not successful configuration.
Readiness requires a current check. Manual/file steps become user handoffs;
automatic repair is limited to run steps and owned projections. Provider query
ports are read-only. Fork and contribution writes have separate capabilities
and authorization. See [setup](setup.md) for selection and coverage semantics.

## Deadlines and process lifecycle

| Work                           | Bound and outcome                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Package/manifest update lookup | Two-second upstream deadline; failure is silent and never changes the command outcome |
| Provider query                 | Fifteen seconds for family tools; thirty seconds for the slower Sentry CLI            |
| Code-host identity/readability | Five-second process deadline; a timeout reads as `unknown`                            |
| Hook foreground                | Independent two-second supervisor; host wrapper allows three seconds                  |
| Hook background                | Thirty-second supervisor; companion calls receive the remaining bounded budget        |

Update checks cache successful and failed attempts. They are disabled for self
update/completion, quiet mode and the `update_check` preference. Local filesystem
work, including npm configuration/cache access, is not an upstream deadline.
Lifecycle dispatch never waits for network; it returns locally cached context
and schedules only the permitted manifest/docs/Skills/readiness work.

Bounded POSIX children own process groups; timeout/interruption cleans up those
groups before normal signal handling continues. Windows performs bounded,
owned-PID tree cleanup with direct-child fallback. It is best-effort resource
cleanup, not containment of a process tree whose root has already disappeared.
Piped command output is buffered; native MCP uses a separate byte-stream entry
with no ordinary CLI notices or update checks. The distinctions are explicit
because interactive commands, queries, hooks and MCP have different IO lifetimes.

[Lifecycle](lifecycle.md) owns hook scheduling, output limits and projection
recovery; [Windows](windows.md) owns platform-specific behavior and acceptance.

## Command selection and compatibility

Canonical resource entries are `agent skills`, `tool inventory`, `hook enable/disable`,
`manifest repo-set` and `manifest record-probe`; prior spellings remain compatible.
Standalone `skill` operations keep the agent-clis companion surface. Agent mutations
report global scope and affected workspaces; repo/env selection reports workspace
scope. Inventory/history are FX_HOME-wide. Tool installation/update requires either
names or `--all`; the latter selects missing enabled tools for install and all enabled
tools for update. Collection flags share repeated/comma-separated syntax. Completion
uses flag arity, negations and short names to retain routing after option values and
positionals. Native artifact commands keep their documented raw output exceptions.
Global `--workspace` accepts a registered name or root path; it selects among
registered workspaces only and leaves the fallback order of
[workspace identity](workspace-management.md) as it is.

Command aliases are explicit registry data. Runtime dispatch accepts them; primary
help, typo suggestions and command-name completion advertise canonical entries.
Topic help and generated references carry a separate compatibility mapping, with
legacy documentation anchors retained. Completion keeps routing and flag metadata
for already-typed aliases. Root/topic/leaf invocations normalize leading global
flags consistently while retaining strict rejection of malformed values.

Manifest source inspection and editing respect explicit workspace flags/environment
before cwd discovery. Unknown explicit selectors fail rather than editing a nearby
checkout. Without a selector, standalone source maintenance keeps cwd precedence.
Commands taking a source-independent schema or explicit directory retain those
contracts. All file-output flags include the `-o` shorthand.
