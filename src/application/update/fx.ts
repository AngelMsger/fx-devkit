// Check release versions against the resolved package registry. Cache identities
// include both the installed package and its selected registry.

import { createHash } from 'node:crypto';

import { compareSemver, isRelease, parseSemver } from '../../domain/semver.js';
import type { Registry, RegistryLocation } from '../../ports/registry.js';

import type { CachedProbe } from './check.js';
import { FX_UPDATE_TTL_MS } from './policy.js';

export const FX_UPDATE_KEY = 'update/fx';

export interface FxUpdateInput {
  readonly current: string;
  readonly packageName: string;
  readonly registry: string | null;
  readonly registrySource?: RegistryLocation['source'];
  readonly force?: boolean;
}

export interface FxVerdict {
  readonly current: string;
  readonly latest: string | null;
  readonly behind: boolean;
  readonly registry: string | null;
  readonly source: 'cache' | 'live' | 'skipped';
  readonly error?: string;
}

export class FxUpdateCheck {
  constructor(
    private readonly probe: CachedProbe,
    private readonly registryAt: (url: string) => Registry,
  ) {}

  async execute(input: FxUpdateInput, signal?: AbortSignal): Promise<FxVerdict> {
    const skipped: FxVerdict = {
      current: input.current,
      latest: null,
      behind: false,
      registry: input.registry,
      source: 'skipped',
    };
    if (input.registry === null || !isRelease(input.current)) return skipped;
    const registry = this.registryAt(input.registry);
    const probed = await this.probe.run(
      fxUpdateKey(input),
      FX_UPDATE_TTL_MS,
      () => registry.latest(input.packageName, signal),
      { isValue: isVersion, force: input.force, signal },
    );
    return {
      ...skipped,
      latest: probed.value ?? null,
      behind: isBehind(input.current, probed.value),
      source: probed.source,
      ...(probed.error === undefined ? {} : { error: probed.error }),
    };
  }

  markCurrent(input: FxUpdateInput, version: string): Promise<void> {
    return this.probe.remember(fxUpdateKey(input), FX_UPDATE_TTL_MS, version);
  }
}

function isBehind(current: string, latest: string | undefined): boolean {
  const a = parseSemver(current);
  const b = latest === undefined ? undefined : parseSemver(latest);
  return a !== undefined && b !== undefined && isRelease(latest ?? '') && compareSemver(a, b) < 0;
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && parseSemver(value) !== undefined;
}

export function fxUpdateKey(input: Pick<FxUpdateInput, 'packageName' | 'registry'>): string {
  return `${FX_UPDATE_KEY}/${createHash('sha256')
    .update(JSON.stringify([input.packageName, input.registry]))
    .digest('hex')}`;
}
