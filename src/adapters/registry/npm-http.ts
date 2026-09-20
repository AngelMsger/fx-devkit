// Compatibility transport for an explicit FX_REGISTRY_TOKEN. Normal metadata
// reads delegate configuration and authentication to npm.

import { DevkitError } from '../../domain/errors.js';
import type { Registry } from '../../ports/registry.js';

import { privateRegistry } from './registry-policy.js';

export const TOKEN_ENV = 'FX_REGISTRY_TOKEN';

export interface NpmHttpOptions {
  readonly registry: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
  readonly userHome: string;
  readonly fetch?: typeof fetch;
}

export class NpmHttpRegistry implements Registry {
  constructor(private readonly options: NpmHttpOptions) {}

  async latest(packageName: string, signal?: AbortSignal): Promise<string> {
    const { registry, timeoutMs, env } = this.options;
    const token = privateRegistry(registry) ? env[TOKEN_ENV] : undefined;
    const url = `${registry.replace(/\/+$/, '')}/${packageName.replace('/', '%2F')}`;
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: {
        Accept: 'application/vnd.npm.install-v1+json',
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(signal === undefined ? [] : [signal]),
      ]),
    });
    if (!response.ok) {
      const category = response.status === 401 || response.status === 403 ? 'auth' : 'server';
      throw new DevkitError(
        category,
        'REGISTRY_HTTP_FAILED',
        `The configured registry responded ${response.status}`,
        { nextSteps: ['Check the configured registry and its npm token.', 'Retry later.'] },
      );
    }
    const body = (await response.json()) as { 'dist-tags'?: { latest?: string } };
    const latest = body['dist-tags']?.latest;
    if (latest === undefined || latest === '')
      throw new DevkitError(
        'parse',
        'REGISTRY_RESPONSE_INVALID',
        'Registry metadata has no dist-tags.latest',
        { nextSteps: ['Check the package metadata in the configured registry.'] },
      );
    return latest;
  }
}
