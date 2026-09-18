import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BITBUCKET_RECIPES } from '../../../src/adapters/code-host/bitbucket-cli/recipes.js';
import { localGitProvider } from '../../../src/adapters/code-host/local-git/provider.js';
import { TemplatePlatform } from '../../../src/adapters/platform/template-platform.js';
import { Can } from '../../../src/application/can.js';
import { Readiness } from '../../../src/application/readiness/index.js';
import { Gates } from '../../../src/application/release/gates.js';
import type { LocalLayer } from '../../../src/domain/manifest/types.js';
import type { SetupRecipe } from '../../../src/domain/setup/types.js';
import type { ProviderDescriptor } from '../../../src/ports/provider.js';
import { fakeLoginDeps } from '../../fakes/fake-login-deps.js';
import { MANIFEST_DIR, harness } from '../../fakes/workspace.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape', name), 'utf8');

const login: SetupRecipe = {
  id: 'login',
  tool: 'jenkins-cli',
  perEnv: false,
  kind: 'run',
  title: 'Log in to Jenkins',
  run: ['auth', 'login'],
  verify: { command: ['auth', 'status'] },
};
const jenkins = new TemplatePlatform({
  id: 'jenkins-cli',
  capability: 'ci',
  label: 'job {path}',
  command: ['jenkins-cli', 'build', 'list', '{path}'],
});
const DESCRIPTORS: Record<string, ProviderDescriptor<unknown>> = {
  'openobserve-cli': {
    id: 'openobserve-cli',
    capability: 'log-store',
    tools: ['openobserve-cli'],
    recipes: [],
    vars: [],
    create: () => ({}),
  },
  'jenkins-cli': {
    id: 'jenkins-cli',
    capability: 'ci',
    tools: ['jenkins-cli'],
    recipes: [login],
    vars: [],
    create: () => jenkins,
  },
  'bitbucket-cli': {
    id: 'bitbucket-cli',
    capability: 'code-host',
    tools: ['bitbucket-cli'],
    recipes: [],
    vars: [],
    create: () => ({}),
  },
};

async function stage(options: { local?: LocalLayer; tools?: string; yes?: boolean } = {}) {
  const h = await harness({
    workspace: fixture('workspace.yaml'),
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: fixture('environments.yaml'),
      [`${MANIFEST_DIR}/manifest/tools.yaml`]: options.tools ?? fixture('tools.yaml'),
    },
    local: options.local ?? {},
    platforms: { 'jenkins-cli': jenkins },
  });
  h.process.when((v) => v[1] === '--version', { code: 0, stdout: 'jenkins-cli 9.0.0', stderr: '' });
  return {
    h,
    can: new Can(
      h.deps,
      fakeLoginDeps(DESCRIPTORS, options.yes === undefined ? {} : { yes: options.yes }),
    ),
  };
}

describe('Can', () => {
  it.each([false, true])(
    'requires configured=true in Bitbucket auth status (%s)',
    async (configured) => {
      const { h } = await stage();
      h.process.binaries.add('bitbucket-cli');
      h.process.when((v) => v.includes('status'), {
        code: 0,
        stdout: JSON.stringify({ configured }),
        stderr: '',
      });
      const can = new Can(
        h.deps,
        fakeLoginDeps({
          ...DESCRIPTORS,
          'bitbucket-cli': { ...DESCRIPTORS['bitbucket-cli']!, recipes: BITBUCKET_RECIPES },
        }),
      );
      expect(await can.execute({ target: 'code-host' })).toMatchObject({
        status: configured ? 'ready' : 'unconfigured',
      });
    },
  );
  it.each([
    ['enabled: false', 'disabled_tool'],
    ['min_version: 99.0.0', 'outdated_tool'],
  ])('preserves tool state %s', async (declaration, status) => {
    const s = await stage({
      tools: `schema_version: 2\ntools: [{ name: bitbucket-cli, ${declaration} }]`,
    });
    s.h.process.binaries.add('bitbucket-cli');
    expect(await s.can.execute({ target: 'code-host' })).toMatchObject({ status });
  });
  it('shares readiness with release for a bound provider without a companion tool', async () => {
    const { h } = await stage();
    const binding = {
      capability: 'code-host',
      provider: 'local-git',
      source: 'explicit',
      vars: { host: path.resolve('/host') },
    } as const;
    const deps = {
      ...h.deps,
      ctx: {
        ...h.deps.ctx,
        manifestDir: h.deps.ctx.manifestDir,
        bindings: [binding],
      },
    };
    const loginDeps = fakeLoginDeps({ 'local-git': localGitProvider });
    expect(await new Can(deps, loginDeps).execute({ target: 'code-host' })).toMatchObject({
      status: 'ready',
      tool: null,
      provider: 'local-git',
      handoff: null,
    });
    expect(await new Gates(deps, loginDeps).through('code-host', undefined)).toEqual({
      open: true,
    });
    expect(h.process.calls).toEqual([]);
    const unbound = { ...deps, ctx: { ...deps.ctx, bindings: [{ ...binding, provider: null }] } };
    await expect(
      new Can(unbound, loginDeps).execute({ target: 'code-host' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNBOUND' });
    expect(await new Gates(unbound, loginDeps).through('code-host', undefined)).toMatchObject({
      open: false,
    });
  });

  it('separates an unbound capability from a provider whose tool no document declares', async () => {
    const acme: ProviderDescriptor<unknown> = {
      id: 'acme-host',
      capability: 'code-host',
      tools: ['acme-cli'],
      recipes: [],
      vars: [],
      create: () => ({}),
    };
    const bound = async (provider: string | null, tools?: string) => {
      const { h } = await stage(tools === undefined ? {} : { tools });
      return new Can(
        {
          ...h.deps,
          ctx: {
            ...h.deps.ctx,
            manifestDir: h.deps.ctx.manifestDir,
            bindings: [{ capability: 'code-host', provider, source: 'explicit', vars: {} }],
          },
        },
        fakeLoginDeps({ ...DESCRIPTORS, 'acme-host': acme }),
      ).execute({ target: 'code-host' });
    };
    await expect(bound('acme-host')).rejects.toMatchObject({
      category: 'config',
      code: 'TOOL_UNDECLARED',
      message: 'acme-cli is not declared in the toolchain',
      nextSteps: [
        'Declare acme-cli in the manifest tools document.',
        'fx manifest schema --kind tools --workspace fx',
        'fx tool list --workspace fx',
      ],
    });
    await expect(bound(null)).rejects.toMatchObject({ code: 'CAPABILITY_UNBOUND' });
    expect(
      await bound('acme-host', 'schema_version: 2\ntools: [{ name: acme-cli }]'),
    ).toMatchObject({ status: 'missing_tool', tool: 'acme-cli', provider: 'acme-host' });
  });

  it('does not require an environment document for workspace bindings or standalone tools', async () => {
    const { h } = await stage();
    const readiness = new Readiness(
      {
        ...h.deps,
        ctx: {
          ...h.deps.ctx,
          manifestDir: h.deps.ctx.manifestDir,
          manifest: { ...h.deps.ctx.manifest, environments: undefined },
          platforms: [],
        },
      },
      fakeLoginDeps(DESCRIPTORS),
    );
    const capability = readiness.resolve('code-host', 'test');
    const tool = readiness.resolve('bitbucket-cli', 'test');
    expect(tool.binding).toEqual(capability.binding);
    expect(tool.tool).toEqual(capability.tool);
    const standalone = readiness.resolve('jenkins-cli', 'test');
    expect(standalone.binding).toBeNull();
    h.process.binaries.add('bitbucket-cli');
    h.process.binaries.add('jenkins-cli');
    for (const target of [capability, tool, standalone])
      expect(await readiness.judge(target, 'test')).toMatchObject({ status: 'ready' });
  });

  it('resolves tool and capability through the environment before considering declaration order', async () => {
    const { h } = await stage();
    const binding = h.deps.ctx.platforms.find((b) => b.platform === 'jenkins')!;
    const readiness = new Readiness(
      {
        ...h.deps,
        ctx: {
          ...h.deps.ctx,
          manifestDir: h.deps.ctx.manifestDir,
          platforms: [{ ...binding, platform: 'other-ci' }, binding],
        },
      },
      fakeLoginDeps(DESCRIPTORS),
    );
    expect(readiness.resolve('jenkins-cli', 'prod').binding).toEqual(binding);
    expect(readiness.resolve('ci', 'prod').binding).toEqual(binding);
    expect(() => readiness.resolve('jenkins-cli', 'typo')).toThrowError(
      expect.objectContaining({ code: 'ENV_NOT_FOUND' }),
    );
    expect(() => readiness.resolve('jenkins-cli', undefined)).toThrowError(
      expect.objectContaining({ code: 'CAN_AMBIGUOUS' }),
    );
  });

  it('rejects multiple covered bindings rather than selecting the first provider', async () => {
    const { h } = await stage();
    const binding = h.deps.ctx.platforms.find((b) => b.platform === 'jenkins')!;
    const readiness = new Readiness(
      {
        ...h.deps,
        ctx: {
          ...h.deps.ctx,
          manifestDir: h.deps.ctx.manifestDir,
          platforms: [binding, { ...binding, platform: 'sentry' }],
        },
      },
      fakeLoginDeps(DESCRIPTORS),
    );
    for (const name of ['ci', 'jenkins-cli']) {
      expect(() => readiness.resolve(name, 'prod')).toThrowError(
        expect.objectContaining({ code: 'CAN_AMBIGUOUS' }),
      );
    }
  });

  it('does not let another tool incomplete recipe block a selected capability', async () => {
    const s = await stage();
    s.h.process.binaries.add('jenkins-cli');
    s.h.process.on(['jenkins-cli', 'auth', 'status'], { code: 0, stdout: '', stderr: '' });
    const descriptors = {
      ...DESCRIPTORS,
      'bitbucket-cli': {
        ...DESCRIPTORS['bitbucket-cli']!,
        recipes: [{ ...login, tool: 'bitbucket-cli', verify: { command: ['auth', '{missing}'] } }],
      },
    };
    expect(
      (await new Can(s.h.deps, fakeLoginDeps(descriptors)).execute({ target: 'ci', env: 'dev' }))
        .status,
    ).toBe('ready');
  });

  it('does not call an incomplete setup plan ready when expansion produced no steps', async () => {
    const s = await stage();
    s.h.process.binaries.add('jenkins-cli');
    const descriptors = {
      ...DESCRIPTORS,
      'jenkins-cli': {
        ...DESCRIPTORS['jenkins-cli']!,
        recipes: [{ ...login, verify: { command: ['auth', 'status', '{missing_context}'] } }],
      },
    };
    const can = new Can(s.h.deps, fakeLoginDeps(descriptors));
    expect(await can.execute({ target: 'ci', env: 'dev' })).toMatchObject({
      status: 'unconfigured',
      handoff: { command: 'fx manifest providers --workspace fx' },
    });
    expect(s.h.process.calls.some((call) => call.vector.includes('{missing_context}'))).toBe(false);
  });

  it('walks coverage, access, tool and configuration in that order, and ends ready', async () => {
    const s = await stage();
    const uncovered = await s.can.execute({ target: 'log-store', env: 'selfhosted' });
    expect(uncovered).toMatchObject({
      status: 'not_covered',
      capability: 'log-store',
      provider: 'openobserve-cli',
      alternatives: ['no central log store', 'fx doctor --workspace fx'],
    });

    const locked = await stage({ local: { scope: { envs: ['prod'] } } });
    expect(await locked.can.execute({ target: 'ci', env: 'dev' })).toMatchObject({
      status: 'no_access',
      alternatives: ['fx env pick dev --workspace fx', 'fx doctor --workspace fx'],
    });

    expect(await s.can.execute({ target: 'ci', env: 'dev' })).toMatchObject({
      status: 'missing_tool',
      tool: 'jenkins-cli',
      handoff: { command: 'fx tool install jenkins-cli --workspace fx', user_steps: [] },
    });

    s.h.process.binaries.add('jenkins-cli');
    s.h.process.on(['jenkins-cli', 'auth', 'status'], {
      code: 1,
      stdout: '',
      stderr: 'no credential',
    });
    expect(await s.can.execute({ target: 'ci', env: 'dev' })).toMatchObject({
      status: 'unconfigured',
      handoff: {
        command: 'fx login jenkins-cli --workspace fx',
        user_steps: [{ id: 'jenkins-cli.login', command: ['jenkins-cli', 'auth', 'login'] }],
      },
    });

    s.h.process
      .clear()
      .when((v) => v[1] === '--version', { code: 0, stdout: 'jenkins-cli 9.0.0', stderr: '' })
      .on(['jenkins-cli', 'auth', 'status'], { code: 0, stdout: '', stderr: '' });
    expect(await s.can.execute({ target: 'ci', env: 'dev' })).toEqual({
      capability: 'ci',
      tool: 'jenkins-cli',
      provider: 'jenkins-cli',
      env: 'dev',
      status: 'ready',
      handoff: null,
      alternatives: ['fx doctor --workspace fx'],
    });
    expect(s.h.localStore.writes).toEqual([]);
  });

  it('answers unknown when the tool cannot be probed or a patch check is untrusted', async () => {
    const patched = [
      'schema_version: 2',
      'tools:',
      '  - { name: jenkins-cli, version_args: [--ver] }',
      '',
    ].join('\n');
    const s = await stage({ tools: patched });
    s.h.process.binaries.add('jenkins-cli');
    expect(await s.can.execute({ target: 'ci', env: 'dev' })).toMatchObject({
      status: 'unknown',
      handoff: {
        command: 'fx doctor --tool jenkins-cli --workspace fx',
        user_steps: [expect.objectContaining({ kind: 'manual' })],
      },
      alternatives: ['fx tool show jenkins-cli --workspace fx', 'fx doctor --workspace fx'],
    });

    const s2 = await stage();
    s2.h.process.binaries.add('jenkins-cli');
    s2.h.process.clear().when((v) => v[1] === '--version', { code: 1, stdout: '', stderr: 'boom' });
    expect(await s2.can.execute({ target: 'jenkins-cli' })).toMatchObject({
      status: 'unknown',
      handoff: {
        command: 'fx doctor --tool jenkins-cli --workspace fx',
        user_steps: [
          {
            kind: 'manual',
            instructions: expect.stringContaining('jenkins-cli --version'),
          },
        ],
      },
      alternatives: ['fx tool show jenkins-cli --workspace fx', 'fx doctor --workspace fx'],
    });
  });

  it('accepts a tool name, and refuses what it cannot resolve with a suggestion', async () => {
    const s = await stage();
    s.h.process.binaries.add('bitbucket-cli');
    s.h.process.on(['bitbucket-cli', '--version'], {
      code: 0,
      stdout: 'bitbucket-cli 9.0.0',
      stderr: '',
    });
    expect(await s.can.execute({ target: 'bitbucket-cli' })).toMatchObject({
      status: 'ready',
      capability: null,
      provider: 'bitbucket-cli',
      env: null,
    });
    await expect(s.can.execute({ target: 'ci' })).rejects.toMatchObject({
      code: 'ENV_REQUIRED',
      nextSteps: ['fx env list --workspace fx', "fx can ci --env '<env>' --workspace fx"],
    });
    await expect(s.can.execute({ target: 'log-stor', env: 'dev' })).rejects.toMatchObject({
      code: 'CAN_UNKNOWN',
      hint: 'Did you mean "log-store"?',
    });
    await expect(s.can.execute({ target: 'im' })).rejects.toMatchObject({
      code: 'CAPABILITY_UNBOUND',
    });
  });

  it('requires a standalone tool auth check to pass before calling it ready', async () => {
    const s = await stage({
      yes: true,
      tools: [
        'schema_version: 2',
        'tools: [{ name: standalone, auth: { command: [auth, status] } }]',
      ].join('\n'),
    });
    s.h.process.binaries.add('standalone');
    s.h.process
      .on(['standalone', '--version'], { code: 0, stdout: 'standalone 1.0.0', stderr: '' })
      .on(['standalone', 'auth', 'status'], { code: 1, stdout: '', stderr: 'not logged in' });

    expect(await s.can.execute({ target: 'standalone' })).toMatchObject({
      status: 'unconfigured',
      handoff: { user_steps: [{ id: 'standalone.auth', kind: 'manual' }] },
    });

    s.h.process.clear().on(['standalone', '--version'], {
      code: 0,
      stdout: 'standalone 1.0.0',
      stderr: '',
    });
    s.h.process.on(['standalone', 'auth', 'status'], { code: 0, stdout: '', stderr: '' });
    expect(await s.can.execute({ target: 'standalone' })).toMatchObject({ status: 'ready' });
  });
});
