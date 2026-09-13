# Setup and readiness

Setup turns provider recipes and team tool configuration into a verified plan.
The planner is pure; application workflows decide when to ask, check or execute,
and ports own those effects. Readiness describes prerequisites for a later query,
not proof that every repository or remote resource is accessible.

## Companion Skill destinations

`skill.dir_flag` installs a companion Skill once per distinct selected global
Skill directory, using paths supplied by AgentHostSpec. The bundled companions
support `--dir`; they need not recognize every agent identifier fx supports.
An empty agent selection executes no directory installer. Each expanded vector
still passes through the existing write and exact-command trust gates.

`skill.agent_flag` remains supported and takes precedence when both fields are
present, preserving existing patches over the bundled defaults. Remove it to
select directory targeting. Tools with neither flag retain their own targeting
behavior. `tool show` exposes both fields; installation summary counts are
command invocations, so directory targeting may report several for one tool.

## Selection and identity

Explicit tool and environment selectors must name declared entries before login
prompts or doctor repairs. Unknown tools use the existing `TOOL_UNKNOWN` error;
unknown environments use `ENV_NOT_FOUND`, with spelling suggestions. A disabled
tool or one with no setup recipe remains a valid selection.

A step's stable identity is tool, recipe ID and optional environment. Identical
expanded definitions may coalesce. Different definitions with one identity are
`step_conflict` plan problems, and those steps and their dependants are withheld.
This preserves existing acknowledgment/trust references without silently choosing
one platform's kubeconfig or permissions over another's. A multi-platform setup
that needs distinct actions under one identity must be disambiguated before it
can run; the current contract does not invent new platform-qualified step IDs.

`login --list` exposes the static plan and its problem notices. Executing a plan
with conflicting step definitions fails with `SETUP_PLAN_CONFLICT` before prompts
or setup effects. Doctor represents unresolved planning as incomplete coverage;
readiness returns unconfigured rather than inheriting another platform's checks.

## Readiness and reports

Version detection requires a successful exit and recognizable version output.
A failed probe may mention a runtime or package version;
that text must not make the tool ready. An unknown version verdict carries a
focused diagnostic handoff through both `can` and `where`: inspect the executable
and its version command before changing authentication or reinstalling it. This
keeps a local startup failure distinct from a failed authentication check.
Installation and ordinary readiness share this bounded version probe. Installer
success remains a separate result; a failed post-install check yields a null
version rather than reclassifying the installation itself as failed.

A capability or tool resolves to an unambiguous binding. Environment filtering
applies to platform instances; workspace-only bindings do not require an
environments document. A matching provider descriptor with no companion tools
is explicitly represented by `tool: null`. Its preparation can be ready without
running a tool check; the later query still verifies its actual resource.
Release uses the same readiness decision.

`where` additionally identifies a repository and platform. `--record` is an
explicit write mode with a recording response, described in
[probe recording](probe-recording.md). It does not turn readiness into blanket
permission to execute printed commands.

Doctor and release separate severity from coverage. `ok` means no failed finding;
`complete` means no requested check has incomplete evidence. Deliberate exclusions
are not applicable, and a checked advisory warning need not make a report
incomplete. Doctor's repair attempts are separate from its fresh check results.
The [Agent command guide](../../skills/fx-workspace/references/commands.md) owns
wire fields and recovery instructions.

## Initialization tool installation

Tools may opt in with `install_on_init: true` (default false, fx ≥0.1.1). The
application installs only missing enabled opt-ins after materializing, validating
and registering the source, before repository/resource sync. Installer vectors
come from `ToolInstall`; every installation and post-install probe vector is
approved through workspace trust before any package manager runs. Selection never
implicitly upgrades an existing binary or logs in to a companion service.

`init --dry-run` retains its non-materializing preview: `tool_install: null` and
`sync: null` mean these effects have not been planned from the source yet. Actual
success returns `tool_install` records. Missing installers, trust refusal, failed
installs and unverified/below-minimum installed versions stop init with an error;
the source registration may already exist and the same invocation can be retried.
Normal `sync` continues to run only tool checks; lifecycle hooks do not gain this
installation path. npm retains ownership of Registry authentication.

Readiness preserves missing_tool, outdated_tool and disabled_tool separately. Doctor evidence records binary_path from the execution PATH resolver. The Bitbucket status recipe requires configured=true; this verifies configuration, not arbitrary resource permissions. Skill trust failures are blocked tool rows, allowing independent owned projections to proceed. No selected hosts means no companion Skill invocation. User-owned fx copies share a lock and recheck version/ownership before writing; third-party installers retain their own idempotence contracts. Agent detection is distinct from selection; current activity remains unknown. Init emits a prepared installation/Skill plan after source validation and registration, before tools and clones; fresh remote dry-runs defer content-dependent effects.
