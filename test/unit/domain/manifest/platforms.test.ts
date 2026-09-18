import { describe, expect, it } from 'vitest';

import { providerCatalog } from '../../../../src/composition/registry.js';
import { lintManifest } from '../../../../src/domain/manifest/lint.js';
import { bindPlatforms } from '../../../../src/domain/manifest/providers.js';
import type { Environments, Workspace } from '../../../../src/domain/manifest/types.js';

const ws: Workspace = { schema_version: 2, providers: {}, defaults: {}, repos: [{ name: 'a' }] };

describe('bindPlatforms', () => {
  it('binds a schema 1 platform by its name, and says so', () => {
    const env: Environments = {
      schema_version: 1,
      platforms: {
        sentry: { vars: { host: 'sentry.example.com', org: 'fx' } },
        kube: {},
        grafana: {},
      },
      envs: { test: {} },
    };
    expect(bindPlatforms(env, providerCatalog())).toEqual([
      {
        platform: 'sentry',
        capability: 'error-tracker',
        provider: 'sentry',
        source: 'default',
        vars: { host: 'sentry.example.com', org: 'fx' },
      },
      { platform: 'kube', capability: 'cluster', provider: 'kubectl', source: 'default', vars: {} },
      { platform: 'grafana', capability: 'unknown', provider: null, source: 'unbound', vars: {} },
    ]);
    expect(
      lintManifest({ providers: providerCatalog(), workspace: ws, environments: env }).map((f) => [
        f.code,
        f.path,
      ]),
    ).toEqual([
      ['PLATFORM_PROVIDER_IMPLIED', 'platforms.sentry'],
      ['PLATFORM_PROVIDER_IMPLIED', 'platforms.kube'],
      ['PLATFORM_UNBOUND', 'platforms.grafana'],
      ['ENV_NO_LABEL', 'envs.test'],
    ]);
  });

  it('prefers an explicit provider, even under a family name', () => {
    const env: Environments = {
      schema_version: 2,
      platforms: { sentry: { provider: 'glitchtip-cli', capability: 'error-tracker' } },
      envs: { test: { label: 'Test' } },
    };
    expect(bindPlatforms(env, providerCatalog())).toEqual([
      {
        platform: 'sentry',
        capability: 'error-tracker',
        provider: 'glitchtip-cli',
        source: 'explicit',
        vars: {},
      },
    ]);
    expect(
      lintManifest({ providers: providerCatalog(), workspace: ws, environments: env }),
    ).toEqual([]);
    expect(bindPlatforms(undefined, providerCatalog())).toEqual([]);
  });
});
