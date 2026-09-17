// Reconcile recorded package operations against every locally registered manifest.
// PATH presence is observation only; suggestions never authorize package removal.

import path from 'node:path';

import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import { loadTools, loadWorkspace } from '../../domain/manifest/loader.js';
import type { ToolInstallation } from '../../domain/toolchain/installation.js';
import { resolveTools, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { FileReader } from '../../ports/fs.js';
import type { Process } from '../../ports/process.js';
import type { ConfigStore } from '../../ports/stores.js';
import type { ToolHistoryStore } from '../../ports/tool-history.js';

export interface InstalledTool {
  readonly name: string;
  readonly via: string;
  readonly spec: string;
  readonly binary: string;
  readonly binary_path: string | null;
  readonly version_after: string | null;
  readonly last_operation: string;
  readonly last_recorded_at: string;
  readonly installed_by: readonly string[];
  readonly required_by: readonly string[];
  readonly unknown_workspaces: readonly string[];
  readonly state:
    'required' | 'unused' | 'unknown' | 'unverified' | 'not_on_path' | 'changed' | 'unscoped';
  readonly uninstall_hint: string | null;
}

export interface ToolInventoryDeps {
  readonly history: ToolHistoryStore;
  readonly config: ConfigStore;
  readonly fs: FileReader;
  readonly process: Pick<Process, 'which'>;
  readonly bundledTools: () => string;
  readonly manifestDirFor: (name: string) => string;
  readonly cliVersion: string;
}
interface Requirements {
  readonly tools: ReadonlyMap<string, readonly ResolvedTool[]>;
  readonly unknown: readonly string[];
}

export class ToolInstalled {
  constructor(private readonly deps: ToolInventoryDeps) {}

  async execute(): Promise<InstalledTool[]> {
    const history = await this.deps.history.read();
    if (history.length === 0) return [];
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
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.spec.localeCompare(b.spec));
  }

  private async requirements(): Promise<Requirements> {
    const config = await this.deps.config.read();
    const tools = new Map<string, readonly ResolvedTool[]>();
    const unknown: string[] = [];
    for (const name of Object.keys(config.workspaces ?? {}).sort()) {
      try {
        const dir = this.deps.manifestDirFor(name);
        const workspace = await this.deps.fs.readText(path.join(dir, MANIFEST_FILES.workspace));
        // A missing source is not an empty set of requirements.
        loadWorkspace(workspace ?? '', { cliVersion: this.deps.cliVersion });
        const patch = await this.deps.fs.readText(path.join(dir, MANIFEST_FILES.tools));
        const loaded = loadTools(this.deps.bundledTools(), patch, {
          cliVersion: this.deps.cliVersion,
        });
        if (loaded.dropped.length > 0) {
          unknown.push(name);
          continue;
        }
        tools.set(
          name,
          resolveTools(loaded.doc, loaded.provenance).filter((tool) => tool.enabled),
        );
      } catch {
        unknown.push(name);
      }
    }
    return { tools, unknown };
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
  const attempts = new Map(input.events.map((event) => [event.id, event]));
  if ([...attempts.values()].some((event) => event.event !== 'finished' || event.code === null))
    return 'unknown';
  if (input.events.some((event) => event.workspace === null)) return 'unscoped';
  if (input.binaryPath === null) return 'not_on_path';
  if (input.success.binary_path === null) return 'unknown';
  if (input.binaryPath !== input.success.binary_path) return 'changed';
  return 'unused';
}
