import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { Doctor, type DoctorInput } from '../../../src/application/doctor/index.js';
import type { DoctorExtension } from '../../../src/application/doctor/types.js';
import type { LoginDeps } from '../../../src/application/login/deps.js';
import { TrustGate } from '../../../src/application/safety/trust.js';
import { CachedProbe } from '../../../src/application/update/check.js';
import { FxUpdateCheck } from '../../../src/application/update/fx.js';
import { ManifestUpdateCheck } from '../../../src/application/update/manifest.js';
import { DevkitError } from '../../../src/domain/errors.js';
import type { LocalLayer } from '../../../src/domain/manifest/types.js';
import { finding } from '../../../src/domain/report.js';
import type { SetupRecipe } from '../../../src/domain/setup/types.js';
import type { ProviderDescriptor } from '../../../src/ports/provider.js';
import { FakeAgentHost } from '../../fakes/fake-agent-host.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';
import { FakeRegistry } from '../../fakes/fake-registry.js';
import { FakeTrustStore } from '../../fakes/fake-trust-store.js';
import { MANIFEST_DIR, ROOT, harness, type Harness } from '../../fakes/workspace.js';

const HOME = path.resolve('/home/me');
const upstream = (name: string): string => `ssh://git@git.example.com:12345/fx/${name}.git`;

const environments = [
  'schema_version: 1',
  'platforms: { kube: {}, jenkins: {} }',
  'envs:',
  '  dev: { platforms: { kube: { vars: { kubeconfig: ~/.kube/dev, context: dev } } } }',
  '  test: { platforms: { kube: { vars: { kubeconfig: ~/.kube/test, context: test } } } }',
  '',
].join('\n');

const login: SetupRecipe = {
  id: 'login',
  tool: 'bitbucket-cli',
  perEnv: false,
  kind: 'run',
  title: 'Log in',
  run: ['auth', 'login'],
  verify: { command: ['auth', 'status'] },
};
const kubeconfig: SetupRecipe = {
  id: 'kubeconfig',
  tool: 'kubectl',
  perEnv: true,
  kind: 'file',
  title: 'Kubeconfig for {env}',
  verify: { file: '{kubeconfig}' },
};
const DESCRIPTORS: Record<string, ProviderDescriptor<unknown>> = {
  'bitbucket-cli': {
    id: 'bitbucket-cli',
    capability: 'code-host',
    tools: ['bitbucket-cli'],
    recipes: [login],
    vars: [],
    create: () => ({}),
  },
  kubectl: {
    id: 'kubectl',
    capability: 'cluster',
    tools: ['kubectl'],
    recipes: [kubeconfig],
    vars: [],
    create: () => ({}),
  },
};

const bundledSkill = {
  dir: path.resolve('/pkg/skills/fx-workspace'),
  files: {
    [path.resolve('/pkg/skills/fx-workspace/SKILL.md')]:
      '---\nname: fx-workspace\nversion: 1.0.0\n---\n',
  },
};
const agents = [new FakeAgentHost('claude-code', true)];

interface Stage {
  readonly h: Harness;
  readonly doctor: Doctor;
  readonly prompter: FakePrompter;
  readonly registry: FakeRegistry;
  loggedIn: boolean;
}

async function stage(
  options: {
    local?: LocalLayer;
    healthy?: boolean;
    yes?: boolean;
    updates?: boolean;
    extensions?: readonly DoctorExtension[];
  } = {},
): Promise<Stage> {
  const h = await harness({
    local: options.local ?? { scope: { envs: ['dev'] } },
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: environments,
      ...bundledSkill.files,
      [path.join(MANIFEST_DIR, 'skills', 'review', 'SKILL.md')]: '---\nname: review\n---\n',
    },
  });
  const prompter = new FakePrompter();
  const setup: LoginDeps = {
    describeProvider: (id) => DESCRIPTORS[id],
    prompter,
    clock: new FakeClock(),
    home: HOME,
    trust: {
      gate: new TrustGate(new FakeTrustStore(), prompter, new FakeClock()),
      yes: options.yes ?? false,
      posture: { readOnly: false, source: 'default' },
    },
  };
  const registry = new FakeRegistry('1.0.0');
  const probe = new CachedProbe(h.cache, new FakeClock());
  const s: Stage = {
    h,
    prompter,
    registry,
    loggedIn: options.healthy ?? false,
    doctor: new Doctor(h.deps, {
      extensions: options.extensions,
      login: setup,
      skills: { hosts: agents, configured: undefined, bundledSkillDir: bundledSkill.dir },
      bundledTools: readBundled,
      updates: {
        fx: new FxUpdateCheck(probe, () => registry),
        manifest: new ManifestUpdateCheck(probe, h.git),
        self: {
          current: '1.0.0',
          packageName: '@fx/devkit',
          registry: 'https://npm.example.com',
        },
        enabled: options.updates ?? true,
      },
    }),
  };
  h.process
    .when((v) => v[1] === 'auth' && v[2] === 'status' && s.loggedIn, {
      code: 0,
      stdout: '',
      stderr: '',
    })
    .when((v) => v[1] === 'auth' && v[2] === 'status', {
      code: 1,
      stdout: '',
      stderr: 'no credential stored',
    })
    .when(
      (v) => {
        if (v[2] !== 'login') return false;
        s.loggedIn = true;
        return true;
      },
      { code: 0, stdout: '', stderr: '' },
    )
    .when((v) => v[1] === '--version' || v[1] === 'version', {
      code: 0,
      stdout: 'tool v9.9.9',
      stderr: '',
    });
  if (options.healthy) {
    for (const name of ['fx-example-api', 'fx-example-auth', 'fx-example-docs'])
      h.git.add(path.join(ROOT, name), { remotes: { upstream: upstream(name) } });
    for (const binary of [
      'bitbucket-cli',
      'confluence-cli',
      'jenkins-cli',
      'openobserve-cli',
      'jira-cli',
      'sentry',
      'kubectl',
      'lark-cli',
      'meegle',
      'wecom-cli',
    ])
      h.process.binaries.add(binary);
    await h.fs.writeText(`${HOME}/.kube/dev`, 'k');
    await h.fs.link(
      path.join(MANIFEST_DIR, 'skills', 'review'),
      path.join(agents[0]!.skillsDir('global'), 'review'),
    );
    await h.fs.copyDir(bundledSkill.dir, path.join(agents[0]!.skillsDir('global'), 'fx-workspace'));
  }
  return s;
}

function readBundled(): string {
  return readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');
}

const check: DoctorInput = {
  fix: false,
  dryRun: false,
  noInput: true,
  posture: { readOnly: false, source: 'default' },
};

describe('Doctor', () => {
  it.each([
    { selection: { tools: ['bitbuckt-cli'] }, code: 'TOOL_UNKNOWN' },
    { selection: { envs: ['tset'] }, code: 'ENV_NOT_FOUND' },
  ])('rejects invalid selectors before any repair: $code', async ({ selection, code }) => {
    let repaired = 0;
    const s = await stage({
      extensions: [
        {
          group: 'sample',
          check: async () => [],
          fix: async () => {
            repaired++;
          },
        },
      ],
    });
    await expect(s.doctor.execute({ ...check, fix: true, ...selection })).rejects.toMatchObject({
      code,
    });
    expect(repaired).toBe(0);
    expect(s.h.localStore.writes).toEqual([]);
    expect(s.h.process.calls).toEqual([]);
    expect(s.prompter.questions).toEqual([]);
  });

  it('includes a registered check and runs its repair only when requested', async () => {
    let repaired = 0;
    const s = await stage({
      extensions: [
        {
          group: 'sample',
          check: async () => [
            { group: 'sample', id: 'sample', level: 'ok', coverage: 'checked', message: 'checked' },
          ],
          fix: async () => {
            repaired++;
          },
        },
      ],
    });
    const out = await s.doctor.execute({
      fix: false,
      dryRun: false,
      noInput: true,
      posture: { readOnly: false, source: 'default' },
    });
    expect(out.findings.find((f) => f.group === 'sample')?.id).toBe('sample');
    expect(repaired).toBe(0);
  });
  it('retains a failed repair and still checks its resulting state and later repairs', async () => {
    let laterRepaired = false;
    const s = await stage({
      extensions: [
        {
          group: 'mcp',
          fix: async () => {
            throw new DevkitError('network', 'REPAIR_OFFLINE', 'offline');
          },
          check: async () => [finding('mcp', 'state', 'warn', 'still pending')],
        },
        {
          group: 'rules',
          fix: async () => {
            laterRepaired = true;
          },
          check: async () => [finding('rules', 'state', 'ok', 'present')],
        },
      ],
    });
    const out = await s.doctor.execute({ ...check, fix: true });
    expect(laterRepaired).toBe(true);
    expect(out.repairs.slice(0, 2)).toMatchObject([
      {
        group: 'mcp',
        status: 'failed',
        failure: { code: 'REPAIR_OFFLINE', category: 'network', retryable: true },
      },
      { group: 'rules', status: 'completed' },
    ]);
    expect(out.findings.find((item) => item.group === 'mcp')?.message).toBe('still pending');
    expect(out.repairs[0]?.failure?.next_steps.length).toBeGreaterThan(0);
  });

  it('reports previews separately from completed repairs and preserves the read-only gate', async () => {
    const s = await stage({
      extensions: [{ group: 'mcp', fix: async () => {}, check: async () => [] }],
    });
    const preview = await s.doctor.execute({ ...check, fix: true, dryRun: true });
    expect(preview.repairs[0]).toEqual({ group: 'mcp', status: 'planned' });
    expect((await s.doctor.execute(check)).repairs).toEqual([]);
    await expect(
      s.doctor.execute({ ...check, fix: true, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
  });

  it('reports five groups, failing only on what breaks the workspace', async () => {
    const s = await stage();
    s.h.git.add(path.join(ROOT, 'fx-example-auth'), {
      remotes: { upstream: upstream('fx-example-auth') },
      state: { branch: 'main', dirty: true, untracked: 0, ahead: 0, behind: 0 },
    });
    const report = await s.doctor.execute({
      ...check,
      tools: ['bitbucket-cli', 'kubectl', 'jira-cli'],
    });
    const by = (group: string) =>
      report.findings.filter((f) => f.group === group).map((f) => [f.id, f.level]);
    expect(by('repos')).toEqual([
      ['fx-example-api', 'fail'],
      ['fx-example-auth', 'warn'],
      ['fx-example-docs', 'fail'],
    ]);
    expect(by('tools')).toEqual([
      ['bitbucket-cli', 'fail'],
      ['jira-cli', 'warn'],
      ['kubectl', 'warn'],
    ]);
    expect(by('login')).toEqual([
      ['bitbucket-cli.login', 'fail'],
      ['kubectl.kubeconfig@dev', 'warn'],
    ]);
    expect(by('agents')).toEqual([
      ['claude-code:review', 'warn'],
      ['claude-code:fx-workspace', 'warn'],
    ]);
    expect(
      by('manifest')
        .filter(([id]) => id !== 'upstream')
        .every(([, l]) => l === 'warn'),
    ).toBe(true);
    expect(by('manifest')).toContainEqual(['upstream', 'ok']);
    expect(by('self')).toEqual([['version', 'ok']]);
    expect(report.ok).toBe(false);
    const login = report.findings.find((f) => f.id === 'bitbucket-cli.login');
    expect(login?.fix).toBe('fx login bitbucket-cli');
    expect(login?.handoff?.user_steps[0]?.command).toEqual(['bitbucket-cli', 'auth', 'login']);
    expect(report.findings.find((f) => f.id === 'fx-example-api')?.fix).toBe('fx sync');
  });

  it('asks the registry and the upstream live, and warns with the remedy when either is behind', async () => {
    const s = await stage({ healthy: true });
    s.registry.set('2.0.0');
    s.h.git.add(MANIFEST_DIR, {
      remotes: { upstream: upstream('fx-workspace') },
      remoteHeads: { upstream: 'main' },
      liveHeads: { upstream: { sha: 'b'.repeat(40), branch: 'main' } },
      shas: { 'upstream/main': 'a'.repeat(40) },
    });
    const report = await s.doctor.execute(check);
    expect(report.findings.find((f) => f.id === 'version')).toMatchObject({
      group: 'self',
      level: 'warn',
      message: '1.0.0 is behind 2.0.0',
      fix: 'fx self update --yes',
    });
    expect(report.findings.find((f) => f.id === 'upstream')).toMatchObject({
      group: 'manifest',
      level: 'warn',
      fix: 'fx sync',
    });
    expect(report.ok).toBe(true);
    s.registry.set(new Error('503'));
    const again = await s.doctor.execute(check);
    expect(again.findings.find((f) => f.id === 'version')).toMatchObject({
      level: 'warn',
      message: 'could not query the configured registry: 503',
    });
    expect(s.registry.calls).toBe(2);
  });

  it('does not probe at all when the update check is off, and says so', async () => {
    const s = await stage({ healthy: true, updates: false });
    s.registry.set('2.0.0');
    const report = await s.doctor.execute(check);
    expect(report.findings.find((f) => f.id === 'version')).toMatchObject({
      level: 'ok',
      message: expect.stringContaining('update_check is off'),
    });
    expect(report.findings.find((f) => f.id === 'upstream')).toMatchObject({ level: 'ok' });
    expect(s.registry.calls).toBe(0);
    expect(s.h.git.calls.filter((c) => c.startsWith('ls-remote'))).toEqual([]);
  });

  it('calls an acknowledged step that fails its check a failure, and says so', async () => {
    const s = await stage({
      local: {
        scope: { envs: ['dev'] },
        setup: { 'kubectl.kubeconfig@dev': { acknowledged: '2026-08-01' } },
      },
    });
    const report = await s.doctor.execute({ ...check, tools: ['kubectl'] });
    expect(report.findings.find((f) => f.id === 'kubectl.kubeconfig@dev')).toMatchObject({
      level: 'fail',
      message: expect.stringContaining('acknowledged on 2026-08-01 but the check fails'),
    });
  });

  it('is all green on a healthy machine', async () => {
    const s = await stage({ healthy: true });
    const report = await s.doctor.execute(check);
    expect(report.findings.filter((f) => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.summary.ok).toBeGreaterThan(10);
  });

  it('with --fix, runs the run-type steps and the Skill links before diagnosing, never the manual ones', async () => {
    const s = await stage({ yes: true });
    await s.h.fs.writeText(`${HOME}/.kube/test`, 'k');
    const report = await s.doctor.execute({
      ...check,
      fix: true,
      tools: ['bitbucket-cli', 'kubectl'],
      envs: ['dev'],
    });
    expect(report.findings.find((f) => f.id === 'bitbucket-cli.login')?.level).toBe('ok');
    expect(report.findings.find((f) => f.id === 'kubectl.kubeconfig@dev')?.level).toBe('warn');
    expect(report.findings.find((f) => f.id === 'claude-code:review')?.level).toBe('ok');
    expect(
      s.h.process.calls.some((c) => c.vector[2] === 'login' && c.options.interactive === false),
    ).toBe(true);
    expect(s.prompter.questions).toEqual([]);

    const dry = await stage({ yes: true });
    await dry.doctor.execute({ ...check, fix: true, dryRun: true, tools: ['bitbucket-cli'] });
    expect(dry.h.process.calls.some((c) => c.vector[2] === 'login')).toBe(false);
    expect(dry.h.localStore.writes).toEqual([]);
    expect(dry.h.fs.links.size).toBe(0);
  });

  it('refuses --fix under read-only posture but still diagnoses without it', async () => {
    const s = await stage();
    await expect(
      s.doctor.execute({ ...check, fix: true, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    const report = await s.doctor.execute({ ...check, posture: { readOnly: true, source: 'env' } });
    expect(report.findings.length).toBeGreaterThan(0);
  });
});
