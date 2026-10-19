# Changelog

## [Unreleased]

### Added

- Open pull requests on GitHub. `fx source push` works with a manifest source hosted
  on GitHub as it does with Bitbucket: it pushes the selected files to your verified
  personal fork through `gh` and opens, reuses or retires the pull request against
  its upstream, and `--pr` accepts a pull request number or its page on GitHub.
- Recognize checkouts cloned from github.com over HTTPS or SSH in `fx import`,
  which binds the `github` code host with the matching clone prefix as its host.
  A GitHub Enterprise server is still not guessed from a remote.
- Add `wecom-calendar-cli`, a local, searchable mirror of your own WeCom calendars
  with their history, to the tool catalog and as a `calendar` provider. `fx can`
  checks each member's sign-in and hands agents `wecom-calendar-cli event list`;
  filling the mirror with `wecom-calendar-cli sync` stays the member's call.

### Changed

- Judge a CI build by the commit it checked out when the platform names it.
  `fx release check` passes a successful build of the branch head and fails one of
  another commit, instead of comparing when the build started with when the head was
  written. GitHub Actions names the commit, and Jenkins does with jenkins-cli 0.12.0
  or later; without it the times still decide. CI evidence gains `commit`.
- Let a `github-actions` ci environment leave out `branch`. `fx release check` then
  counts the runs of the branch it is checking on each side.

## 0.11.0 (2026-10-12)

### Added

- Keep a `go.work` at the workspace root when the manifest sets `go.workspace: true`.
  `fx init` and `fx sync` list every selected checkout that has a `go.mod` at the
  newest `go` version they require, so each module builds against its siblings'
  checkouts. A repository not cloned yet is left out, fx replaces or removes only
  the `go.work` it wrote, and `fx sync --only go` refreshes it alone. `go.work` and
  `go.work.sum` no longer count as stray root entries in such a workspace.
- Bind a workspace to GitHub. The `github` code-host provider and the
  `github-actions` ci provider both drive the GitHub CLI `gh`, which joins the
  tool catalog with one sign-in per host for both. `fx release check` reads
  branches, commits, files and the last workflow run of a branch from GitHub just
  as it does from Bitbucket and Jenkins; a ci environment can narrow the runs it
  counts to one branch and one trigger. Opening pull requests through fx is not
  available on GitHub yet.

### Changed

- Rename `fx release` to `fx release check`, so the name says it checks a release
  rather than making one. `fx release` keeps working as a compatibility name.
- Say what each release would ship. `fx release check` opens each repository with
  the version its target branch declares, the head commits of both branches and how
  many commits on the source branch are not merged into the target yet, by how many
  people; repositories whose checks all passed close the output one line each with the
  same. JSON reports gain `repos[]` with these facts, summaries included; every
  existing field is unchanged.
- Name the commit a CI build is judged against, say "not merged into main" and "not
  merged back into dev" in the merge check, and use each platform's own name for the
  job or project in CI and error messages. CI evidence gains `head`.
- Show a repository's `release.note` in the release report, as the manifest schema
  describes.

### Fixed

- Resolve every relative link in the source AGENTS.md that names a file of the
  manifest source, such as `CONTRIBUTING.md`, in the guide derived at the
  workspace root. Only links into `README.md`, `docs/` and `skills/` resolved
  before, so the others pointed at files the root does not have.
- Stop `fx manifest lint` from asking for a code-host provider when every
  repository names its `upstream`, since such a workspace reaches no code host.
- Pass every argument intact to a companion that Windows starts through a batch
  file (`.cmd`, as npm, Scoop and Chocolatey install them). cmd.exe no longer
  interprets characters such as `&`, `|`, `%` or `^` in an argument.
- Read a local Git remote given as a Windows path, such as `C:\host\fx\api.git`,
  as project and name, so import, adoption, forks and `fx source push` work with it.
  Manifest documents are named with forward slashes in stdin bundles and source
  contributions on every platform, and import writes repository paths with them.
- Stop the PowerShell hook from writing task results into the agent's context,
  passing fx its input with a byte order mark, and writing progress records to
  stderr.
- Link source files with forward slashes in guides derived on Windows, and report
  the bundled tools catalog in `fx self info` as a file path, also when the install
  path contains spaces.

## 0.10.1 (2026-10-12)

### Added

- Publish the public `@angelmsger/fx` package to npmjs and attach its tarball to a
  GitHub Release for each version tag. The internal `@fx/devkit` channel is
  unchanged.

### Changed

- Group the human output of `fx release` by repository. Each repository with a
  failing or warning check gets its own block listing all of its checks, a problem
  every repository shares, such as a tool nobody has signed in to, is stated once
  above them with the command that resolves it, and the repositories whose checks all
  passed share one closing line. `--details` lists their checks too. JSON and NDJSON
  output are unchanged.

## 0.10.0 (2026-10-10)

### Added

- List what a workspace can be asked about with `fx can` and no target: one row
  per capability a manifest binds, and per platform instance for an
  environment-scoped one, with its scope, provider, companion tool and what it is
  for. A capability nothing is bound to keeps its row without a provider. The list
  reads bindings only; asking about one capability still checks readiness.

### Changed

- Say what a failed readiness check answered. Each pending step in a `can`, `where`,
  `doctor` or `login` handoff now carries `check`: what the tool said, or the step
  this one waits on. Where fx can read the failure it also names the cause, and the
  step's instructions then say what resolves it.
- Tell a cluster that did not establish authentication from one that answered no and
  from one that could not be reached. A request the cluster took for nobody's now
  leads to a step about the kubeconfig and its sign-in, with the page an updated
  kubeconfig comes from, rather than a request to the cluster's owner for a role.
- Check that a kubeconfig names its declared context without contacting the cluster,
  and give each request of the cluster access check five seconds.
- Answer `unknown` from `can` and `where` when a check gives no answer, because its
  tool did not start or it outlived its deadline, and list it under `unfinished`.
  `where` no longer fails for every platform of a repository because one of them did
  not answer. `doctor` and `login` report a tool that did not start as a missing tool
  in place of handing its step to a person.
- Give `<env> declares no <platform> platform` as the reason an environment does not
  cover a platform. The environment's note, which may be about another platform, is
  no longer that reason.
- Stop asking which environments a person uses during `fx login`. The personal
  environment selection is set with `fx env select` alone: until it is, every
  declared environment is in scope, and a login that names none with `--env`
  says so and how to narrow it. The question was asked even when `--env` named
  the environments, came back on every login for a person who answered "all",
  and narrowed what `fx doctor` and `fx sync` cover for one who answered with
  only the environment at hand.
- Leave the capabilities fx wires itself out of what an unknown `fx can` target is
  offered, and point its next steps at `fx can` and `fx tool list`.
- Keep MCP, rules and hook rows that report `untrusted`, `missing_variables`,
  `invalid` or `busy` in the summary of an `init`, `sync` or `doctor` JSON report.
  They were counted under `omitted`, while a `foreign` or `conflict` row of the same
  stage was shown.

## 0.9.1 (2026-10-09)

### Changed

- Show one row for checks that say the same thing and are resolved by the same
  commands in the human view of an incomplete `init`, `sync` or `doctor`, and mark a
  check that could not run apart from one that failed.
- Stop handing a sign-in to a check that could not finish. A timed-out companion
  check now only asks to be checked again.
- Quote why a bundled companion says it is not ready, in place of
  `expected authenticated to be true`: `OpenObserve returned HTTP 401`, for example,
  or a failed request to a server that takes no sign-in.
- Offer `fx doctor --fix` for Skill copies fx can bring up to date itself.
- Accept a companion context that reaches the declared service however its owner
  signed in. A `service` declaration's `auth_scheme` now only shapes a context fx
  creates and the sign-in `fx login` offers; preparation, checks and queries hold a
  context to the declared URL, flavor and organization and no longer pass
  `--auth-scheme`. An existing context that lacks one of those fields gains it
  without the declared method being named, which used to conflict with a context
  that signs in another way.
- Associate a login a person already has on every explicit `fx sync`, not only
  during `fx init`. Sync now applies local prepare-phase setup steps the way init
  does, so an adoptable login no longer waits for someone to run `fx doctor --fix`;
  personal sign-in still stays with the person, and background hooks only check.
- Say what an unmet companion check means where fx knows it. A login that
  `fx doctor --fix` can associate reads `an existing login can be reused`, and
  the three WeCom checks, now all judged by the response's error code, read
  `the WeCom API returned an error`.

## 0.9.0 (2026-10-09)

### Changed

- Derive `AGENTS.md` alone into the workspace root. fx no longer writes a
  `CLAUDE.md` pointing at it, and `fx manifest render` no longer creates one in
  the manifest repository: Claude Code 2.1.277 and later reads `AGENTS.md` by
  itself, and reads a `CLAUDE.md` in its place whenever one exists. `fx sync`
  removes the pointer an earlier version derived; `fx doctor` reports the guide
  as stale until it has. A `CLAUDE.md` you wrote stays where it is and no longer
  counts as a guide conflict; start it with `@AGENTS.md` so Claude Code still
  reads the guide. Delete the pointer from a manifest repository that still
  carries it.
- Leave `CLAUDE.md` out of the manifest source payload. A directory source's copy
  is no longer materialized, and a stdin bundle that names it is rejected with
  `MANIFEST_SOURCE_INVALID`.
- Show that a command is still working. After half a second a terminal gets one
  status line that is redrawn in place: the time elapsed, how far counted work has
  come and what has been under way the longest, such as
  `doctor 23s  checks 69/82  kubectl.access@dev 3s`. Every command has it, because
  each external call fx waits on is reported where it is started; `doctor`, `sync`,
  `init`, `status`, `release` and `login` also count their checks, repositories and
  steps. Results, notices and outcomes are written above the line, a question or a
  sign-in command takes the terminal over until it is done, and the line is gone
  when the command ends or is interrupted. While git or an installer runs, which
  may ask for a host key or a passphrase on the same terminal, nothing is redrawn
  under it and the line is printed every five seconds instead. On a terminal that
  shows the line, the per-item `start` lines and the repository heartbeat are no
  longer printed, since the line says the same. A pipe, a file, CI, `TERM=dumb`,
  `--quiet` and JSON or NDJSON output never receive the line and read exactly what
  they did.

## 0.8.0 (2026-10-09)

### Changed

- Run the commands fx defines for bundled tools without asking for trust,
  including the service preparation, login reuse and credential checks that a
  manifest `service` declaration fills in. Only command vectors the team's
  `tools.yaml` patch authors still require confirmation; a companion decides where
  its stored credentials may be sent.
- Rework the human view of an incomplete `init`, `sync` or `doctor`: each blocker
  appears under its check id, sign-in commands are joined per tool across
  environments, commands are spelled `fx` when PATH resolves it, and a terminal no
  longer receives the `PREPARATION_INCOMPLETE` envelope after the view. JSON output
  is unchanged.
- Report companion Skill installation progress once per tool instead of once per
  agent directory.
- Approve a team-authored companion Skill command once. The agent name or
  directory fx appends no longer makes each target a separate vector to confirm,
  and existing approvals stay valid.
- Say why a companion check failed in the tool's own words: read the message of an
  error object it printed, set log records and warnings aside, keep the line that
  follows where it failed, and state the expected value of a JSON check, as in
  `expected authenticated to be true`.
- Make human output readable on a terminal. Headings, state words and zero counts
  are told apart by colour, check lists and progress carry status symbols, commands
  to type stand out, tables fit the terminal width, a blocker's long reason wraps
  under its own column, and an error prints as text with its hint, next steps and
  hand-off instead of a JSON envelope. Only a terminal is decorated, each stream on
  its own: whatever the environment says, a pipe, a file and CI receive plain text
  and the JSON error envelope, and JSON and NDJSON output is unchanged. `NO_COLOR`
  removes the colour and keeps the symbols.
- Align human tables by terminal columns so rows holding CJK text line up, set a
  list's trailer apart with a blank line, drop trailing spaces after absent values,
  and print a list inside a record one field per line once an item runs long,
  leaving out empty fields.

### Fixed

- Root help on a terminal titles the everyday commands `EVERYDAY` again, and the
  `FIRST WORKSPACE`, `AGENT USAGE` and `COMPATIBILITY` headings are emphasised like
  the others.

## 0.7.1 (2026-10-09)

### Added

- Return `next_steps` from `fx repo show` that select and synchronize a shared
  repository not on disk yet, and say in the generated repository index that the
  catalog includes such repositories.
- Print each personal sign-in command once in human preparation output, followed
  by the command that continues afterwards.

### Changed

- Synchronize repositories without a code-host username, and without the notice
  about one, when the manifest uses explicit Git URLs and binds no code host.
- Install the bundled Sentry tool with npm (`sentry`).

## 0.7.0 (2026-10-08)

### Added

- Name `.workbench/` as the place for output that belongs to no repository. The
  derived guide gains a `workspace-layout` region with its rules, `fx doctor`
  reports root entries that nothing accounts for in a `root` group, `fx status`
  returns them as `stray_entries`, and the session-start context carries the
  latest observation. fx never writes inside the workbench.

## 0.6.0 (2026-10-08)

### Added

- Implement `metrics` with a `prometheus-cli` provider and add the companion to
  the bundled catalog. A service's coordinate is its scrape job; `where` prints
  an `up{job="..."}` query pinned to the declared server and offers no probe,
  because a selector that matches nothing still succeeds.
- Accept `auth_scheme: none` and `bearer` in a service declaration. A server
  declared without sign-in is ready when it answers and is never handed a login.
- Add the workspace capability `meeting` for the conferencing system that holds
  online meetings, recordings and minutes, with a `tencent-meeting` provider
  driven by `tmeet`, now in the bundled catalog. `calendar` keeps schedules and
  availability.

## 0.5.0 (2026-09-24)

### Added

- Reuse verified native companion logins in canonical team contexts before
  requiring personal authentication; retain native setup errors and verification
  details. Updated family CLI release floors require their auth reuse command.

## 0.4.0 (2026-09-21)

- Remove the self-reported Skill-loaded handshake and its notice setting; keep explicit installation/version discovery and unverified host activation.
- Prepare authorized local setup through init, hand off personal authentication together, and resume without repeating completed work.
- Replace preparation booleans with a scoped verdict and executable recovery actions; incomplete preparation exits 12, optional activation stays separate.
- Reject invalid declarations before workspace effects and complete generated guides without changing shared sources. Tools schema 3 requires run phases prepare/authenticate.
- Reuse npm scope/default registries and native authentication for self-update and version checks; make FX_REGISTRY optional and preserve public dependency routing.

## 0.3.0 (2026-09-20)

- Preserve login partial results, summaries and structured recovery information after handoffs or exceptions, including on nonzero exit.
- Protect manifest and guide edits from stale plans; move approved originals to backups atomically and retain per-file outcomes after document failures.
- State overall initialization/sync preparation clearly and stop interpreting descriptive metadata as failure states.
- Keep self-update installer output out of JSON stdout; clarify recovery and the difference between source documentation and published features.

- Add the `calendar`, `task`, `worklog` and `metrics` capabilities, with Lark and WeCom providers for the first two and a Jira provider for worklogs; `metrics` is named but unimplemented, so a manifest can describe it and binding it awaits a provider. `im` now means messaging alone.
- Add a Jira issue tracker and a Lark wiki knowledge base, so those capabilities each have a second implementation; one companion CLI serving several capabilities is installed and checked once.
- Derive a workspace's toolchain from the providers it binds, so a bundled tool no longer has to be named twice; `tool list` says whether a binding or the manifest put each tool there, and `--catalog` shows the rest.
- Let a capability bind a provider fx does not implement when the manifest declares a tool of that name, and correct an id that only resembles a bundled tool's name instead of obeying it.
- Accept `install_on_init` in a tools document's `defaults` block, which an entry can still override.
- Report a bound provider whose companion tool no tools document declares as `TOOL_UNDECLARED`, instead of claiming the capability has no provider.
- Check a platform's `service` block against the provider its name implies, so a valid declaration is no longer rejected and an invalid one is no longer skipped.
- Record the background phases a session-start run commits to, so phases a terminated worker never reached read as `HOOK_PHASE_UNREPORTED` instead of disappearing.
- Keep a background session-start run going when one companion command exhausts its budget, so every later phase still reports; a foreground run a host waits on still ends there.
- Record how a detached background run ended as the workspace's `run` observation, which its supervisor could previously write only to a stream nobody reads.

- Preserve explicit report fields in all output formats, workspace scope in recovery commands, and source identity through contribution locking.
- Import verified local Git coordinates, safely add matching upstream remotes to existing clones, and align preparation with enabled/required tool declarations.
- Accept all declared setup verification forms and preserve nullable comparison values through manifest overlays.
- Compatibility: `fx skill show` reports a missing bundled Skill as `BUNDLED_SKILL_MISSING`; `SKILL_MISSING` now names only the agent-facing notice.

- Add global workspace discovery, health, unregister, relocation and source rebinding while preserving business checkouts and preventing duplicate directory identities.
- Add repo/env select with explicit, dynamic-all and empty scopes, first-init repository selection and inspected local-source previews.
- Fix untracked work omitted from status filters, required manifests incorrectly passing validation, and stale readability caches blocking recovered repositories.
- Scope default doctor tool checks to declared tools and active provider requirements; retain explicit tool inspection.
- Compatibility: init registered now means actual registration state; intended effects are in plan. Profile import merges registrations by name and retains unmentioned workspaces; use workspace unregister for removal.

## 0.2.1 (2026-09-18)

- Shorten the repository entry and bundled Skill; keep detailed recovery in the command reference.
- Align report, readiness, Skill-loading and service-version guidance with current behavior across all four languages.
- Correct website release labels and preview examples, and document scoped Registry routing for public dependencies.

## 0.2.0 (2026-09-17)

- Breaking: `init`, `sync`, `doctor` and `release` JSON defaults to summaries. Use `--details` for all rows and evidence; `--fields` still projects full results.
- Preserve explicit empty agent selections across CLI, hooks and cleanup.
- Add advisory `FX_SKILL_VERSION` verification and `bundled_skill_version` discovery.
- Add `operation` / `preparation_complete` and `SKILL_WRITE_DENIED` recovery while preserving shared locks.

- Distribute public service presets during init and explicit sync, with scoped personal login and native conflict recovery.
- Reject personal credentials in shared service declarations and preserve existing companion configuration.

- Add standalone companion Skill install, uninstall, path, status and show commands.
- Generate team Skill discovery links and trigger descriptions in workspace guides.
- Separate explicit Skill refresh from automatic maintenance and protect shared sources.

- Track companion installation history and origin across registered workspaces; report unused fx-installed packages without uninstalling them.
- Prefer canonical resource commands in help/completion while preserving compatibility aliases.

## 0.1.2

Available through the internal Registry. Public publication remains on hold.

- Correct explicit input, readiness, Git-source recovery and concurrent configuration updates.
- Preserve partial initialization results, summarize human output and report repository heartbeats.
- Isolate blocked Skill commands, protect shared user copies and document host activation limits.
- Bound optional code-host probes and report preflight progress while preserving cancellation.
- Accept workspace root aliases and retain per-item installation and resource state after interruptions.

## 0.1.1

Available through the internal Registry. Public publication remains on hold.
Git tags, registry publication and local installation are separate states.
The project is `fx-devkit`, its binary is `fx`, and its license is Apache-2.0.
Internal distribution uses `@fx/devkit`; public distribution uses `@angelmsger/fx`.

- Opt-in installation of missing companion tools during initialization (`install_on_init`, fx ≥0.1.1).
- Manifest-driven workspace initialization, synchronization and repository selection.
- Structured configuration, discovery, readiness and release reports.
- Companion tool integration, agent Skills, lifecycle hooks and MCP projections.
- Source contribution planning with trust, ownership and recovery boundaries.
- Native Windows adapters; native execution and host activation remain unverified.
