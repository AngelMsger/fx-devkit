import { describe, expect, it } from 'vitest';

import { providerCatalog, resolveProvider } from '../../../src/composition/registry.js';
import {
  bindPlatforms,
  bindProviders,
  codeHostBinding,
} from '../../../src/domain/manifest/providers.js';
import { serviceRules } from '../../../src/domain/manifest/rules/services.js';
import type { Ci } from '../../../src/ports/ci.js';
import type { CodeHost } from '../../../src/ports/code-host.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const deps = { process: new FakeProcess(), fs: new FakeFs(), clock: new FakeClock() };

describe('provider registry', () => {
  it('creates the bound provider with its variables', () => {
    const host = resolveProvider<CodeHost>(
      {
        capability: 'code-host',
        provider: 'local-git',
        source: 'explicit',
        vars: { host: '/srv/git' },
      },
      deps,
    );
    expect(host.upstreamUrl({ project: 'fx', name: 'a' })).toBe('/srv/git/fx/a.git');
  });

  it('labels subprocesses with the provider binding that caused them', async () => {
    const process = new FakeProcess().always({
      code: 0,
      stdout: '{"number":7,"status":"success"}',
      stderr: '',
    });
    const ci = resolveProvider<Ci>(
      {
        platform: 'builds',
        capability: 'ci',
        provider: 'jenkins-cli',
        source: 'explicit',
        vars: {},
      },
      { ...deps, process },
    );
    await ci.lastBuild({ path: 'team/job' }, { branch: 'main' });
    expect(process.soleCallTo(['jenkins-cli']).options.diagnostic).toEqual({
      phase: 'jenkins-cli build get',
      capability: 'ci',
      provider: 'jenkins-cli',
      binding: 'builds',
    });
  });

  it('refuses a binding the providers it registers cannot serve', () => {
    expect(() =>
      resolveProvider(
        { capability: 'code-host', provider: 'bitbucket-cil', source: 'explicit', vars: {} },
        deps,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PROVIDER_UNKNOWN',
        hint: expect.stringContaining('bitbucket-cli'),
      }),
    );
    expect(() =>
      resolveProvider(
        { capability: 'code-host', provider: 'bitbucket-cli', source: 'explicit', vars: {} },
        deps,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PROVIDER_VAR_MISSING',
        message: expect.stringContaining('host'),
      }),
    );
  });
});

describe('provider catalog', () => {
  it('stands in for what a schema 1 document leaves to its git host and platform names', () => {
    const providers = providerCatalog();
    expect(
      codeHostBinding(
        bindProviders(
          { schema_version: 1, defaults: { host: 'ssh://git@git.example.com' }, repos: [] },
          providers,
        ),
      ),
    ).toMatchObject({ provider: 'bitbucket-cli', source: 'default' });
    const platforms = { sentry: {}, openobserve: {}, jenkins: {}, kube: {}, prometheus: {} };
    expect(
      bindPlatforms({ schema_version: 1, platforms, envs: {} }, providers).map((binding) => [
        binding.platform,
        binding.provider,
        binding.capability,
      ]),
    ).toEqual([
      ['sentry', 'sentry', 'error-tracker'],
      ['openobserve', 'openobserve-cli', 'log-store'],
      ['jenkins', 'jenkins-cli', 'ci'],
      ['kube', 'kubectl', 'cluster'],
      ['prometheus', 'prometheus-cli', 'metrics'],
    ]);
  });

  it('hands the manifest rules each provider own service contract', () => {
    const service = {
      base_url: 'https://service.example.com',
      context: 'test',
      auth_scheme: 'none',
    } as const;
    const found = (provider: string): string[] =>
      serviceRules({
        providers: providerCatalog(),
        provider,
        service,
        vars: {},
        path: 'service',
      }).map((problem) => `${problem.path}: ${problem.message}`);
    expect(found('prometheus-cli')).toEqual([]);
    expect(found('jenkins-cli')).toEqual([
      'service.auth_scheme: authentication method is not supported by this provider',
    ]);
    expect(found('kubectl')).toEqual([
      'service: provider does not support shared service configuration',
    ]);
  });
});
