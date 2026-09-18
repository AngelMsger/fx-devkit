# Release checklist

`fx release` asks four questions of every covered repository — dependencies,
merge agreement, CI and unresolved errors — and answers them as one report.
Severity and coverage stay independent: [setup](setup.md) owns what `ok` and
`complete` mean, and a check nobody could answer is a warning with incomplete
coverage, never a pass.

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
source has and the target lacks is unreleased work, what the target has and the
source lacks is a hotfix nobody brought back. Merge commits and bot commits are
noise on that question; people's commits are the evidence, attributed through the
members document when it knows them. A direction nobody could compare is reported
as unanswered and does not undo what the other direction saw.

## Build currency

A branch counts as built when its job's latest build succeeded and started no
earlier than the branch's head commit: a green build of an older commit says
nothing about what is about to ship. The build carries no revision — the CI
platforms fx drives do not report one — so this is an ordering of times, and the
message says so rather than claiming the build was of that commit.

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
