// Reconcile recorded package operations against every locally registered manifest.
// PATH presence is observation only; suggestions never authorize package removal.

import path from 'node:path';

import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import { loadTools, loadWorkspace } from '../../domain/manifest/loader.js';
import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import {
  hasUnfinishedInstallation,
  observedInstallationOrigin,
} from '../../domain/toolchain/installation-origin.js';
import type { InstallationOrigin, ToolInstallation } from '../../domain/toolchain/installation.js';
import { resolveTools, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { FileReader } from '../../ports/fs.js';
import type { Process } from '../../ports/process.js';
import type { ConfigStore } from '../../ports/stores.js';
import type { ToolHistoryStore } from '../../ports/tool-history.js';

export interface InstalledTool {
  readonly name: string;
  readonly via: string | null;
  readonly spec: string | null;
  readonly binary: string;
  readonly binary_path: string | null;
  readonly version_after: string | null;
  readonly last_operation: string | null;
  readonly last_recorded_at: string | null;
  readonly installation_origin: InstallationOrigin;
  readonly recorded: boolean;
  readonly installed_by: readonly string[];
  readonly required_by: readonly string[];
  readonly unknown_workspaces: readonly string[];
  readonly state:
    | 'required'
    | 'unused'
    | 'unknown'
    | 'unverified'
    | 'not_on_path'
    | 'changed'
    | 'unscoped'
    | 'external';
  readonly uninstall_hint: string | null;
}

export interface ToolInventoryDeps {
  readonly history: ToolHistoryStore;
  readonly config: ConfigStore;
  readonly fs: FileReader;
  readonly process: Pick<Process, 'which'>;
  readonly bundledTools: () => string;
  readonly providers: ProviderCatalog;
  readonly manifestDirFor: (name: string) => string;
  readonly cliVersion: string;
}
interface Requirements {
  readonly tools: ReadonlyMap<string, readonly ResolvedTool[]>;
  readonly unknown: readonly string[];
  readonly known: readonly ResolvedTool[];
}

export class ToolInstalled {
  constructor(private readonly deps: ToolInventoryDeps) {}

  async execute(): Promise<InstalledTool[]> {
    const history = await this.deps.history.read();
    const requirements = await this.requirements();
    const packages = new Map<string, ToolInstallation[]>();
    for (const event of history) {
      const key = JSON.stringify([event.via, event.spec]);
      const events = packages.get(key) ?? [];
      events.push(event);
      packages.set(key, events);
    }
    const rows: InstalledTool[] = [];
    for (const events of packages.values()) rows.push(await this.describe(events, requirements));
    const recordedBinaries = new Set(history.map((event) => event.binary));
    for (const tool of requirements.known) {
      if (recordedBinaries.has(tool.binary)) continue;
      recordedBinaries.add(tool.binary);
      const binaryPath = (await this.deps.process.which(tool.binary)) ?? null;
      if (binaryPath === null) continue;
      const requiredBy = [...requirements.tools]
        .filter(([, tools]) => tools.some((entry) => entry.binary === tool.binary))
        .map(([name]) => name);
      rows.push({
        name: tool.name,
        binary: tool.binary,
        binary_path: binaryPath,
        via: null,
        spec: null,
        version_after: null,
        last_operation: null,
        last_recorded_at: null,
        installation_origin: 'external',
        recorded: false,
        installed_by: [],
        required_by: requiredBy,
        unknown_workspaces: requirements.unknown,
        state: requiredBy.length > 0 ? 'required' : 'external',
        uninstall_hint: null,
      });
    }
    return rows.sort(
      (a, b) => a.name.localeCompare(b.name) || (a.spec ?? '').localeCompare(b.spec ?? ''),
    );
  }

  private async requirements(): Promise<Requirements> {
    const config = await this.deps.config.read();
    const tools = new Map<string, readonly ResolvedTool[]>();
    const unknown: string[] = [];
    const known: ResolvedTool[] = [];
    for (const name of Object.keys(config.workspaces ?? {}).sort()) {
      try {
        const dir = this.deps.manifestDirFor(name);
        const workspace = await this.deps.fs.readText(path.join(dir, MANIFEST_FILES.workspace));
        // A missing source is not an empty set of requirements.
        loadWorkspace(workspace ?? '', {
          cliVersion: this.deps.cliVersion,
          providers: this.deps.providers,
        });
        const patch = await this.deps.fs.readText(path.join(dir, MANIFEST_FILES.tools));
        const loaded = loadTools(this.deps.bundledTools(), patch, {
          cliVersion: this.deps.cliVersion,
        });
        if (loaded.dropped.length > 0) {
          unknown.push(name);
          continue;
        }
        const resolved = resolveTools(loaded.doc, loaded.provenance);
        known.push(...resolved);
        tools.set(
          name,
          resolved.filter((tool) => tool.enabled),
        );
      } catch {
        unknown.push(name);
      }
    }
    const baseline = loadTools(this.deps.bundledTools(), undefined, {
      cliVersion: this.deps.cliVersion,
    });
    known.push(...resolveTools(baseline.doc, baseline.provenance));
    return { tools, unknown, known };
  }

  private async describe(
    events: readonly ToolInstallation[],
    requirements: Requirements,
  ): Promise<InstalledTool> {
    const last = events.at(-1)!;
    const success = [...events].reverse().find((event) => event.code === 0);
    const requiredBy = [...requirements.tools]
      .filter(([, tools]) =>
        tools.some(
          (tool) =>
            tool.binary === last.binary ||
            tool.install.some(
              (method) => method.via === last.via && (method.spec ?? tool.name) === last.spec,
            ),
        ),
      )
      .map(([name]) => name);
    let binaryPath: string | null = null;
    let probeFailed = false;
    try {
      binaryPath = (await this.deps.process.which(last.binary)) ?? null;
    } catch {
      probeFailed = true;
    }
    const state = installationState({
      success,
      events,
      requiredBy,
      requirements,
      binaryPath,
      probeFailed,
    });
    return {
      name: last.name,
      via: last.via,
      spec: last.spec,
      binary: last.binary,
      binary_path: binaryPath,
      version_after: success?.version_after ?? null,
      last_operation: last.operation,
      last_recorded_at: last.at,
      installation_origin: observedInstallationOrigin(events, binaryPath),
      recorded: true,
      installed_by: [
        ...new Set(
          events.flatMap((event) =>
            event.code === 0 && event.workspace !== null ? [event.workspace] : [],
          ),
        ),
      ].sort(),
      required_by: requiredBy,
      unknown_workspaces: requirements.unknown,
      state,
      uninstall_hint:
        state === 'unused'
          ? `No registered workspace needs this recorded package. Review ${last.via} package ${last.spec} for manual removal after checking use outside fx.`
          : null,
    };
  }
}

function installationState(input: {
  readonly success: ToolInstallation | undefined;
  readonly events: readonly ToolInstallation[];
  readonly requiredBy: readonly string[];
  readonly requirements: Requirements;
  readonly binaryPath: string | null;
  readonly probeFailed: boolean;
}): InstalledTool['state'] {
  if (input.requiredBy.length > 0) return 'required';
  if (input.requirements.unknown.length > 0 || input.probeFailed) return 'unknown';
  if (!input.success) return 'unverified';
  if (hasUnfinishedInstallation(input.events)) return 'unknown';
  if (input.events.some((event) => event.workspace === null)) return 'unscoped';
  if (input.binaryPath === null) return 'not_on_path';
  if (input.success.binary_path === null) return 'unknown';
  if (input.binaryPath !== input.success.binary_path) return 'changed';
  const origin = observedInstallationOrigin(input.events, input.binaryPath);
  if (origin === 'external') return 'external';
  if (origin !== 'fx') return 'unknown';
  return 'unused';
}
