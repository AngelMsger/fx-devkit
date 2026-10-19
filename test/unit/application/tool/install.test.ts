import { describe, expect, it } from 'vitest';

import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { ToolInstall } from '../../../../src/application/tool/install.js';
import { ToolShow } from '../../../../src/application/tool/show.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { loadTools } from '../../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';
import { FakeInstaller } from '../../../fakes/fake-installer.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { fakeToolAudit } from '../../../fakes/fake-tool-history.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

const bundled = [
  'schema_version: 3',
  'defaults: { version_args: [--version], install: [{ via: npm }], npm_scope: "@example" }',
  'tools:',
  '  - name: alpha',
  '    required: true',
  '    install:',
  '      - { via: brew, spec: alpha-formula }',
  '      - { via: npm, spec: "@example/alpha", registry: https://npm.example.com/ }',
  '  - name: beta',
  '  - name: byhand',
  '    docs: https://docs.example.com/byhand',
  '    install: [{ via: manual }]',
  '  - name: retired',
  '    enabled: false',
].join('\n');

const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };

function setup(patch?: string, available: string[] = ['npm', 'brew', 'go']) {
  const loaded = loadTools(bundled, patch, { cliVersion: '1.0.0' });
  const tools = resolveTools(loaded.doc, loaded.provenance);
  const installers = FakeInstaller.family(available);
  const proc = new FakeProcess().always({ code: 0, stdout: 'alpha v9.9.9\n', stderr: '' });
  return {
    tools,
    installers,
    proc,
    install: new ToolInstall({ installers, process: proc, audit: fakeToolAudit() }),
  };
}

const cancelled = new DevkitError('internal', 'PROCESS_ABORTED', 'interrupted');
const defect = new TypeError('broken');
// Where the second of three installations is interrupted: its package manager never
// answers, so its row holds no exit code, or that succeeded and the version check throws.
const installing = { phase: 'install', at: ['npm', 'install', '-g', 'beta@latest'], exit: null };
const versioning = { phase: 'version', at: ['beta'], exit: 0 };

describe('ToolInstall', () => {
  it.each([false, true])(
    'keeps installer recovery on scoped definitions during update=%s and leaves standalone guidance global',
    async (update) => {
      const s = setup(undefined, []);
      const base = {
        tools: s.tools,
        names: ['alpha'],
        update,
        dryRun: true,
        posture: writable,
        commandShell: 'powershell' as const,
      };
      await expect(
        s.install.execute({
          ...base,
          trust: {
            gate: new TrustGate(new FakeTrustStore(), new FakePrompter()),
            workspace: 'selected',
            yes: false,
            posture: writable,
          },
        }),
      ).rejects.toMatchObject({
        code: 'INSTALLER_UNAVAILABLE',
        nextSteps: ["& 'fx' 'tool' 'show' 'alpha' '--workspace' 'selected'"],
      });
      await expect(s.install.execute(base)).rejects.toMatchObject({
        code: 'INSTALLER_UNAVAILABLE',
        nextSteps: ["& 'fx' 'tool' 'show' 'alpha'"],
      });
      expect(s.proc.calls).toEqual([]);
    },
  );

  it.each([
    { ...installing, thrown: 'a cancellation', error: cancelled, code: 'PROCESS_ABORTED' },
    { ...installing, thrown: 'a defect', error: defect, code: 'INTERNAL' },
    { ...versioning, thrown: 'a cancellation', error: cancelled, code: 'PROCESS_ABORTED' },
    { ...versioning, thrown: 'a defect', error: defect, code: 'INTERNAL' },
  ])(
    'keeps partial results and stops when $phase throws $thrown',
    async ({ phase, at, exit, error, code }) => {
      const s = setup(undefined, ['npm']);
      const tools = ['alpha', 'beta', 'gamma'].map((name) => ({
        ...s.tools.find((t) => t.name === 'beta')!,
        name,
        binary: name,
        install: [{ via: 'npm' as const, spec: name }],
      }));
      s.proc.clear().on(at, error).always({ code: 0, stdout: '1.2.3', stderr: '' });
      await expect(
        s.install.execute({
          tools,
          names: ['alpha', 'beta', 'gamma'],
          update: false,
          dryRun: false,
          posture: writable,
        }),
      ).rejects.toMatchObject({
        code,
        category: 'internal',
        partialResult: {
          tool_install: [
            { name: 'alpha', status: 'done', ran: true, code: 0, version_after: '1.2.3' },
            {
              name: 'beta',
              status: 'failed',
              ran: true,
              code: exit,
              phase,
              failure: { code },
            },
            { name: 'gamma', status: 'not_started', ran: false, code: null },
          ],
        },
      });
      expect(
        s.proc.calls.some((call) => call.vector.some((word) => word.startsWith('gamma'))),
      ).toBe(false);
    },
  );

  it('keeps installation success separate from a failed, bounded version check', async () => {
    const s = setup(undefined, ['npm']);
    s.proc
      .clear()
      .on(['npm'], { code: 0, stdout: 'installed', stderr: '' })
      .on(['alpha', '--version'], { code: 1, stdout: 'alpha 9.9.9', stderr: 'startup failed' });
    const [result] = await s.install.execute({
      tools: s.tools,
      names: ['alpha'],
      update: false,
      dryRun: false,
      posture: writable,
    });
    expect(result).toMatchObject({ ran: true, code: 0, version_after: null });
    expect(s.proc.soleCallTo(['npm']).options.timeoutMs).toBeUndefined();
    expect(s.proc.soleCallTo(['alpha', '--version']).options.timeoutMs).toBe(5000);
  });

  it('uses the first available installer and puts the registry in the vector', async () => {
    const s = setup(undefined, ['npm']);
    const result = await s.install.execute({
      tools: s.tools,
      names: ['alpha'],
      update: false,
      dryRun: false,
      posture: writable,
    });
    expect(result[0]).toMatchObject({
      name: 'alpha',
      via: 'npm',
      vector: [
        'npm',
        'install',
        '-g',
        '@example/alpha@latest',
        '--registry',
        'https://npm.example.com/',
        '--@example:registry=https://npm.example.com/',
      ],
      ran: true,
      code: 0,
      version_after: '9.9.9',
    });
    expect(s.proc.soleCallTo(['npm']).vector).toEqual([
      'npm',
      'install',
      '-g',
      '@example/alpha@latest',
      '--registry',
      'https://npm.example.com/',
      '--@example:registry=https://npm.example.com/',
    ]);
  });

  it('prefers the method listed first when it is available', async () => {
    const s = setup();
    const result = await s.install.execute({
      tools: s.tools,
      names: ['alpha'],
      update: false,
      dryRun: false,
      posture: writable,
    });
    expect(result[0]).toMatchObject({ via: 'brew', vector: ['brew', 'install', 'alpha-formula'] });
  });

  it('names the package manager it would need when none is available', async () => {
    const s = setup(undefined, []);
    await expect(
      s.install.execute({
        tools: s.tools,
        names: ['beta'],
        update: false,
        dryRun: false,
        posture: writable,
      }),
    ).rejects.toMatchObject({
      category: 'config',
      code: 'INSTALLER_UNAVAILABLE',
      message: expect.stringContaining('npm'),
    });
  });

  it('finishes planning every selected tool before the first installer runs', async () => {
    const s = setup(undefined, ['brew']);
    await expect(
      s.install.execute({
        tools: s.tools,
        names: ['alpha', 'beta'],
        update: false,
        dryRun: false,
        posture: writable,
      }),
    ).rejects.toMatchObject({ code: 'INSTALLER_UNAVAILABLE' });
    expect(s.proc.calls).toEqual([]);
  });

  it('describes a manual tool instead of running anything', async () => {
    const s = setup();
    const result = await s.install.execute({
      tools: s.tools,
      names: ['byhand'],
      update: false,
      dryRun: false,
      posture: writable,
    });
    expect(result[0]).toMatchObject({
      via: 'manual',
      vector: null,
      ran: false,
      docs: 'https://docs.example.com/byhand',
    });
    expect(s.proc.calls).toEqual([]);
  });

  it('runs nothing under dry-run and refuses under read-only posture', async () => {
    const s = setup();
    const preview = await s.install.execute({
      tools: s.tools,
      names: ['alpha'],
      update: false,
      dryRun: true,
      posture: locked,
    });
    expect(preview[0]).toMatchObject({ ran: false, vector: ['brew', 'install', 'alpha-formula'] });
    expect(s.proc.calls).toEqual([]);
    await expect(
      s.install.execute({
        tools: s.tools,
        names: ['alpha'],
        update: false,
        dryRun: false,
        posture: locked,
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
  });

  it('builds upgrade vectors for update', async () => {
    const s = setup();
    const result = await s.install.execute({
      tools: s.tools,
      names: ['alpha'],
      update: true,
      dryRun: true,
      posture: writable,
    });
    expect(result[0]?.vector).toEqual(['brew', 'upgrade', 'alpha-formula']);
  });

  it('with --all installs only enabled tools whose binary is missing; outdated ones are tool update business', async () => {
    const s = setup();
    s.proc.binaries.add('alpha');
    const result = await s.install.execute({
      tools: s.tools,
      all: true,
      update: false,
      dryRun: true,
      posture: writable,
    });
    expect(result.map((r) => r.name)).toEqual(['beta', 'byhand']);
  });

  it('reports a failed installer run with its own words and runs no success probe', async () => {
    const s = setup(undefined, ['npm']);
    const error = 'E404 package unavailable';
    s.proc.clear().always({ code: 1, stdout: '', stderr: error });
    const result = await s.install.execute({
      tools: s.tools,
      names: ['beta'],
      update: false,
      dryRun: false,
      posture: writable,
    });
    expect(result[0]).toMatchObject({ ran: true, code: 1, error, version_after: null });
    expect(s.proc.calledWith(['beta', '--version']), 'no success probe after a failure').toBe(
      false,
    );
  });
});

describe('ToolShow', () => {
  it('shows the resolved entry, field origins, dependants and setup steps', () => {
    const s = setup(
      'schema_version: 3\ntools: [{ name: alpha, min_version: 2.0.0, setup: [{ id: token, kind: manual, title: t, verify: { command: [auth, status] } }] }]',
    );
    const explained = new ToolShow().execute({
      tools: s.tools,
      name: 'alpha',
      sources: new Map([['alpha', { kind: 'manifest', boundBy: [] }]]),
      dependants: { alpha: ['bitbucket-cli'] },
    });
    expect(explained).toMatchObject({
      name: 'alpha',
      min_version: '2.0.0',
      install: [
        { via: 'brew', spec: 'alpha-formula' },
        { via: 'npm', spec: '@example/alpha' },
      ],
      fields: expect.objectContaining({ min_version: 'patch', install: 'base', setup: 'patch' }),
      depended_on_by: ['bitbucket-cli'],
      source: 'manifest',
      setup_steps: [{ id: 'token', kind: 'manual', title: 't' }],
    });
    expect(() =>
      new ToolShow().execute({
        tools: s.tools,
        name: 'alfa',
        sources: new Map(),
        dependants: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'TOOL_UNKNOWN' }));
  });
});

describe('ToolInstall with a trust gate', () => {
  // The team patch replaced how alpha reports its version, so that check alone needs trust.
  function patchedVersionCheck() {
    const loaded = loadTools(
      [
        'schema_version: 3',
        'defaults: { version_args: [--version], install: [{ via: npm }] }',
        'tools: [{ name: alpha }]',
      ].join('\n'),
      'schema_version: 3\ntools: [{ name: alpha, version_args: [--ver] }]',
      { cliVersion: '1.0.0' },
    );
    const process = new FakeProcess().always({ code: 0, stdout: 'alpha 1.2.3', stderr: '' });
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const gate = new TrustGate(new FakeTrustStore(), prompter);
    const install = (trust: { yes: boolean }) =>
      new ToolInstall({
        installers: FakeInstaller.family(['npm']),
        process,
        audit: fakeToolAudit(),
      }).execute({
        tools: resolveTools(loaded.doc, loaded.provenance),
        names: ['alpha'],
        update: false,
        dryRun: false,
        posture: writable,
        trust: { gate, workspace: 'fx', yes: trust.yes, posture: writable },
      });
    return { process, install };
  }

  it('installs the tool without running a patch-supplied version check nobody approved', async () => {
    const s = patchedVersionCheck();
    expect((await s.install({ yes: false }))[0]).toMatchObject({
      ran: true,
      code: 0,
      version_after: null,
    });
    expect(s.process.calledWith(['alpha', '--ver'])).toBe(false);
  });

  it('reads the version from the patch-supplied check once it is trusted', async () => {
    const s = patchedVersionCheck();
    expect((await s.install({ yes: true }))[0]).toMatchObject({ version_after: '1.2.3' });
    expect(s.process.calledWith(['alpha', '--ver'])).toBe(true);
  });
});

describe('explicit tool selection', () => {
  it('rejects missing and contradictory targets before running checks or installers', async () => {
    const s = setup();
    for (const selection of [{}, { names: ['alpha'], all: true }]) {
      await expect(
        s.install.execute({
          tools: s.tools,
          ...selection,
          update: false,
          dryRun: true,
          posture: writable,
        }),
      ).rejects.toMatchObject({ code: 'BAD_FLAG' });
    }
    expect(s.proc.calls).toEqual([]);
  });
  it('updates all enabled tools including existing ones, while skipping disabled tools', async () => {
    const s = setup();
    s.proc.binaries.add('alpha');
    const result = await s.install.execute({
      tools: s.tools,
      all: true,
      update: true,
      dryRun: true,
      posture: writable,
    });
    expect(result.map((row) => row.name)).toEqual(['alpha', 'beta', 'byhand']);
  });
});
