// Applying a profile written by `config export`, reporting for each workspace
// layer whether the write created it, changed it or left it alone.

import path from 'node:path';

import { parseProfile } from '../../domain/config/codec.js';
import type { Profile } from '../../domain/config/profile.js';
import { DevkitError } from '../../domain/errors.js';
import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Lease, Lock } from '../../ports/lock.js';
import type { ConfigFile, ConfigStore, LocalLayerStore } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { assertNoWorkspaceOperation } from '../workspace/health.js';
import { acquireWorkspaceOperation } from '../workspace/operation.js';

import { validateImportedLayer } from './import-layer.js';
import { assertImportIdentitiesUnchanged, mergeProfileConfig } from './import-registry.js';

export interface ConfigImportDeps {
  readonly config: ConfigStore;
  readonly localStore: LocalLayerStore;
  readonly fs: FileSystem;
  readonly manifestDirFor: (name: string) => string;
  readonly commandShell?: ResolvedShell;
  readonly lock: Lock;
  readonly cliVersion: string;
  readonly providers: ProviderCatalog;
}

export interface ConfigImportInput {
  readonly text: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

type LayerAction = 'created' | 'updated' | 'unchanged';

export interface ConfigImportOutput {
  readonly config: 'changed' | 'unchanged';
  readonly workspaces: readonly { name: string; action: LayerAction }[];
  readonly registrations: readonly {
    name: string;
    root: string;
    source: string | null;
    action: 'created' | 'unchanged' | 'retained';
    preparation: 'manifest_missing' | 'sync_required' | 'unchanged';
  }[];
  readonly next_steps: readonly string[];
  readonly written: boolean;
}

export class ConfigImport {
  constructor(private readonly deps: ConfigImportDeps) {}

  async execute(input: ConfigImportInput): Promise<ConfigImportOutput> {
    const profile = parseProfile(input.text);
    const current = await this.deps.config.read();
    const plan = await this.plan(current, profile);
    if (input.dryRun || !changed(plan.output)) return plan.output;
    assertWritable(input.posture, 'profile import');
    const names = [
      ...new Set([
        ...Object.keys(profile.config.workspaces ?? {}),
        ...Object.keys(profile.workspaces),
      ]),
    ].sort();
    const leases: Lease[] = [];
    try {
      for (const name of names) {
        leases.push(await acquireWorkspaceOperation(this.deps.lock, name));
        await assertNoWorkspaceOperation(this.deps, {
          name,
          manifestDir: this.deps.manifestDirFor(name),
        });
      }
      const latest = await this.deps.config.read();
      assertImportIdentitiesUnchanged(current, latest, names, this.deps.commandShell);
      const locked = await this.plan(latest, profile);
      assertImportIdentitiesUnchanged(plan.merged, locked.merged, names, this.deps.commandShell);
      if (!changed(locked.output)) return locked.output;
      if (locked.output.config === 'changed')
        await this.deps.config.update(async (nextCurrent) => {
          assertImportIdentitiesUnchanged(latest, nextCurrent, names, this.deps.commandShell);
          return mergeProfileConfig(nextCurrent, profile.config, this.deps);
        });
      for (const [name, layer] of Object.entries(profile.workspaces)) {
        if (locked.output.workspaces.find((w) => w.name === name)?.action !== 'unchanged')
          await this.deps.localStore.write(name, layer);
      }
      return { ...locked.output, written: true };
    } finally {
      await Promise.all(leases.reverse().map((lease) => lease.release()));
    }
  }

  private async plan(
    current: ConfigFile,
    profile: Profile,
  ): Promise<{ merged: ConfigFile; output: ConfigImportOutput }> {
    const merged = await mergeProfileConfig(current, profile.config, this.deps);
    for (const name of Object.keys(profile.workspaces)) {
      if (merged.workspaces?.[name] === undefined)
        throw new DevkitError(
          'config',
          'CONFIG_IMPORT_WORKSPACE_UNKNOWN',
          `The profile contains a personal layer for unregistered workspace "${name}"`,
          {
            nextSteps: [
              'fx workspace list',
              'Include its workspace registration in the exported profile.',
            ],
          },
        );
    }
    const workspaces: { name: string; action: LayerAction }[] = [];
    for (const [name, layer] of Object.entries(profile.workspaces)) {
      await validateImportedLayer({
        fs: this.deps.fs,
        name,
        entry: merged.workspaces![name]!,
        manifestDir: this.deps.manifestDirFor(name),
        cliVersion: this.deps.cliVersion,
        providers: this.deps.providers,
        layer,
      });
      workspaces.push({ name, action: actionFor(await this.deps.localStore.read(name), layer) });
    }
    return {
      merged,
      output: {
        config: same(current, merged) ? 'unchanged' : 'changed',
        workspaces,
        ...(await this.planRegistrations({
          before: current,
          after: merged,
          layers: workspaces,
          imported: Object.keys(profile.config.workspaces ?? {}),
        })),
        written: false,
      },
    };
  }

  private async planRegistrations(input: {
    readonly before: ConfigFile;
    readonly after: ConfigFile;
    readonly layers: ConfigImportOutput['workspaces'];
    readonly imported: readonly string[];
  }): Promise<Pick<ConfigImportOutput, 'registrations' | 'next_steps'>> {
    const resourcesChanged =
      !same(input.before.agents, input.after.agents) || input.before.hooks !== input.after.hooks;
    const nextSteps: string[] = [];
    const registrations: ConfigImportOutput['registrations'][number][] = [];
    for (const [name, entry] of Object.entries(input.after.workspaces ?? {})) {
      const action = registrationAction(
        input.imported.includes(name),
        input.before.workspaces?.[name] !== undefined,
      );
      const present = await this.deps.fs.exists(
        path.join(this.deps.manifestDirFor(name), 'manifest', 'workspace.yaml'),
      );
      const changed =
        resourcesChanged || input.layers.some((w) => w.name === name && w.action !== 'unchanged');
      const preparation = preparationState(present, changed);
      registrations.push({
        name,
        root: entry.root,
        source: entry.source ?? null,
        action,
        preparation,
      });
      if (!present)
        nextSteps.push(
          shellLine(
            ['fx', 'init', entry.root, '--name', name, '--from', entry.source ?? '<source>'],
            this.deps.commandShell,
          ),
        );
      else if (changed)
        nextSteps.push(shellLine(['fx', 'sync', '--workspace', name], this.deps.commandShell));
    }
    return { registrations, next_steps: nextSteps };
  }
}

function changed(output: ConfigImportOutput): boolean {
  return output.config === 'changed' || output.workspaces.some((w) => w.action !== 'unchanged');
}

function registrationAction(
  imported: boolean,
  exists: boolean,
): 'created' | 'unchanged' | 'retained' {
  if (!imported) return 'retained';
  return exists ? 'unchanged' : 'created';
}

function preparationState(
  present: boolean,
  changed: boolean,
): 'manifest_missing' | 'sync_required' | 'unchanged' {
  if (!present) return 'manifest_missing';
  return changed ? 'sync_required' : 'unchanged';
}

function actionFor(existing: LocalLayer, next: LocalLayer): LayerAction {
  if (same(existing, next)) return 'unchanged';
  return Object.keys(existing).length === 0 ? 'created' : 'updated';
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
