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
intact. Include nested recovery fields in the projection when they are needed. Reports from doctor/release always exit zero; their `ok`,
`complete`, findings and coverage describe the actual outcome. Init/sync also
preserve partial outcomes: inspect synchronization summary, stage counts and
item failures. Additive `stage_details` retain document, Skill, tool, hook and MCP rows;
the existing `stages` field remains summary counts. A companion Skill error keeps
its structured `failure` and emits `SKILL_INSTALL_FAILED` on stderr, so neither
quiet output nor aggregation hides its identity and recovery data. Init exposes
these fields under `sync`. Registration or `written: true` does not prove readiness.

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
