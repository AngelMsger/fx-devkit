// npm owns authentication, userconfig expansion and metadata transport. The
// explicit legacy token still uses its existing HTTP path without exposing it to argv.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import type { Process } from '../../ports/process.js';
import type { Registry } from '../../ports/registry.js';

import { NpmHttpRegistry, TOKEN_ENV, type NpmHttpOptions } from './npm-http.js';
import { privateRegistry, registryArguments } from './registry-policy.js';

export class NpmRegistry implements Registry {
  constructor(
    private readonly process: Pick<Process, 'run'>,
    private readonly options: NpmHttpOptions,
  ) {}

  async latest(packageName: string, signal?: AbortSignal): Promise<string> {
    const { registry, env } = this.options;
    const legacyTarget = privateRegistry(env.FX_REGISTRY);
    if (
      env[TOKEN_ENV] &&
      legacyTarget !== null &&
      legacyTarget.replace(/\/+$/, '') === privateRegistry(registry)?.replace(/\/+$/, '')
    )
      return new NpmHttpRegistry(this.options).latest(packageName, signal);
    // npm may serve stale metadata on upstream failures. fx owns the persistent
    // probe cache, so a live check must start without npm's previous response.
    const cache = await mkdtemp(path.join(os.tmpdir(), 'fx-registry-'));
    try {
      return await this.query(packageName, cache, signal);
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  }

  private async query(packageName: string, cache: string, signal?: AbortSignal): Promise<string> {
    const { registry, env, userHome, timeoutMs } = this.options;
    const result = await this.process
      .run(
        [
          'npm',
          'view',
          packageName,
          'dist-tags.latest',
          '--json',
          '--global',
          '--cache',
          cache,
          ...registryArguments({ packageName, registry }),
          '--prefer-online',
          '--update-notifier=false',
          '--fetch-retries=0',
        ],
        {
          cwd: userHome,
          env,
          timeoutMs,
          signal,
          sensitiveOutput: true,
          diagnostic: { phase: 'npm package metadata' },
        },
      )
      .catch(() => {
        throw queryFailed();
      });
    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      value = undefined;
    }
    if (result.code !== 0) {
      const code = (value as { error?: { code?: string } } | undefined)?.error?.code;
      throw queryFailed(code === 'E401' || code === 'E403' || code === 'EOTP');
    }
    if (typeof value !== 'string' || !value.trim())
      throw new DevkitError(
        'parse',
        'REGISTRY_RESPONSE_INVALID',
        'Registry metadata has no dist-tags.latest',
        {
          nextSteps: ['Check the package metadata in the configured registry.'],
        },
      );
    return value;
  }
}

function queryFailed(auth = false): DevkitError {
  return new DevkitError(
    auth ? 'auth' : 'server',
    'REGISTRY_HTTP_FAILED',
    auth
      ? 'npm authentication was rejected by the package registry'
      : 'npm could not query the package registry',
    {
      nextSteps: [
        auth
          ? 'Check npm authentication for the selected registry, then retry.'
          : 'Check npm availability, registry configuration and connectivity, then retry.',
      ],
    },
  );
}
