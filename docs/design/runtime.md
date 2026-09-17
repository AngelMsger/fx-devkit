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
Errors remain JSON even in human mode, with category, stable code, message,
hint, next_steps and retryable. Handoffs describe the user's missing action.

`--no-input` and a non-TTY stdin never wait for a person. Missing input becomes a
structured error. `--fields` projects result data; top-level error envelopes on stderr remain
intact. Include nested recovery fields in the projection when they are needed. Successfully generated doctor/release reports exit zero; their `ok`,
`complete`, findings and coverage describe the actual outcome. Init/sync also
preserve partial outcomes: inspect synchronization summary, stage counts and
item failures. Additive `stage_details` retain document, Skill, tool, hook and MCP rows;
the existing `stages` field remains summary counts. A companion Skill error keeps
its structured `failure` and emits `SKILL_INSTALL_FAILED` on stderr, so neither
quiet output nor aggregation hides its identity and recovery data. Init exposes
these fields under `sync`. Registration or `written: true` does not prove readiness.

## Workflow report views

The CLI renderer summarizes JSON for init/sync/doctor/release, including partial
results and INIT_PREPARED notices. Application values remain complete. --details
returns those values; explicit --fields projects them before any summary filter.
Human and NDJSON retain their defaults. Summaries expose output_mode and omitted
counts, keep exception rows and exact trust/recovery data, and remove successful
rows and large finding evidence. Error envelopes remain intact on stderr.

Init/sync operation distinguishes preview/apply. preparation_complete is null in
preview, otherwise accounts for selected repositories and requested stages.
Protected or unavailable work and unverified activation are incomplete. Excluded
and explicitly inapplicable resources do not reduce completion. Doctor/release
ok and coverage complete keep their existing independent meanings.

Explicit empty agent lists survive scalar conversion in every entrypoint,
including hooks and harness cleanup; an unset value alone selects detection.
FX_SKILL_VERSION acknowledges the package-versioned bundled Skill. A legacy
FX_SKILL_LOADED boolean does not bypass version checks. This is advisory session
metadata, not an execution permission or proof of model comprehension.
Skill filesystem EPERM/EACCES errors, including wrapped lock errors, map to
SKILL_WRITE_DENIED with their original cause and local recovery. Global locks
continue coordinating shared targets across FX_HOME directories.

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

## Planned effects and readiness

Write use cases plan before gating. Dry-run returns the plan and makes no effect;
actual writes honor read-only posture and explicit replacement/ownership checks.
A batch preserves each failure's structured recovery instead of replacing it
with a success-shaped summary. Source and projection plans are rechecked before
application so stale evidence cannot overwrite intervening work.

Manifest execution vectors pass through TrustGate. Bundled defaults are trusted;
changed vectors require new approval bound to their exact identity. Installer
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
