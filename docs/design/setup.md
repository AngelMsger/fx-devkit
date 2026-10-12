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

Without a target, `can` lists what may be asked about: every capability a manifest
binds, one row per platform instance for an environment-scoped one, with the
provider and companion tool its binding resolves to. A capability nothing is bound
to keeps its row without a provider. The list reads bindings and checks nothing, so
it takes no environment. Internal capabilities are wired by fx itself; they appear
neither there nor in the names an unknown target is offered.

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
is already `not_covered` are all `not_covered`. An undeclared platform gives that as
its reason, `<env> declares no <platform> platform`, in `where` and in `can` alike. An
environment's note speaks for the whole environment and is never that reason; `where`
lists it after the reason, as it does on every row of that environment. The answer
describes what the manifest covers, not whether such a service exists.

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
follow the maintained agent-clis family: repeatable/comma-separated `--agent`, optional
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

## Check reasons

A JSON check compares only its declared field. A bundled recipe may also name the
field in which the same response says why, and that reason is quoted in place of the
unmet expectation; nothing else from a response becomes a diagnostic. A tool that
fails without writing to stderr is described by the unmet expectation as well.

A bundled recipe may declare failure cases for a command check. A case states
conditions on the exit code and on what the tool wrote, and names a cause
(`credential`, `permission` or `network`) with the guidance that resolves it. The
first case whose every condition holds applies. Output no case answers to keeps its
cause unknown, and the tool's own words remain the detail either way. A cause says
what the check observed, not why: `network` means a connection could not be
completed, whatever stood in its way. Cases are static data of the bundled recipe and
appear with it in `login --list` and the init preview; the tools document does not
accept them. A check withheld under a dry run did not run and reports no failure.

A pending step is handed over with what its check last said. `check.result` is
`failed`, with the detail and the cause when a case applies, or `blocked`, with the
step it waits on. A case's guidance replaces the step's own instructions and page in
that handoff. `can`, `where`, `doctor`, `login` and the preparation actions built from
them carry the same handoff, and a step that still fails after a person finished it is
read by its check afterwards.

A check that gave no answer, because its tool did not start or it outlived its
deadline, has incomplete coverage and hands nobody a step: the tool is what to fix in
the first case, and checking again is the only step in the second. `can` and `where`
answer `unknown` for it and list it under `unfinished` with its error code; a step
waiting on it is as unknown and is not handed over. `login` stops with that error and
keeps the partial result, and `doctor` reports the finding with incomplete coverage.
Preparation marks such a check unknown and gives an agent its one action, inspecting
the tool or checking again within the environment; the steps waiting on it are unknown
too and carry no action, so nobody is asked to sign in for them. Whether a tool
started is what the process port reports, never an inference from its exit code: a
program that ran and exited 127 failed its check in its own words. A failure another step established
keeps its handoff, with the unfinished checks listed beside it, and one platform's
unfinished check does not withhold the other rows of a `where` query. An interrupted
check still fails the command. Release gates treat `unknown` as they did: the query
itself gives the evidence. A Skill copy fx can bring up to date carries the
`doctor --fix` action instead of waiting for a person.

## Cluster access

kubectl readiness is two steps per environment. The kubeconfig step reads the file
alone and passes when it names the declared context; its expected path stays the
step's destination. The access step asks the cluster one question, whether the
person may get pods in the environment's namespace or `default`, and gives each
request a deadline below the check's own, so a cluster that never answers is
kubectl's verdict rather than a check fx abandons. Only an answer of no is a
permission verdict. A request the cluster took for nobody's reads as `credential`:
authentication was not established, which leaves open whether the credential, its
kind or the way the kubeconfig signs in is at fault.

The step establishes that the environment can be asked. It does not establish that
every namespace, resource or verb of a later query is permitted, and a repository's
namespace override changes its coordinate, not this check. A coordinate is where to
look: `located` says the manifest resolved one, not that the repository runs there.

## Shared service preparation

Provider descriptors own accepted service fields, authentication methods and setup
recipes. Validation reads this catalog; environment overrides merge before a
service declaration is compiled. Declarations contain public settings only.

`ServiceProtocol` gives application typed plans and failures. The family adapter
interprets native JSON and conflict codes, filters public fields and redacts URLs
that contain credentials. Application owns trust, write gates and verification:

1. Check the native minimum version before invoking preset commands.
2. Preview the declared location with `config set-context --dry-run`.
3. Preserve an existing context's authentication method. Fill missing location
   fields only; name the declared method when creating a context that has none.
4. Apply a needed change and verify it with another preview.

Location checks compare URL, flavor and organization. The declared authentication
method shapes new contexts and offered sign-in; an existing context can serve the
location with any supported login method. fx never requests automatic overwrite
or activation; the native tool may activate its first context.

Explicit sync and init prepare services before repository/provider work. Login
reuses this preparation; doctor/readiness withhold dependent auth checks on failure.
Background hooks only check. Manifests without service declarations retain their
existing recipes.

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

After public setup, a separate `phase: prepare` recipe calls native `auth reuse`
for the declared context. Init, explicit sync and doctor --fix apply prepare steps;
background hooks and doctor without --fix only check. Preview is read-only, and an
unchanged post-write preview verifies association.

A no-change result does not prove authentication. The independent credential
recipe checks auth status and hands personal sign-in to the user. It depends on
reuse, so ambiguity, inaccessible storage or failed verification blocks dependent
login. Native tools own identity matching and credential access; fx stores no
secrets or parallel identity registry.

The companion version floors in defaults/tools.yaml must support reuse before an
fx release requires it. Release validation covers a prepared destination and an
existing login under another name.

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
