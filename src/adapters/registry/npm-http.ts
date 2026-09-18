// An npm-compatible registry over HTTP, read through the abbreviated
// metadata document. A private registry wants a token: FX_REGISTRY_TOKEN,
// else the `//host/:_authToken` line npm itself keeps in ~/.npmrc.

import { promises as fs } from 'node:fs';
import path from 'node:path';

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
    const { registry, timeoutMs, env, userHome } = this.options;
    const token =
      (privateRegistry(registry) ? env[TOKEN_ENV] : undefined) ||
      (await npmrcToken(registry, path.join(userHome, '.npmrc'), signal));
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

export async function npmrcToken(
  registry: string,
  npmrcPath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    if (!(await fs.stat(npmrcPath)).isFile()) return undefined;
    return npmrcTokenIn(await fs.readFile(npmrcPath, { encoding: 'utf8', signal }), registry);
  } catch {
    return undefined;
  }
}

// The line `//host/path/:_authToken=…` applies to the registry when the
// registry is that host or a path under it.
export function npmrcTokenIn(npmrc: string, registry: string): string | undefined {
  const host = registry.replace(/^https?:/, '').replace(/\/+$/, '');
  for (const line of npmrc.split(/\r?\n/)) {
    const match = /^(\/\/[^=]+?)\/?:_authToken=(.+)$/.exec(line.trim());
    if (match === null) continue;
    const scope = match[1] ?? '';
    if (host === scope || host.startsWith(`${scope}/`))
      return match[2]?.trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}
