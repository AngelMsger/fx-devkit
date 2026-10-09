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

`--no-input` and a non-TTY stdin never wait for a person. Missing input becomes a
structured error. `--fields` projects result data; top-level error envelopes on stderr remain
intact. Include nested recovery fields in the projection when they are needed. Init/sync/doctor exit 12 when required preparation is incomplete; their structured
result survives that exit. Release retains exit zero with `ok` and `complete`. Login preserves completed and pending step rows on stdout even when a later
check fails or requires human input. Read stdout alongside the stderr error;
see [setup](setup.md) for statuses and recovery fields. Self-update captures
installer output rather than inheriting stdout. Init/sync also
preserve partial outcomes: inspect synchronization summary, stage counts and
item failures. Additive `stage_details` retain document, Skill, tool, hook and MCP rows;
the existing `stages` field remains summary counts. A companion Skill error keeps
its structured `failure` and emits `SKILL_INSTALL_FAILED` on stderr, so neither
quiet output nor aggregation hides its identity and recovery data. Init exposes
these fields under `sync`. Registration or `written: true` does not prove readiness.

## Workflow report views

The CLI renderer summarizes JSON for init/sync/doctor/release, including partial
results. Application values remain complete. --details
returns those values; explicit --fields projects them before any summary filter.
Init/sync/doctor emit a single structured result in JSON/NDJSON; their default human
view shows the task verdict, blockers and the next action. --details exposes the full
report. Release and ordinary collection commands retain their existing views.
With --fields, every workflow report uses its complete top-level result as the
projection source, including sync's items and trailer fields and doctor/release's
findings and summary. JSON and NDJSON emit one projected object; human output uses
key/value layout. --details does not change an explicit projection. Only selected
fields reach stdout; error envelopes and notices remain independent on stderr.
Dotted paths remain literal output keys and collect aligned values through arrays,
using null for missing values in individual rows. Empty arrays preserve [] without
claiming evidence that a nested field is unknown. Unknown top-level fields still
produce one non-fatal FIELDS_UNMATCHED notice; --quiet suppresses that notice.
Ordinary fact collections continue to project each row, keeping their collection
metadata and default per-row NDJSON format. Human rendering may abbreviate large
nested values; JSON/NDJSON preserve the complete projected values.
Summaries expose output_mode and omitted
counts, keep exception rows and exact trust/recovery data, and remove successful
rows and large finding evidence. Error envelopes remain intact on stderr.

Init/sync retain preview/apply in `operation`. Init/sync/doctor expose one
`preparation` contract: `state` (planned/ready/incomplete), scoped resources,
completed check IDs, required blockers, optional warnings, unchecked evidence,
concrete next_actions and a continuation action. Typed stage checks own the
verdict; rendering never decides readiness by searching nested result strings.
Only required checks block. Native activation remains separate from local
projection and service readiness; optional unverified activation is not a permanent
initialization failure. Doctor reports diagnostic coverage separately and no longer
exposes the old top-level ok/complete flags.

`preparation.next` names the current decision: review the preview, continue the
original task on complete, act on Agent recovery, or hand off missing prerequisites.
`next_actions` contains only Agent actions available for the current blockers;
personal actions remain on their blockers with `actor: user`. `resume` is separate
and is used after prerequisites change, not an unconditional next action.

Actions carry their actor, exact argv, cwd and requires_approval, plus optional env coordinates
for FX_HOME, HOME, USERPROFILE and FX_AGENTS. Preserve these coordinates when
continuing; they contain no credentials. The CLI binds fx actions to
the running executable; an error before the root exists uses an existing invocation
directory for retry. Normal incomplete reports exit 12 with PREPARATION_INCOMPLETE;
fatal errors preserve their original category and partial result. The human view of
an incomplete report lists each blocker under its check id, then the person's
commands, the repairs fx can make and the continuation. It spells the executable
`fx` when PATH resolves one, and joins actions that differ only in their `--env` or
`--tool` selection into one command. When both streams are terminals that view
replaces the PREPARATION_INCOMPLETE error; in every other case stderr still
receives it. Default summaries
retain every blocker/action and local setup outcome, including completed steps,
and selected initialization repository/guide/Skill effects, and omit redundant
execution plans. Workspace discovery
uses registration_status (available/root_missing/unprepared/missing/invalid), which
is not a readiness check. Existing category exit codes 1–11 remain unchanged.

Explicit empty agent lists survive scalar conversion in every entrypoint,
including hooks and harness cleanup; an unset value alone selects detection.
Skill discovery is explicit through self info, skill show and skill status.
Business commands do not scan installations or require a self-reported loaded
version. Native activation remains unverified until the host provides evidence.
Skill filesystem EPERM/EACCES errors, including wrapped lock errors, map to
SKILL_WRITE_DENIED with their original cause and local recovery. Global locks
continue coordinating shared targets across FX_HOME directories.

The global `--details` flag expands workflow reports; on fact queries the result
is already complete. Global `--workspace` accepts a registered name or root path
without changing fallback precedence or registering new workspaces.

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

The manifest source carries shared facts; personal config registers workspaces
and sets preferences, including agent selection across registered workspaces;
local layers select repositories and environments and carry repository overrides.
Profiles carry settings/local layers but no credentials, trust,
cache or manifest checkout. Their paths may need adjustment on another machine.

`manifest repo-set` rechecks the captured document under a file lease before
replacing it. If another writer changed it, the path is not a regular file, or
its directory is a symbolic link, `MANIFEST_EDIT_CONFLICT` preserves the existing
content. Inspect the real source path and retry with `--dry-run`; do not remove
locks or overwrite another edit. An identical edit reports `written: false`.

## Personal stores

A store's codec is written as a schema against the domain type it persists, so a
field the contract does not declare, one it declares and the schema drops, and
one whose stored type disagrees are compile errors rather than a document that
quietly stops matching the interface it claims to be.

Growth is versionless. The same file is written by whichever fx an agent host
launched and read by whichever fx the person runs next, so a field a newer fx
added is not corruption: reads ignore what they do not know instead of failing a
workspace closed, while writes stay strict and refuse a value outside the
contract. An ignored field is therefore also dropped by the next write — an older
fx degrades a document it does not understand, but never rejects it.

The cache is disposable and holds no such contract. A miss only costs another
probe, so nothing that goes wrong in it — unreadable, unwritable, not a regular
file — is anyone's error. Nothing there is followed either: a symlink where the
directory or an entry should be is a miss, and a write lands over it rather than
through it. An owner replacing the directory underneath a running fx is not
defended against; it is their directory.

## Planned effects and readiness

Write use cases plan before gating. Dry-run returns the plan and makes no effect;
actual writes honor read-only posture and explicit replacement/ownership checks.
A batch preserves each failure's structured recovery instead of replacing it
with a success-shaped summary. Source and projection plans are rechecked before
application so stale evidence cannot overwrite intervening work.

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

## Partial execution and recovery

Positional arguments disable implicit stdin parsing; explicit source stdin remains supported. Partial workflow errors preserve original category/code and render partial results before the error envelope. Unmatched projected fields produce a non-fatal FIELDS_UNMATCHED notice, with no notice for empty collections. Repository work emits a five-second heartbeat with completed/total, active names and elapsed milliseconds. Configuration transactions hold a cross-process lease over read/modify/write and use atomic replacement.

Optional Bitbucket repository/user probes use five-second process deadlines. Readability is probed live once per absent repository during sync planning or per repository in an explicit unreadable listing. No persisted readability record, positive or negative, is used; normal retries recheck recovered access and changed hosts. Timeouts become `unknown`; explicit refusals/missing results apply only to the current operation. Cancellation and unexpected exceptions propagate. Repository heartbeat records begin before planning and include `phase: preflight | apply`.

Configuration updates await asynchronous decisions while holding the lease. Init planning and registration both compare real paths, including symlink aliases; registration rechecks current state under that lease.

The executing Skill/package stage owns per-item `status` and partial results. Exceptions stop subsequent execution and retain prior rows. Skill recovery includes separate disk `observed` values because a failed operation may have written already; failed observations remain `unknown`. Package rows preserve the installer exit code even if a later version probe throws (`phase: version`). Sync nests a failing stage's partial result under `stage_details[stage]` without replacing its contents. These additions retain the original error category, code, guidance and exit status.

Document rendering and derivation share `ProjectionStore` snapshots and locked
compare-and-replace writes. `action` describes the plan; per-file `result` records
`planned`, `done`, `skipped`, `failed` or `not_started`. `DOCS_WRITE_CONFLICT`
preserves current content. Partial errors retain prior file results, including
when the subsequent native rules projection fails. Summary rendering keeps all
file rows in a failed docs stage. It does not infer completion from a planned action.

Approved foreign replacement uses `FileSystem.moveToBackup`: a same-directory
rename under projection leases, preserving the original object and existing
backup paths. Callers must still compare the vacated destination with absence
before creating a document. This replaces copy-then-remove, which could lose a
save made between those effects. These leases coordinate fx processes, not an
adversarial writer outside fx; native Windows evidence remains a separate gate.

Init and sync notices state the canonical preparation verdict and distinguish
repository counts from overall stage completion. A missing required tool can
leave preparation incomplete even when every selected checkout synchronized.

## Command selection and compatibility

Canonical resource entries are `agent skills`, `tool inventory`, `hook enable/disable`,
`manifest repo-set` and `manifest record-probe`; prior spellings remain compatible.
Standalone `skill` operations keep the oa-cli companion surface. Agent mutations
report global scope and affected workspaces; repo/env selection reports workspace
scope. Inventory/history are FX_HOME-wide. Tool installation/update requires either
names or `--all`; the latter selects missing enabled tools for install and all enabled
tools for update. Collection flags share repeated/comma-separated syntax. Completion
uses flag arity, negations and short names to retain routing after option values and
positionals. Native artifact commands keep their documented raw output exceptions.

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
