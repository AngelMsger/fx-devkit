# Changelog

## Unreleased

- Report a bound provider whose companion tool no tools document declares as `TOOL_UNDECLARED`, instead of claiming the capability has no provider.
- Check a platform's `service` block against the provider its name implies, so a valid declaration is no longer rejected and an invalid one is no longer skipped.
- Record the background phases a session-start run commits to, so phases a terminated worker never reached read as `HOOK_PHASE_UNREPORTED` instead of disappearing.

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
