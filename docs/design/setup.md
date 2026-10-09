# Setup and readiness

Setup turns provider recipes and team tool configuration into a verified plan.
The planner is pure; application workflows decide when to ask, check or execute,
and ports own those effects. Readiness describes prerequisites for a later query,
not proof that every repository or remote resource is accessible.

## Initialization execution policy

Tools schema 3 requires each run step to declare phase prepare or authenticate.
Prepare steps are bounded, non-interactive local actions; authenticate steps remain
personal sign-in. Init verifies before every action, executes only approved local
preparation, and returns all human or authorization blockers together. A blocked
prerequisite prevents its dependants; independent local steps continue. Completed
checks are reverified on continuation rather than inferred from an acknowledgment.
Doctor --fix uses this same local-only policy. Explicit login remains the entry
for interactive authentication.

A custom executable declaration does not synthesize authentication from the bundled
catalog's default vector. Standalone auth must be explicitly declared; bound
providers retain their own authentication recipes. Relative verification files
resolve from the workspace root; ~ resolves from the user's home. The root is
created after validation/registration and before local setup starts.

## Manifest verification alternatives

Team setup checks use the same declared command/JSON, file and provider verification
alternatives as the runtime. Unknown-key normalization retains fields known by any
union alternative, including nested objects, arrays and maps. It does not select a
branch or erase conflicting branch fields; normal schema validation rejects mixed
or invalid alternatives. Genuinely unknown keys retain the existing lenient-report
and strict-error behavior.

Tool overlays preserve null where the schema accepts it as a value, such as
`verify.json.equals: null`. Elsewhere null retains its field-deletion meaning.
Normalization does not run checks, grant command trust or alter verification results.

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

A workspace's toolchain is derived, not declared twice: it holds the tools the
providers it binds drive, together with the tools its own overlay names. The
bundled document is a catalog of what fx knows how to drive and carries no
requirement of its own; entries nothing selects stay in it and are reported as
such. Derivation spans every environment the manifest declares, because
installation is machine-wide, while checks still narrow to the environments in
scope. A binding may name a provider fx does not implement when the overlay
declares a tool of that name; that provider yields no coordinate, and readiness
is the tool's. Catalog names are tools, not provider ids, so one used as a
provider is a mistake to correct rather than a definition to accept.

Explicit tool and environment selectors must name a tool fx knows and an
environment the manifest declares before login prompts or doctor repairs.
Selecting a catalog entry the workspace does not use is inspection, not
adoption, and remains valid. Unknown tools use the existing `TOOL_UNKNOWN`
error; unknown environments use `ENV_NOT_FOUND`, with spelling suggestions. A
disabled tool or one with no setup recipe remains a valid selection.

Doctor's default companion checks cover manifest-declared tools and tools used by
workspace providers or platforms present in the selected environment scope. A
bundled catalog entry alone does not make a tool relevant or required. `--tool`
explicitly checks any known tool. Active provider dependencies are required unless
the manifest explicitly sets `required: false`; explicit required tools remain
required regardless of provider selection. Disabled tools used by active providers
have incomplete coverage, while disabled unused tools are not applicable. The
same effective requirement controls login findings; neither a disabled tool nor an
unused catalog entry proves readiness. Unknown or capability-mismatched providers
in the active scope produce failure findings with incomplete coverage; a known
provider with no companion tools remains a distinct, valid case. Sparse tools
overlays are validated after inheritance, including during lint and doctor.

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

`login --format json` includes `items`, `has_more`, `summary` and `problems`;
`--list` includes plan problems even with `--quiet`. If a step needs human input
or a later step throws, read the partial result on stdout as well as the error
on stderr. Results distinguish `handoff`, `blocked`, `failed` and `not_started`;
completed steps remain visible. Handoff rows include the required action, and
service preparation rows retain available `failure` and `next_steps` fields.
After resolving the blocker, repeat the same invocation: setup verifies current
state before rerunning actions. Consumers that previously discarded stdout on
nonzero exit must now parse it when present. `self update` also captures installer
output so its stdout remains parseable; inspect the returned installer `code`.

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
A capability nothing is bound to is `CAPABILITY_UNBOUND`. A binding naming a
provider fx neither implements for that capability nor finds declared as a tool
of the workspace's own is `PROVIDER_UNKNOWN`, and its recovery is a provider that
exists. A bound provider whose companion tool neither the bundled catalog nor the
manifest describes is `TOOL_UNDECLARED`, and its recovery is that description,
not another binding. All three are configuration errors.
Release uses the same readiness decision.

`where` additionally identifies a repository and platform. `--record` is an
explicit write mode with a recording response, described in
[probe recording](probe-recording.md). It does not turn readiness into blanket
permission to execute printed commands.

Init, sync and doctor use the preparation contract in [runtime](runtime.md).
Doctor retains per-finding severity and coverage, with an aggregate coverage label;
required unknown checks block, optional unknown checks remain warnings. Explicit
tool selections are required within that query's scope. Release retains its
independent ok/complete checklist semantics.

## Coordinate composition

A coordinate is one repository in one environment on one platform. Its variables
merge platform, then environment, then repository override, and `{svc}`, `{repo}`
and `{env}` are substituted inside the resulting values. The command is the
manifest's own template when it declares one — a shell line, printed verbatim —
and the provider's default otherwise.

Absence is an answer rather than a blank coordinate. An environment that does not
declare the platform, a repository marked uncovered and an entry whose confidence
is already `not_covered` are all `not_covered`.

A metrics coordinate is a scrape job, and the provider default is a PromQL
selector whose braces are not placeholders: only `{name}` forms the manifest
vocabulary allows are substituted or reported missing. Metrics declare no probe.
A selector that matches nothing succeeds, so no read-only query separates a
missing job from a silent one, and only definite outcomes may change confidence.

## Initialization tool installation

Tools may opt in with `install_on_init: true` (default false). The
application installs only missing enabled opt-ins after materializing, validating
and registering the source, before repository/resource sync. Installer vectors
come from `ToolInstall`; every installation and post-install probe vector is
approved through workspace trust before any package manager runs. Selection never
implicitly upgrades an existing binary or logs in to a companion service.

`init --dry-run` retains its non-materializing preview: `tool_install: null` and
`sync: null` mean no effects were executed; inspected sources include their planned
vectors under plan.resources. Actual
success returns `tool_install` records. Missing installers, trust refusal, failed
installs and unverified/below-minimum installed versions stop init with an error;
the source registration may already exist and the same invocation can be retried.
Normal `sync` never installs packages; its services stage prepares declared public settings; lifecycle hooks do not gain this
installation path. npm retains ownership of Registry authentication.

Readiness preserves missing_tool, outdated_tool and disabled_tool separately. Doctor evidence records binary_path from the execution PATH resolver. The Bitbucket status recipe requires configured=true; this verifies configuration, not arbitrary resource permissions. Skill trust failures are blocked tool rows, allowing independent owned projections to proceed. No selected hosts means no companion Skill invocation. User-owned fx copies share a lock and recheck version/ownership before writing; third-party installers retain their own idempotence contracts. Agent detection is distinct from selection; current activity remains unknown. Init emits a prepared installation/Skill plan after source validation and registration, before tools and clones; fresh remote dry-runs defer content-dependent effects.

## Tool installation evidence

All companion package entry points use `ToolInstall` with `ToolAudit`. After write
and initialization trust gates, persist `started` before invoking the process,
`installed` immediately after exit zero, and `finished` with the version/path or
failure code. A probe failure cannot erase package success. No record is written
for plans, manual instructions or skipped installations. Failure to persist the
initial checkpoint prevents execution; later failures retain partial command
results and any earlier durable checkpoint. Process death leaves incomplete
evidence. The operation ID connects checkpoints; timestamps do not order concurrent
operations. Store order is authoritative for the latest observed outcome.

`FileToolHistoryStore` reads v1/v2 and writes v2 of the versioned `FX_HOME/tool-history.json` ledger. Its
append interface retains earlier events through a cross-process lease, private
file permissions, fsync and atomic replacement. Missing files start empty;
malformed, unreadable or foreign files are never overwritten. Command URL
credentials/query components and secret flags are redacted; output bodies are not
persisted. The file is personal state, absent from exported profiles and shared
manifests, and does not claim cryptographic tamper resistance or historical backfill.

`ToolInstalled` reads current local workspace/tool documents for every registered
workspace, without refresh or executing manifest vectors. Enabled declarations
retain a matching binary or manager/package even under another tool name.
Unreadable or quarantined toolchains prevent an unused verdict. Any unfinished
attempt for a package also prevents that verdict, including overlapping attempts.
Only successful recorded fx-origin package operations with a matching observed binary path
and no remaining requirements become `unused`; standalone operations, changed or
missing PATH entries and uncertain outcomes retain separate states. Requirements
outside this FX_HOME are not known. Sync's tools stage reports inventory and
`TOOL_UNUSED`; doctor emits advisory findings without adding an uninstall repair.
History and inventory inspection need no selected workspace or surviving tool
entry. The owning user contract is [installation history](../user-guide.md#tool-installation-history).

## Standalone companion lifecycle

`skill install/uninstall/path/status/show` work without WorkspaceDeps. Target flags
follow the maintained oa-cli family: repeatable/comma-separated `--agent`, optional
`--project`, mutually exclusive `--dir` as a Skill parent. Writes detect targets;
inspection enumerates all hosts. AgentHostSpec owns native paths and project
markers. Standalone detection ignores workspace selection; init/sync retain it.
Global detection retains fx's executable probes in addition to home markers.

SkillCopies shares canonical destination locking, ownership rechecks and recoverable
replacement. Explicit install refreshes recognized copies, while background and
workspace maintenance preserve equal/newer versions. Foreign replacement retains
fx's confirmation and backup contract; uninstall removes only identified copies.
Source overlap checks precede standalone writes and repeat inside the lease,
including canonical paths reached through team links. Partial failures retain
per-target outcomes and observations. Dry-run is allowed under read-only posture.

Self info and Skill commands provide explicit local discovery; business commands
do not scan global Skill directories or require a loaded-version declaration.
Skill commands skip network update probes. Skill status reports embedded_version,
installs and activation: unverified; each copy retains its version/alignment.
Show is raw text in every format. Other results retain the human default and
structured collection contract.

The team-skills generated guide region is rendered from current manifest Skill
frontmatter. Application reads metadata; domain templates render escaped text.
Source guides use relative links, derived root guides resolve source locations.
Existing guides keep their prose and receive a missing-region notice until their
maintainer adds the markers. Companion installers do not edit AGENTS.md.

## Installation provenance

Definition provenance (`base`/`patch`/`mixed`) and `installation_origin` are independent.
Before each actual package operation, observe the executable path and persist it
as `binary_path_before`. A previously absent executable establishes an fx-origin
candidate, confirmed only by successful execution and a matching post-install path.
A pre-existing unrecorded executable is external. Updates retain the prior origin;
legacy or interrupted evidence and changed paths stay unknown. Never infer ownership
merely from a successful update or backfill missing historical evidence.

Inventory also observes known unrecorded executables without writing receipts;
those rows have `recorded: false` and null package/operation fields. Existing paths
cannot reveal the original person/manager or detect same-path external replacement.
Only confirmed fx-origin records may produce unused-package suggestions. No
uninstall operation is provided. Tool definitions and requirement merging remain unchanged.

## Shared service preparation

ProviderDescriptor.settings declares which allowlisted fields and authentication
methods a provider accepts; manifest validation reads the registered catalog, so a new
provider needs no change to the rules. ProviderDescriptor.service compiles the
allowlisted manifest service into public preparation and separate personal recipes. Runtime variables derive from this same
source; environment overrides merge before planning. Service setup never exports
or reads credential stores. Family adapters delegate merge/conflict decisions to
native `config set-context --dry-run`; application executes the native command only
when needed, then verifies again. No automatic overwrite or activation is issued.
The family may activate its first context according to its own contract.

The services stage precedes repository/provider work on explicit sync and init.
It aggregates independent results and preserves blockers without running personal
login. Login uses the same preparation. Doctor/readiness check preparations first
and withhold dependent auth checks on failure. Background hooks never apply them.
Old manifests omit this opt-in and retain existing recipes. Native minimum versions
are checked before preset calls, independent of older workspace version floors.

Sentry declares a public INI projection at the registered workspace root. Compare
only expected defaults, preserve foreign content/links and recheck absence before
creation. Personal tokens are neither copied nor serialized. Login supplies --url;
checks and query commands carry the same public SENTRY_URL/SENTRY_HOST bindings.
For a patch-authored vector those bindings are part of its trust identity. Shell rendering scopes environment
changes to the command and restores PowerShell process variables afterward.

Preparation and check vectors compiled from bundled recipes need no approval. The
same steps for an executable the team patch substitutes require exact trust, which
a dry run cannot acquire. Shared declarations use a fixed public field allowlist; unknown service keys
are fatal before permissive unknown-field stripping. Errors report paths and public
conflicts, never the rejected credential value. Native conflict recovery is explicit
and does not confer permission to overwrite.

## Existing-login reuse

Family service preparation retains the manifest's canonical context name. After
public setup, a separate `phase: prepare` recipe invokes native `auth reuse`. Its
preview performs read-only matching/verification; `changed: true` authorizes a
planned association, and a subsequent unchanged preview verifies completion.
An unavailable candidate is a no-change result, not proof of authentication.
The independent credential recipe still checks auth status and handles personal
sign-in. It depends on reuse, so ambiguous identity, inaccessible storage or failed
verification cannot fall through to an unnecessary login.

Native tools own service matching, credential access and config updates. fx never
reads or serializes secrets and does not add a second identity registry. Existing
identities/current-context settings remain native and unchanged. The companion
release floors in defaults/tools.yaml must ship before an fx release requiring
this command; compatible installations are preserved. Release-order validation
must cover a prepared destination with an existing login under another name.

A service declared with `auth_scheme: none` has no identity to reuse or obtain,
and the companion refuses a login for it. Its provider replaces both recipes
with one manual access step verified by the status command's JSON answer, since
that command exits zero when the server does not respond. The check carries the
companion's own request timeout, shorter than fx's check deadline, so a server
that never answers is a verdict rather than an abandoned check. The step asks
for network access and never requests a credential.

Setup rows retain native failure category, code, hint and recovery commands. A
human handoff retains the failed verification detail instead of replacing it with
a generic request for authorization. No unchanged preparation is replayed merely
to obtain a different report view.

Authentication/access verification has a bounded 30-second command budget for
native storage and network checks; binary/version and public-configuration probes
keep their separate short budgets. Outer lifecycle deadlines still take precedence.

## Terminal handoff

Human preparation output includes the required user actions and their commands,
followed by the continuation command. Identical user commands appear once. Agent
actions remain separate; displaying personal sign-in never executes it. Structured
output retains all per-step evidence, including the workspace and recovery vectors.
