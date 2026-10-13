# Release checklist

`fx release check` says what every covered repository would release and asks four
questions of it — dependencies, merge agreement, CI and unresolved errors — and
answers them as one report. It is read-only: a team runs it while it prepares a
release, typically until every source branch is merged into its target, and it
never merges, tags, publishes or deploys. `fx release` remains a compatibility name.
Severity and coverage stay independent: [setup](setup.md) owns what `ok` and
`complete` mean, and a check nobody could answer is a warning with incomplete
coverage, never a pass.

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
since the last release. The version is read from the same dependency file the
dependency check reads. It finds the version a person wrote (`package.json`, the
`[project]` or Poetry table of `pyproject.toml` parsed as TOML, the project or parent
`<version>` of `pom.xml` with one `${property}` resolved, a top-level Gradle `version`
outside comments, or `gradle.properties`) and does not run the build. This description
judges nothing: whatever it cannot learn stays null, and when a question to the host
failed, the repository's `unanswered` names the field and the reason, because some of
these questions, such as the target's version, no check asks. The questions it shares
with the checks are asked once per repository.

## Policy resolution

A repository's policy is the workspace `release` block with that repository's own
deviations applied and defaults filled in one place. The source branch comes from
the manifest entry, never from the resolved repository, because a person's
checkout override in `local.yaml` must not change a team report. A repository the
manifest does not list is never on the checklist, and `release.covered: false`
takes it off. Targets default to `main` and `master`; the look-back window
defaults to fourteen days and is written as an amount and a short unit (`14d`,
`48h`, `2w`), because a release checklist counts days, not months.

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

Exception cleanup asks for issues first seen inside the window and still open.
The tracker answers with activity inside the window; first-seen is judged here,
so an issue the tracker cannot date is neither counted nor forgotten. fx asks for
a bounded number of issues and the tracker says whether it had more — what it did
not send is unread, not absent.
