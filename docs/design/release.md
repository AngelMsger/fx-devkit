# Release checklist

`fx release check` says what every covered repository would release and asks four
questions of it — dependencies, merge agreement, CI and unresolved errors — and
answers them as one report. It is read-only: a team runs it while it prepares a
release, typically until every source branch is merged into its target, and it
never merges, tags, publishes or deploys. `fx release` remains a compatibility name.
Severity and coverage stay independent: `ok` is true when no finding failed, and
`complete` is true when no finding has incomplete coverage. A check nobody could
answer is a warning with incomplete coverage, never a pass. The command exits zero
whenever it produced the checklist, so a caller reads both flags and the findings
rather than the exit status.

`evidence_complete` additionally covers the requested repository facts, including
unanswered declaration questions and optional version-history/baseline reads.
`facet_coverage` on each repository distinguishes `checked`, `incomplete`,
`not_requested` and `not_applicable` for declaration, version history, baseline
and errors. These facts do not change the existing `ok`/`complete` definitions or
the exit-zero report contract. A history lookup can be incomplete while all
requested checks passed. Structured failures stay beside their partial evidence.

The checklist knows capabilities, not providers. It asks the code host for
branches, a range of commits, one commit and one file, the CI platform for a job's
last build and the error tracker for open issues; whichever providers the manifest
binds answer, and a person reads each platform's own name for the job or project it
was asked about.

## What a release ships

Every verdict names what it is about. For each repository the report carries the
head commit of the source and the target branch, the version each head declares
and how many people's commits on the source are not merged into the target yet, and
by how many people. It counts them rather than listing them: a team that merges at
the end of a cycle can have hundreds, and the two heads name the range for whoever
wants the list, read with the code host's own tools. That count is what the next merge
brings, not everything the next version contains, which also holds what was merged
since the last release. The root `VERSION` file takes precedence over dependency metadata when present
on the source branch; the same selected file is read at both branch heads. Its
contents are trimmed, and an empty declaration stays unknown. Without `VERSION`,
the version is read from the same dependency file the dependency check reads. It finds the version a person wrote (`package.json`, the
`[project]` or Poetry table of `pyproject.toml` parsed as TOML, the project or parent
`<version>` of `pom.xml` with one `${property}` resolved, a top-level Gradle `version`
outside comments, or `gradle.properties`) and does not run the build. This description
judges nothing: whatever it cannot learn stays null, and when a question to the host
failed, the repository's `unanswered` names the field and the reason, because some of
these questions, such as the target's version, no check asks. The questions it shares
with the checks are asked once per repository.

## Pinned version evidence

Version history is opt-in for a release report. `repo version` reads it for any
known repository, including one excluded from the release checklist. Both use
the same code-host port and readiness gate. A requested branch, tag or commit is
resolved to an immutable SHA before files and history are read. Automatic source
selection prefers root `VERSION`, then supported package metadata. An explicit
repository-relative path can select a nested package. The declaration records its
actual `file`, `field`, `package_name` and `value`; a Gradle fallback names
`gradle.properties`, not the build script that referred to it.

Automatic discovery ignores dependency-only formats without a version reader,
such as `requirements.txt`, so they cannot hide a later supported source. Once a
supported source is present, an empty or unreadable declaration is incomplete;
it does not silently select another package. Maven supports a literal version or
one `${property}` resolved to a literal in the project's `properties`. Composite,
nested and unresolved expressions are unreadable, with
`VERSION_DECLARATION_UNREADABLE` retained in the evidence's failures.

The history walk compares the selected field along the first-parent chain, so
changing dependencies or whitespace does not count as a version change. The
source path, field and package identity stay fixed during the walk. It returns
the latest change's commit, commit time, previous value and current value. Only
an actual root commit establishes a root declaration. A shallow boundary, missing
parent, unreadable declaration, changed package identity or renamed/missing file
leaves coverage incomplete; absence at a non-root parent does not prove creation.
The walk has a bounded commit budget and reports `commits_read`, `termination`,
`next_sha` and structured `failures`. `next_sha` describes where it stopped, not a
promise that a later independent query reconstructs the original result.

An optional caller-selected historical baseline pins both refs, reads the same
declaration source on each side, and returns all commits reachable from the head
but not the baseline. This range includes bot and merge commits. It is separate
from `unmerged`, which counts people's commits absent from the current target
branch. fx does not discover the last published version from a date, assume that
a tag was deployed, infer a next minor version, or treat a source declaration as
a built artifact. Those decisions require the caller's release policy and evidence.

## Policy resolution

A repository's policy is the workspace `release` block with that repository's own
deviations applied and defaults filled in one place. The source branch comes from
the manifest entry, never from the resolved repository, because a person's
checkout override in `local.yaml` must not change a team report. A repository the
manifest does not list is never on the checklist, and `release.covered: false`
takes it off. Targets default to `main` and `master`; the look-back window
defaults to fourteen days and is written as an amount and a short unit (`14d`,
`48h`, `2w`), because a release checklist counts days, not months.

Error windows accept either that relative duration or explicit start/end instants
with a timezone. Absolute bounds normalize to UTC milliseconds and are half-open:
`[start,end)`. A whole local calendar day therefore ends at the following local
midnight. Relative windows share one command-start `observed_at`; per-repository
policy durations may still produce different ranges. Each repository records its
range, while the top-level range is null unless every repository shares it.
The report start is not a transactional snapshot of remote systems. Provider
timestamps with sub-millisecond precision retain their source values; boundary
comparisons truncate to milliseconds, never round forward.

## Selection and order

The checklist is the team's, so repository selection reads the shared registry
without the personal layer: what this machine picked or overrode does not change
it. A selection that names nothing is an error rather than an empty report. A
misspelled environment is answered once for the command, not as a warning on
every repository, because the name came from the person and not from a platform.

Readiness is judged before the worker pool starts and one gate at a time: a
tool's version probe has a short deadline that a machine already busy with
parallel subprocesses would miss, turning a ready tool into an unknown one.

## Dependencies

Nothing shipped may pin a `-dev` or `-snapshot` build. One dependency file is
read per repository, chosen by the language it is written in, and the parsers are
deliberately shallow: they find versions, they do not resolve them. A runtime
dependency fails the check; a development one is only named. A Gradle version
variable is as much of a runtime pin as the configurations that interpolate it,
so variables are read too; one nothing uses ships nowhere and is only named.

## Merge agreement

The branches a release moves between must agree in both directions: what the
source has and the target lacks is work not merged into the release yet, what the
target has and the source lacks is a hotfix nobody merged back. Merge commits and bot commits are
noise on that question; people's commits are the evidence, attributed through the
members document when it knows them. A direction nobody could compare is reported
as unanswered and does not undo what the other direction saw.

## Build currency

A branch counts as built when its job's latest build succeeded and built the
branch's head commit: a green build of an older commit says nothing about what is
about to ship. When the platform names the commit a build checked out, that commit
decides, and a build of another commit fails. When it does not, the best evidence
is an ordering of times: the build must have started no earlier than the head
commit was written, and the message names the head commit the build started after
rather than claiming the build was of that commit. The CI port asks each platform
for the latest build of the branch being checked; a coordinate that already names
one branch keeps its own.

Both sides of the release are checked, the source job and the target job, and
both must pass. A side nobody can date and a side whose job the platform does not
have are warnings rather than passes. A side the manifest names no CI coordinate
for says so instead of disappearing, and a platform state fx cannot map is
unreadable rather than failed.

## Unresolved errors

Every errors finding carries `evidence.query_context`, including authentication
failures, query failures and not-applicable results. It records `repository`,
nullable `environment`, normalized `range`, command-start `observed_at`, and
`source: {platform, provider, coordinate_fingerprint}` or null. Coordinates are
resolved before the readiness gate, preserving the same identity across a failed
authentication check and its retry. An unavailable or explicitly uncovered source
is null. The fingerprint identifies the provider's query scope without exposing
arbitrary variable values.

Sentry query fingerprints identify the configured endpoint, organization and
project selector, so repository aliases for one project retain the same source
identity. Repository and environment are bound separately in `query_context`.
Other tracker providers may supply their own query fingerprint; without it, the
full canonical coordinate fingerprint is retained conservatively.

Before treating a retry as superseding an earlier failure, a caller must match
the repository, environment, range and non-null source identity and retain both
observation times. Evidence from another server, organization, project or period
cannot replace that failure. fx reports each attempt separately; these fields
do not establish an atomic snapshot across queries or remote systems.

Exception cleanup evaluates currently unresolved issues active inside the window.
It collects those candidates before testing their lifetime first-seen date, so an
older active issue remains available to a caller investigating a regression. The
legacy finding still counts issues whose lifetime first-seen is inside the range,
no later than the command's observation time. Undated issues leave coverage
incomplete. This check alone does not establish that older issues are harmless.

The application traverses pages, deduplicates IDs and stops on exhaustion or an
explicit partial result. A page limit, missing/repeated cursor, lack of progress or
query failure never establishes absence. `error_evidence` keeps every collected
candidate, the range, `pages_read`, `has_more`, a continuation cursor when known,
`coverage`, `truncation_reason` and structured failures. There is no public fx
resume flag; retry the same absolute range or inspect the companion's query with
its cursor, keeping partial and subsequent results distinguishable.

The Sentry adapter reads metadata through the companion's API command, not the
issue-view command that also fetches events. It reads lifetime first-seen from
each issue's detail endpoint. List first-seen, filtered/window first-seen and
lifetime first-seen remain separate fields; failed or invalid detail dates stay
unknown and never fall back to list dates. Counts retain `count_scope: unknown`
and must not be described as newly occurring events in the range. Current status
and assignee are observed per response; each issue records its actual
`status_observed_at`, while the aggregate time is null. A historical range does
not reconstruct the issue's status or assignee at that historical time.

Error candidates retain the latest observed metadata for each ID across pages,
including a resolved or ignored status received after an unresolved list query.
The fresh-issue verdict excludes those confirmed terminal observations. Advancing
cursors remain progress even when a page repeats IDs. Structured query failures
also appear in the finding's `failures` array, so compact reports retain error
codes, retryability and recovery steps while omitting detailed evidence.

Tool readiness does not establish a complete project coordinate. A located error
coordinate without an executable query returns local `COORDINATE_INCOMPLETE`
evidence and never calls the tracker; explicitly uncovered coordinates remain
not applicable. Sentry queries prefer a configured positive numeric project ID,
otherwise use the exact project slug. Issue lists have a sixty-second deadline;
individual metadata reads retain thirty seconds and run at most four at once
per project. The repository worker budget also bounds concurrent project reads.

Sentry API reads set `SENTRY_NO_CACHE=1` only in the child process environment
to obtain current status rather than a stored HTTP response. This does not
change personal CLI settings. A full page can be terminal: the companion omits
pagination when its parsed Link metadata has no next page, so page size alone
is not evidence of truncation.

## Incomplete checks and recovery

The human report counts failed, warning, incomplete, passed and not-applicable
checks separately. Severity and coverage are independent: a confirmed failure can
also be incomplete, for example when the tracker returns only part of its issues.
Confirmed problems stay under their repositories. Unavailable or partial checks
are grouped by identical cause and recovery, with the exact check/repository scope;
`--details` instead expands every repository's checks. A shared cause never makes
an affected repository read as passing. Timeout groups offer a scoped retry with
`--jobs 1`; this is a diagnostic step, not evidence that concurrency caused it.

Query failures caught by the release workflow retain their structured `failure`
and recovery in JSON, including the compact view. A report with no confirmed
failure but incomplete coverage emits `RELEASE_INCOMPLETE`, not `RELEASE_OK`.
Its exit-zero report contract and JSON severity counts are unchanged.

An unresolved coordinate is incomplete coverage, not an exclusion or a pass.
The error-tracker workflow refuses coordinates whose command cannot be resolved;
the Sentry adapter additionally requires a concrete organization and project before
starting any query. Sentry's `org/` selector queries every project and is never a
valid fallback for a repository check. Explicit `not_covered` remains an exclusion.

## Responsibility evidence

`repo show` keeps its existing `owners` projection and adds `ownership_evidence`.
The latter uses the same scope and interval rules as member queries, preserving
each repository-linked area/scenario, named people, responsibility teams and
collective assignments separately. Coverage distinguishes no members document
(`not_configured`), no linked scope (`not_covered`) and evaluated scopes (`checked`).
An evaluated scope may explicitly have no relationships.

The selected `as_of` date filters declared relationship intervals in the current
members document; `basis: current_members_document` and
`historical_snapshot: false` prevent treating it as a historical personnel
snapshot. Person status, mentor and leader are current declared facts. The
projection does not choose an assignee, expand collective `all` into named
people, or infer responsibility from commit authors. A team workflow makes and
records the final assignment using this evidence.
