# Changelog

## [Unreleased]

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
