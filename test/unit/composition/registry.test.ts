import { describe, expect, it } from 'vitest';

import { providersFor, resolveProvider } from '../../../src/composition/registry.js';
import type { Ci } from '../../../src/ports/ci.js';
import type { CodeHost } from '../../../src/ports/code-host.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const deps = { process: new FakeProcess(), fs: new FakeFs(), clock: new FakeClock() };

describe('provider registry', () => {
  it('knows two code hosts', () => {
    expect(providersFor('code-host').map((p) => p.id)).toEqual(['bitbucket-cli', 'local-git']);
  });

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
    await ci.lastBuild({ path: 'team/job' });
    expect(process.calls[0]?.options.diagnostic).toEqual({
      phase: 'jenkins-cli build get',
      capability: 'ci',
      provider: 'jenkins-cli',
      binding: 'builds',
    });
  });

  it('rejects an unknown provider id with a suggestion', () => {
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
  });

  it('rejects a provider bound to the wrong capability', () => {
    expect(() =>
      resolveProvider(
        { capability: 'im', provider: 'local-git', source: 'explicit', vars: {} },
        deps,
      ),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_UNKNOWN' }));
  });

  it('names the missing required variable', () => {
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

  it('explains an unbound capability', () => {
    expect(() =>
      resolveProvider({ capability: 'im', provider: null, source: 'unbound', vars: {} }, deps),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_UNBOUND' }));
  });
});
