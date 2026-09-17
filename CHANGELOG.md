# Changelog

## 0.2.0 (2026-09-17)

- Breaking: init/sync/doctor/release JSON defaults to summaries; use --details for all rows and evidence. Explicit --fields still projects full results.
- Preserve explicit empty agent selections across CLI, hooks and cleanup.
- Add advisory FX_SKILL_VERSION verification and bundled_skill_version discovery.
- Add operation/preparation_complete and actionable SKILL_WRITE_DENIED recovery without relocating shared locks.

- Distribute public service presets during init and explicit sync, with scoped personal login and native conflict recovery.
- Reject personal credentials in shared service declarations and preserve existing companion configuration.

- Add standalone companion Skill install, uninstall, path, status and show commands.
- Generate team Skill discovery links and trigger descriptions in workspace guides.
- Separate explicit Skill refresh from automatic maintenance and protect shared sources.

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
