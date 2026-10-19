import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { prepareWorkspaceSetup } from '../../../../src/application/init/setup.js';
import { buildPlan } from '../../../../src/application/login/collect.js';
import type { LoginDeps } from '../../../../src/application/login/deps.js';
import { Login } from '../../../../src/application/login/run.js';
import { Verifier } from '../../../../src/application/login/verify.js';
import { ServiceOperation } from '../../../../src/application/services/operation.js';
import { Sync } from '../../../../src/application/sync/index.js';
import { describeProvider } from '../../../../src/composition/registry.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness, MANIFEST_DIR, ROOT, withTrust } from '../../../fakes/workspace.js';

const workspace = `schema_version: 2
defaults: {host: 'ssh://git@git.example.com', branch: main}
repos: [{name: app}]
providers:
  code-host:
    provider: bitbucket-cli
    vars: {host: 'ssh://git@git.example.com'}
    service: {base_url: 'https://git.example.com/deploy', context: team, flavor: datacenter, auth_scheme: pat}
`;

// What a companion answers a configuration command that would change nothing, or something.
const UNCHANGED = { code: 0, stdout: '{"changed":false}', stderr: '' };
const CHANGED = { code: 0, stdout: '{"changed":true}', stderr: '' };

const skills = {
  hosts: [],
  configured: undefined,
  bundledSkillDir: '/skills',
  globalLock: new FakeLock(),
};

// The opt-in CLIs a case binds; a workspace has to name one before fx checks it.
function vendorTools(names: readonly string[]): string {
  return ['schema_version: 3', 'tools:', ...names.map((name) => `  - {name: ${name}}`)].join('\n');
}

async function fixture(
  options: {
    environments?: string;
    tools?: readonly string[];
    patch?: string;
    readOnly?: boolean;
    yes?: boolean;
  } = {},
) {
  const tools =
    options.patch ??
    (options.environments && options.tools ? vendorTools(options.tools) : undefined);
  const base = await harness({
    workspace,
    files: {
      ...(options.environments
        ? { [`${MANIFEST_DIR}/manifest/environments.yaml`]: options.environments }
        : {}),
      ...(tools === undefined ? {} : { [`${MANIFEST_DIR}/manifest/tools.yaml`]: tools }),
    },
  });
  const h = {
    ...base,
    deps: withTrust(base.deps, {
      yes: options.yes ?? true,
      posture: { readOnly: options.readOnly ?? false, source: 'default' },
    }),
  };
  const { prompter, trusted: trust } = h;
  prompter.unavailable = false;
  const login: LoginDeps = {
    ...fakeLoginDeps({}),
    describeProvider,
    home: '/home/example',
    prompter,
  };
  h.process.binaries.add('bitbucket-cli');
  h.process.on(['bitbucket-cli', '--version'], { code: 0, stdout: '0.24.0', stderr: '' });
  const plan = buildPlan(h.deps, login, { scopeEnvs: undefined });
  return { h, login, trust, plan, operation: new ServiceOperation(h.deps, login) };
}

describe('public service declarations', () => {
  it('preserves the SSH clone prefix and scopes individual login', async () => {
    const { h, plan } = await fixture();
    expect(h.ctx.bindings[0]?.vars['host']).toBe('ssh://git@git.example.com');
    expect(plan.problems).toEqual([]);
    expect(plan.steps.find((step) => step.id.includes('.credential'))?.run).toEqual([
      'bitbucket-cli',
      '--use-context',
      'team',
      '--base-url',
      'https://git.example.com/deploy',
      '--flavor',
      'datacenter',
      'auth',
      'login',
    ]);
    expect(plan.steps[1]?.requires).toContain('bitbucket-cli.service');
  });
});

describe('native preparation', () => {
  it('withholds writes when a companion returns an unreadable preview', async () => {
    const { h, operation, plan } = await fixture();
    h.process.on(['bitbucket-cli', 'config'], {
      code: 0,
      stdout: '{"changed":"false"}',
      stderr: '',
    });
    expect(await operation.execute(plan.steps[0]!, { dryRun: false })).toMatchObject({
      status: 'failed',
      detail: 'Companion did not return a service configuration plan',
    });
    expect(
      h.process.calls.every(
        (call) => call.vector.includes('--version') || call.vector.includes('--dry-run'),
      ),
    ).toBe(true);
  });

  it('does not report configuration until the post-write preview verifies it', async () => {
    const { h, operation, plan } = await fixture();
    h.process.on(['bitbucket-cli', 'config'], {
      code: 0,
      stdout: '{"changed":true}',
      stderr: '',
    });
    expect(await operation.execute(plan.steps[0]!, { dryRun: false })).toMatchObject({
      status: 'failed',
      detail: 'Service settings were not verified after preparation',
    });
    expect(
      h.process.calls.filter(
        (call) => call.vector.includes('config') && !call.vector.includes('--dry-run'),
      ),
    ).toHaveLength(1);
  });

  it('keeps structured preparation failures in login rows', async () => {
    const { h, login } = await fixture({ readOnly: true });
    h.process.on(['bitbucket-cli', 'config'], {
      code: 0,
      stdout: JSON.stringify({ changed: true }),
      stderr: '',
    });
    const output = await new Login(h.deps, login).execute({
      tools: ['bitbucket-cli'],
      dryRun: false,
      noInput: true,
      skipManual: true,
      posture: h.deps.trust.posture,
    });
    expect(output.items[0]).toMatchObject({
      result: 'blocked',
      failure: { code: 'READONLY_BLOCKED' },
      next_steps: expect.any(Array),
    });
    expect(output.items[1]).toMatchObject({ result: 'blocked' });
    expect(
      h.process.calls.every(
        (call) => call.vector.includes('--version') || call.vector.includes('--dry-run'),
      ),
    ).toBe(true);
  });

  it('redacts credential-bearing legacy URLs from public conflict output', async () => {
    const { h, operation, plan } = await fixture();
    h.process.on(['bitbucket-cli', 'config'], {
      code: 11,
      stdout: '',
      stderr: JSON.stringify({
        error: {
          code: 'CONFIG_CONTEXT_CONFLICT',
          details: {
            server: {
              before: 'https://person:PERSONAL_VALUE_NEVER_SHARE@git.example.com',
              after: 'https://git.example.com/deploy',
            },
          },
        },
      }),
    });
    const result = await operation.execute(plan.steps[0]!, { dryRun: false });
    expect(JSON.stringify(result)).not.toContain('PERSONAL_VALUE_NEVER_SHARE');
    expect(result.changes?.['server']).toEqual({
      before: '[redacted non-public URL]',
      after: 'https://git.example.com/deploy',
    });
  });
  it('checks a bundled companion against declared settings without asking for trust', async () => {
    const { h, login, plan, trust } = await fixture({ yes: false });
    h.process.on(['bitbucket-cli', '--use-context'], { code: 0, stdout: '{}', stderr: '' });
    h.process.on(['bitbucket-cli', 'config'], {
      code: 0,
      stdout: JSON.stringify({ changed: false }),
      stderr: '',
    });
    for (const step of plan.steps) await new Verifier(h.deps, login).verify(step);
    expect(h.process.calls.some((call) => call.vector.includes('reuse'))).toBe(true);
    expect(trust.entries).toHaveLength(0);
  });

  it('runs nothing from an executable the team patch substituted until it is trusted', async () => {
    const { h, operation, plan, trust } = await fixture({
      patch: 'schema_version: 3\ntools:\n  - {name: bitbucket-cli, binary: team-wrapper}\n',
    });
    h.process.binaries.add('team-wrapper');
    const result = await operation.execute(plan.steps[0]!, { dryRun: true });
    expect(result.status).toBe('blocked');
    expect(trust.entries).toHaveLength(0);
    expect(h.process.calls.filter((call) => call.vector[0] === 'team-wrapper')).toEqual([]);
  });

  it('prepares and verifies only public settings, without activating, overwriting or logging in', async () => {
    const { h, operation, plan } = await fixture();
    let configured = false;
    h.process.always((vector) => {
      if (!vector.includes('--dry-run')) configured = true;
      return { code: 0, stdout: JSON.stringify({ changed: !configured }), stderr: '' };
    });
    expect((await operation.execute(plan.steps[0]!, { dryRun: false })).status).toBe('configured');
    expect((await operation.execute(plan.steps[0]!, { dryRun: false })).status).toBe('unchanged');
    const words = h.process.calls.flatMap((call) => call.vector);
    expect(
      h.process.calls.filter(
        (call) => !call.vector.includes('--version') && !call.vector.includes('--dry-run'),
      ),
    ).toHaveLength(1);
    expect(words).not.toContain('login');
    expect(words).not.toContain('--overwrite');
    expect(words).not.toContain('--activate');
  });

  it('returns native conflict details and a preview without overwriting', async () => {
    const { h, operation, plan } = await fixture();
    h.process.on(['bitbucket-cli', 'config'], {
      code: 11,
      stdout: '',
      stderr: JSON.stringify({
        error: {
          code: 'CONFIG_CONTEXT_CONFLICT',
          details: {
            server: { before: 'https://old.example.com', after: 'https://git.example.com/deploy' },
            token: 'PERSONAL_VALUE_NEVER_SHARE',
          },
        },
      }),
    });
    const result = await operation.execute(plan.steps[0]!, { dryRun: false });
    expect(result.status).toBe('blocked');
    expect(result.changes?.['server']).toEqual({
      before: 'https://old.example.com',
      after: 'https://git.example.com/deploy',
    });
    expect(result.next_steps?.[0]).toContain('--overwrite --dry-run');
    expect(JSON.stringify(result)).not.toContain('PERSONAL_VALUE_NEVER_SHARE');
    expect(h.process.calls.every((call) => !call.vector.includes('--overwrite'))).toBe(true);
  });

  it('does not call an old CLI with an unsupported preset command', async () => {
    const { h, operation, plan, login } = await fixture();
    h.process.clear().always({ code: 0, stdout: '0.19.1', stderr: '' });
    const blocked = await operation.execute(plan.steps[0]!, { dryRun: false });
    expect(blocked.detail).toContain('outdated');
    expect(blocked.actions?.[0]?.argv).toContain('update');
    for (const initializing of [false, true]) {
      const preparation = await prepareWorkspaceSetup(h.deps, login, {
        initializing,
        dryRun: false,
        posture: { readOnly: false, source: 'default' },
      });
      expect(
        preparation.checks.find((check) => check.resource === plan.steps[0]!.id)?.actions,
      ).toEqual(blocked.actions);
    }
    expect(h.process.calls.every((call) => call.vector.includes('--version'))).toBe(true);
  });

  it('accepts a context that serves the declared service whatever it signs in with', async () => {
    const { h, operation, plan } = await fixture();
    // The companion reports a change only when asked to switch how the context signs in.
    h.process.always((vector) => ({
      code: 0,
      stdout: JSON.stringify({ changed: vector.includes('--auth-scheme') }),
      stderr: '',
    }));
    expect((await operation.execute(plan.steps[0]!, { dryRun: false })).status).toBe('unchanged');
    expect(h.process.vectors().filter((vector) => vector.includes('set-context'))).toEqual([
      [
        'bitbucket-cli',
        'config',
        'set-context',
        'team',
        '--base-url',
        'https://git.example.com/deploy',
        '--flavor',
        'datacenter',
        '--format',
        'json',
        '--dry-run',
      ],
    ]);
  });

  it('creates a missing context the way the declaration proposes to sign in', async () => {
    const { h, operation, plan } = await fixture();
    let created = false;
    h.process.always((vector) => {
      if (!vector.includes('--dry-run')) created = true;
      // A companion proposes a scheme only for a context that has none yet.
      const changes = { server: { before: '', after: 'x' }, 'auth.scheme': { before: '' } };
      return { code: 0, stdout: JSON.stringify({ changed: !created, changes }), stderr: '' };
    });
    expect((await operation.execute(plan.steps[0]!, { dryRun: false })).status).toBe('configured');
    const applied = h.process
      .vectors()
      .filter((vector) => !vector.includes('--version') && !vector.includes('--dry-run'));
    expect(applied).toEqual([expect.arrayContaining(['--auth-scheme', 'pat'])]);
  });

  it('fills a missing service field without touching how an existing context signs in', async () => {
    const { h, operation, plan } = await fixture();
    let filled = false;
    h.process
      // The context signs in another way: naming the declared scheme would conflict.
      .when((vector) => vector.includes('--auth-scheme'), { code: 11, stdout: '', stderr: '{}' })
      .always((vector) => {
        if (!vector.includes('--dry-run')) filled = true;
        const changes = { flavor: { before: '', after: 'datacenter' } };
        return { code: 0, stdout: JSON.stringify({ changed: !filled, changes }), stderr: '' };
      });
    expect(await operation.execute(plan.steps[0]!, { dryRun: false })).toMatchObject({
      status: 'configured',
      changes: { flavor: { before: '', after: 'datacenter' } },
    });
    const vectors = h.process.vectors();
    expect(vectors.some((vector) => vector.includes('--auth-scheme'))).toBe(false);
    expect(
      vectors.filter((vector) => vector.includes('set-context') && !vector.includes('--dry-run')),
    ).toHaveLength(1);
  });

  it('does not modify settings under read-only posture', async () => {
    const { h, operation, plan } = await fixture({ readOnly: true });
    h.process.on(['bitbucket-cli', 'config'], {
      code: 0,
      stdout: JSON.stringify({ changed: true }),
      stderr: '',
    });
    expect(await operation.execute(plan.steps[0]!, { dryRun: false })).toMatchObject({
      status: 'blocked',
      failure: { code: 'READONLY_BLOCKED' },
    });
    expect(
      h.process.calls.every(
        (call) => call.vector.includes('--version') || call.vector.includes('--dry-run'),
      ),
    ).toBe(true);
  });

  it('keeps personal authentication blocked when service preparation conflicts', async () => {
    const { h, login } = await fixture();
    h.process.on(['bitbucket-cli', 'config'], {
      code: 11,
      stdout: '',
      stderr: JSON.stringify({ error: { code: 'CONFIG_CONTEXT_CONFLICT' } }),
    });
    const result = await new Login(h.deps, login).execute({
      skipManual: false,
      dryRun: false,
      noInput: true,
      posture: h.deps.trust.posture,
    });
    expect(result.items.every((row) => row.result === 'blocked')).toBe(true);
    expect(h.process.calls.some((call) => call.vector.includes('auth'))).toBe(false);
  });
});

const environments = `schema_version: 2
platforms:
  logs:
    provider: openobserve-cli
    capability: log-store
    service: {org: default, auth_scheme: session}
envs:
  dev:
    platforms:
      logs: {service: {base_url: 'https://logs.dev.example.com', context: dev}}
  prod:
    platforms:
      logs: {service: {base_url: 'https://logs.example.com', context: prod}}
`;

describe('environment and file preparation', () => {
  it('retains legacy setup for environments that have not opted into service presets', async () => {
    const { h, login } = await fixture({
      tools: ['openobserve-cli'],
      environments: `schema_version: 2
platforms:
  logs: {provider: openobserve-cli, capability: log-store}
envs:
  dev: {platforms: {logs: {vars: {context: dev}}}}
  prod:
    platforms:
      logs: {service: {base_url: 'https://logs.example.com', context: prod, org: default, auth_scheme: session}}
`,
    });
    const plan = buildPlan(h.deps, login, { tools: ['openobserve-cli'], scopeEnvs: undefined });
    expect(plan.problems).toEqual([]);
    expect(plan.steps.find((step) => step.env === 'dev')?.run).toEqual([
      'openobserve-cli',
      'config',
      'init',
      '--context',
      'dev',
    ]);
    expect(plan.steps.filter((step) => step.preparation).map((step) => step.env)).toEqual(['prod']);
  });

  it('preserves completed service results if subsequent repository inspection fails', async () => {
    const { h, login } = await fixture();
    // The companion reports the settings as changed until it has been asked to write them.
    let written = false;
    h.process
      .when((vector) => vector.includes('config') && (written ||= !vector.includes('--dry-run')), {
        code: 0,
        stdout: '{"changed":false}',
        stderr: '',
      })
      .on(['bitbucket-cli', 'config'], { code: 0, stdout: '{"changed":true}', stderr: '' });
    vi.spyOn(h.fs, 'exists').mockRejectedValue(new Error('filesystem unavailable'));
    const promise = new Sync(h.deps, { login, skills }).execute({
      dryRun: false,
      posture: { readOnly: false, source: 'default' },
      jobs: 1,
    });
    await expect(promise).rejects.toMatchObject({
      partialResult: { stages: { services: { configured: 1 } } },
    });
  });

  it('runs service setup before repo/provider work and only when selected', async () => {
    const { h, login } = await fixture();
    const order: string[] = [];
    vi.spyOn(h.deps, 'codeHost').mockImplementation(() => {
      order.push('provider');
      return h.codeHost;
    });
    h.process.when((vector) => vector.includes('config') && order.push('services') > 0, {
      code: 0,
      stdout: '{"changed":true}',
      stderr: '',
    });
    const input = {
      dryRun: true,
      posture: { readOnly: false, source: 'default' as const },
      jobs: 1,
    };
    const result = await new Sync(h.deps, { login, skills }).execute(input);
    expect(order[0]).toBe('services');
    expect(result.stages['services']).toMatchObject({ planned: 1 });
    order.length = 0;
    await new Sync(h.deps, { login, skills }).execute({ ...input, only: 'repos' });
    expect(order).not.toContain('services');
  });

  it('uses selected per-environment contexts and browser login', async () => {
    const { h, login } = await fixture({ environments, tools: ['openobserve-cli'] });
    const plan = buildPlan(h.deps, login, {
      tools: ['openobserve-cli'],
      envs: ['prod'],
      scopeEnvs: undefined,
    });
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.find((step) => step.id.includes('.credential'))?.run).toEqual([
      'openobserve-cli',
      '--use-context',
      'prod',
      '--base-url',
      'https://logs.example.com',
      '--org',
      'default',
      'auth',
      'login',
      '--browser',
    ]);
    expect(plan.steps.find((step) => step.id.includes('.credential'))?.verify).toEqual({
      command: [
        'openobserve-cli',
        '--use-context',
        'prod',
        '--base-url',
        'https://logs.example.com',
        '--org',
        'default',
        'auth',
        'status',
        '--format',
        'json',
      ],
      json: { path: 'authenticated', equals: true, reason: 'error' },
    });
  });

  it('rejects conflicting declarations for the same native context before writes', async () => {
    const { plan } = await fixture({
      environments: environments.replace('context: prod', 'context: dev'),
      tools: ['openobserve-cli'],
    });
    expect(plan.problems.some((p) => p.reason === 'step_conflict')).toBe(true);
    expect(plan.steps.some((step) => step.tool === 'openobserve-cli')).toBe(false);
  });

  describe('the Sentry defaults file', () => {
    const target = path.join(ROOT, '.sentryclirc');
    async function sentry() {
      const env = `schema_version: 2
platforms:
  errors: {provider: sentry, capability: error-tracker, service: {base_url: 'https://sentry.example.com', org: team}}
envs: {dev: {platforms: {errors: {}}}}
`;
      const { h, operation, plan, login } = await fixture({ environments: env, tools: ['sentry'] });
      const step = plan.steps.find((item) => item.tool === 'sentry' && item.preparation)!;
      return { h, operation, login, step };
    }

    it('is planned under dry-run without being created', async () => {
      const { h, operation, step } = await sentry();
      expect((await operation.execute(step, { dryRun: true })).status).toBe('planned');
      expect(await h.fs.exists(target)).toBe(false);
    });

    it('is created with public defaults only, which then verify', async () => {
      const { h, operation, login, step } = await sentry();
      expect((await operation.execute(step, { dryRun: false })).status).toBe('configured');
      expect(await h.fs.readText(target)).not.toContain('[auth]');
      expect((await new Verifier(h.deps, login).verify(step)).ok).toBe(true);
    });

    it('is left alone when it carries a credential, which is not echoed', async () => {
      const { h, operation, step } = await sentry();
      const personal = '[auth]\ntoken=PERSONAL_VALUE_NEVER_SHARE';
      await h.fs.writeText(target, personal);
      const result = await operation.execute(step, { dryRun: false });
      expect(result.status).toBe('blocked');
      expect(JSON.stringify(result)).not.toContain('PERSONAL_VALUE_NEVER_SHARE');
      expect(await h.fs.readText(target)).toBe(personal);
    });

    it('is not written through a symbolic link', async () => {
      const { h, operation, step } = await sentry();
      await h.fs.link('/elsewhere/private', target);
      expect((await operation.execute(step, { dryRun: false })).status).toBe('blocked');
      expect(await h.fs.readLink(target)).toBe('/elsewhere/private');
      expect(await h.fs.exists('/elsewhere/private')).toBe(false);
    });
  });
});

describe('a service without sign-in', () => {
  const metrics = (scheme: string): string => `schema_version: 2
platforms:
  metrics: {provider: prometheus-cli, capability: metrics}
envs:
  test:
    platforms:
      metrics: {service: {base_url: 'https://metrics.example.com', context: test, auth_scheme: ${scheme}}}
`;
  const scope = [
    'prometheus-cli',
    '--use-context',
    'test',
    '--base-url',
    'https://metrics.example.com',
  ];

  it('is judged by whether the server answers, and is never handed a login', async () => {
    const { h, login } = await fixture({
      environments: metrics('none'),
      tools: ['prometheus-cli'],
    });
    const plan = buildPlan(h.deps, login, { tools: ['prometheus-cli'], scopeEnvs: undefined });
    expect(plan.problems).toEqual([]);
    expect(plan.steps.map((step) => [step.id, step.kind, step.run?.slice(-2)])).toEqual([
      ['prometheus-cli.service@test', 'run', ['--format', 'json']],
      ['prometheus-cli.access@test', 'manual', undefined],
    ]);
    const status = [...scope, '--timeout', '10s', 'auth', 'status', '--format', 'json'];
    const answer = { code: 0, stdout: '{"authenticated":false}', stderr: '' };
    h.process.on(status, answer);
    const verifier = new Verifier(h.deps, login);
    expect((await verifier.verify(plan.steps[1]!)).ok).toBe(false);
    answer.stdout = '{"authenticated":true}';
    expect((await verifier.verify(plan.steps[1]!)).ok).toBe(true);
  });

  it('keeps reuse and personal login for a server behind a gateway', async () => {
    const { h, login } = await fixture({
      environments: metrics('bearer'),
      tools: ['prometheus-cli'],
    });
    const plan = buildPlan(h.deps, login, { tools: ['prometheus-cli'], scopeEnvs: undefined });
    expect(plan.steps.map((step) => step.id)).toEqual([
      'prometheus-cli.service@test',
      'prometheus-cli.reuse@test',
      'prometheus-cli.credential@test',
    ]);
    expect(plan.steps[2]?.run).toEqual([...scope, 'auth', 'login']);
  });
});

describe('existing login reuse on every sync', () => {
  it('associates a login the person already has and never signs in for them', async () => {
    const { h, login } = await fixture();
    let associated = false;
    h.process
      .when((vector) => vector.includes('set-context'), UNCHANGED)
      .when(
        (vector) => vector.includes('reuse'),
        (vector) => {
          const changed = !associated;
          if (!vector.includes('--dry-run')) associated = true;
          return { code: 0, stdout: JSON.stringify({ changed }), stderr: '' };
        },
      )
      .when(
        (vector) => vector.includes('status'),
        () => ({ code: 0, stdout: JSON.stringify({ configured: associated }), stderr: '' }),
      )
      .always(new Error('A sync must never invoke personal login'));
    const stage = await prepareWorkspaceSetup(h.deps, login, {
      initializing: false,
      dryRun: false,
      posture: h.deps.trust.posture,
    });
    expect(stage.checks.map((check) => [check.resource, check.state])).toEqual([
      ['bitbucket-cli.service', 'ready'],
      ['bitbucket-cli.reuse', 'ready'],
      ['bitbucket-cli.credential', 'ready'],
    ]);
    expect(
      h.process
        .vectors()
        .filter((vector) => vector.includes('reuse') && !vector.includes('--dry-run')),
    ).toHaveLength(1);
  });

  it('hands sign-in to the person and an unfinished preparation to doctor, not to init', async () => {
    const { h, login } = await fixture();
    h.process
      .when((vector) => vector.includes('set-context'), UNCHANGED)
      .when((vector) => vector.includes('reuse'), UNCHANGED)
      .when((vector) => vector.includes('status'), {
        code: 0,
        stdout: '{"configured":false}',
        stderr: '',
      })
      .always(new Error('A sync must never invoke personal login'));
    const stage = await prepareWorkspaceSetup(h.deps, login, {
      initializing: false,
      dryRun: false,
      posture: h.deps.trust.posture,
    });
    const credential = stage.checks.find((check) => check.resource === 'bitbucket-cli.credential');
    expect(credential).toMatchObject({ state: 'blocked', owner: 'user' });
    expect(credential?.actions?.[0]).toMatchObject({
      actor: 'user',
      argv: ['fx', 'login', 'bitbucket-cli', '--workspace', 'fx'],
    });
  });
});

describe('existing login reuse during initialization', () => {
  it.each([true, false])(
    'uses native identity reuse before deciding whether sign-in is needed (candidate=%s)',
    async (candidate) => {
      const { h, login } = await fixture();
      let associated = false;
      h.process
        .when((vector) => vector.includes('set-context'), UNCHANGED)
        .when(
          (vector) => vector.includes('reuse'),
          (vector) => {
            const changed = candidate && !associated;
            if (!vector.includes('--dry-run') && changed) associated = true;
            return { code: 0, stdout: JSON.stringify({ changed }), stderr: '' };
          },
        )
        .when(
          (vector) => vector.includes('status'),
          () => ({ code: 0, stdout: JSON.stringify({ configured: associated }), stderr: '' }),
        )
        .always(new Error('Initialization must never invoke personal login'));
      const first = await new Login(h.deps, login).execute({
        mode: 'prepare',
        dryRun: false,
        noInput: true,
        skipManual: false,
        posture: h.deps.trust.posture,
      });
      expect(first.items.find((item) => item.id === 'bitbucket-cli.reuse')?.result).toBe(
        candidate ? 'done' : 'verified',
      );
      expect(first.items.find((item) => item.id === 'bitbucket-cli.credential')?.result).toBe(
        candidate ? 'verified' : 'handoff',
      );
      const writes = () =>
        h.process
          .vectors()
          .filter((vector) => vector.includes('reuse') && !vector.includes('--dry-run'));
      expect(writes()).toHaveLength(candidate ? 1 : 0);
      await new Login(h.deps, login).execute({
        mode: 'prepare',
        dryRun: false,
        noInput: true,
        skipManual: false,
        posture: h.deps.trust.posture,
      });
      expect(writes()).toHaveLength(candidate ? 1 : 0);
      expect(h.process.vectors().some((vector) => vector.includes('login'))).toBe(false);
    },
  );

  it('retains native reuse failure and blocks dependent login instead of requesting a new credential', async () => {
    const { h, login } = await fixture();
    h.process
      .when((vector) => vector.includes('set-context'), UNCHANGED)
      .when((vector) => vector.includes('reuse') && vector.includes('--dry-run'), CHANGED)
      .when((vector) => vector.includes('reuse'), {
        code: 3,
        stdout: '',
        stderr: JSON.stringify({
          error: {
            category: 'config',
            code: 'CREDENTIAL_STORE_INACCESSIBLE',
            message: 'Host keychain is unavailable',
            hint: 'Retry on the host',
            next_steps: ['Retry with host keychain access'],
          },
        }),
      })
      .always(new Error('A failed reuse must not trigger a login'));
    const result = await new Login(h.deps, login).execute({
      mode: 'prepare',
      dryRun: false,
      noInput: true,
      skipManual: false,
      posture: h.deps.trust.posture,
    });
    expect(result.items.find((item) => item.id === 'bitbucket-cli.reuse')).toMatchObject({
      result: 'failed',
      detail: 'Host keychain is unavailable',
      failure: { code: 'CREDENTIAL_STORE_INACCESSIBLE' },
      next_steps: ['Retry with host keychain access'],
    });
    expect(result.items.find((item) => item.id === 'bitbucket-cli.credential')?.result).toBe(
      'blocked',
    );
  });

  it('does not associate an identity in dry-run', async () => {
    const { h, login, operation, plan } = await fixture();
    h.process
      .when((vector) => vector.includes('set-context'), UNCHANGED)
      .when((vector) => vector.includes('reuse') && vector.includes('--dry-run'), CHANGED)
      .always(new Error('Preview performed an unexpected mutation'));
    await operation.execute(plan.steps[0]!, { dryRun: false });
    await new Verifier(h.deps, login).verify(
      plan.steps.find((step) => step.id.endsWith('.reuse'))!,
    );
    const result = await new Login(h.deps, login).execute({
      mode: 'prepare',
      dryRun: true,
      noInput: true,
      skipManual: false,
      posture: h.deps.trust.posture,
    });
    expect(result.items.find((item) => item.id === 'bitbucket-cli.reuse')?.result).toBe(
      'would_run',
    );
  });
});
