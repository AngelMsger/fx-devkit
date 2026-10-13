# Importing an existing workspace

`fx manifest import` reads an existing directory of independent repositories and
produces a candidate manifest. It does not clone repositories, change remotes,
move Git metadata or modify working files. Review the candidate before adopting
it as the team's shared source.

## Discovery

A directory is a repository root only when `git rev-parse --show-toplevel`
resolves to that directory. A scratch folder inside a Git repository must not
inherit the enclosing repository's identity. Discovery also visits one level of
nested repositories, such as `runtimes/worker`; it does not recursively scan
vendored dependencies or `node_modules`.

Submodule records are input evidence, not the destination layout. Both ordinary
clones recorded as gitlinks and repositories using absorbed Git directories may
be present. Import describes them without changing that arrangement. Adoption
or removal of old submodule bookkeeping is a separate operation.

## Inference

The importer records the basis of inferred values so reviewers can distinguish
explicit configuration from a fallback.

### Upstream repository

1. Use an existing `upstream` remote.
2. Otherwise use an `origin` outside a personal namespace as the upstream.
3. For a personal fork without an upstream, search projects already observed in
   the workspace for a matching repository name. Mark a resolved candidate as
   inferred; a personal namespace alone cannot identify its parent project.
4. Report repositories without a usable remote separately. Do not invent one.

Provider requests are read-only. A failed lookup leaves an unresolved item in
the report rather than preventing the rest of the directory from being imported.
A project the host could not answer for is recorded as unanswered, never as a
confirmed absence; the affected entry names those projects in its review note or
skip reason.

### Shared branch

1. Prefer an explicit branch in `.gitmodules`, when present.
2. Otherwise use the remote's default branch.
3. Fall back to the checked-out branch and flag it for review.

A current task branch, its tracking branch and the server's default branch can
all differ from the branch a team intends to share. Review branch inference;
never turn an individual checkout's state into an unqualified team convention.

### Projects and defaults

Observed projects populate the manifest's project registry. Access contacts stay
blank until someone supplies evidence; Git metadata does not identify who grants
permissions. Manifest lint reports the resulting gaps.

A code-host provider is emitted only when every imported repository has the same
verified binding. Local absolute paths and file URLs matching the local-git bare
repository layout are checked with Git before that provider is selected. File-URL
project and repository coordinates are decoded exactly once for filesystem
queries; literal filesystem paths retain their percent characters. Git SSH
or HTTPS transport alone does not identify a hosted API provider. The one host a
remote names unambiguously is github.com itself, over HTTPS or SSH, which binds
the `github` provider; a GitHub Enterprise server looks like any other host and is
not guessed. Unresolved or
mixed providers retain every exact upstream URL, omit defaults.host, and carry
review notes so no implicit Bitbucket binding is activated. Project and branch
values may still be folded. HTTP(S) remotes containing userinfo or query/fragment
data are skipped with a generic credential-removal handoff; neither generated
YAML nor diagnostics reproduce that remote. Ordinary git@ SSH usernames remain
valid transport metadata.

## Review and adoption

Deciding what belongs in the team workspace remains a content decision. A product
service and a personal experiment can have identical Git layouts. Review the
candidate manifest, remove unwanted entries and resolve annotations such as:

```yaml
- name: api-service
  # review: upstream inferred from an observed project with this repository name
  project: platform
- name: analysis-tools
  # review: branch taken from the checkout and may be a task branch
  branch: main
```

Directories that are not repository roots and repositories without remotes stay
in the report even when they cannot become manifest entries. Validate and lint
the accepted source before initializing or adopting a workspace from it.

## Command and safety boundary

```sh
fx manifest import <directory> --format json
fx manifest import <directory> -o <manifest-file> --dry-run --format json
```

Without `-o`, the command prints the candidate and report. With `-o`, it plans or
writes that explicit file. An output inside the imported directory is refused
with `IMPORT_INSIDE_ROOT`; the shared manifest belongs in its own source checkout.

Import does not clean dirty work, rewire remotes, create forks, carry over team
prose or remove submodule metadata. Use the corresponding explicit workflows
only after reviewing and authorizing their effects. A partial report with clear
uncertainty is useful even when a provider is unavailable.

## Origin-only adoption

Initialization and explicit repository sync can adopt an ordinary clone whose
only origin exactly matches the declared upstream. The plan exposes
`upstream_to_add`; apply rechecks both remotes, adds upstream, and records
`upstream_added`. Existing origin is preserved. A different origin or any
conflicting upstream is left unchanged, with skip_remote_mismatch or a concurrent
remote-change error. No URL equivalence or personal fork identity is guessed.

The addition shares the write gate with all other repository effects and is
visible in dry-run. Existing dirty, diverged and task-branch decisions still
control synchronization: adding upstream does not mean local work was committed
or synchronized. A protected tracked branch can therefore report upstream_added
and skip_dirty together. Git decides whether an allowed fast-forward is safe;
checkouts, untracked files and original branch selection are retained.

Sync and doctor share the active tool requirement policy. Unused bundled
companions do not prevent a local Git workspace from being prepared. Tool stage
rows retain `preparation_required` so optional observations stay visible without
making preparation incomplete; active default dependencies, explicit required
tools and install_on_init requests remain prerequisites. A required tool that is
explicitly disabled remains an incomplete prerequisite in both sync and doctor;
an optional disabled tool without an active provider is not applicable. An unbound code host is
reported as an API declaration gap, not a missing installation. Preparation does
not establish personal login or subsequent remote health.
