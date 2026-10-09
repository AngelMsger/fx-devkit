import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FamilyCli } from '../../../../src/adapters/family/cli.js';
import { prepareWorkspaceSetup } from '../../../../src/application/init/setup.js';
import { buildPlan } from '../../../../src/application/login/collect.js';
import type { LoginDeps } from '../../../../src/application/login/deps.js';
import { Login } from '../../../../src/application/login/run.js';
import { Verifier } from '../../../../src/application/login/verify.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { ServiceOperation } from '../../../../src/application/services/operation.js';
import { Sync } from '../../../../src/application/sync/index.js';
import { describeProvider } from '../../../../src/composition/registry.js';
import { loadWorkspace } from '../../../../src/domain/manifest/loader.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';
import { harness, MANIFEST_DIR, ROOT } from '../../../fakes/workspace.js';

const workspace = `schema_version: 2
defaults: {host: 'ssh://git@git.example.com', branch: main}
repos: [{name: app}]
providers:
  code-host:
    provider: bitbucket-cli
    vars: {host: 'ssh://git@git.example.com'}
    service: {base_url: 'https://git.example.com/deploy', context: team, flavor: datacenter, auth_scheme: pat}
`;

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
  const h = await harness({
    workspace,
    files: {
      ...(options.environments
        ? { [`${MANIFEST_DIR}/manifest/environments.yaml`]: options.environments }
        : {}),
      ...(tools === undefined ? {} : { [`${MANIFEST_DIR}/manifest/tools.yaml`]: tools }),
    },
  });
  const trust = new FakeTrustStore();
  const clock = new FakeClock();
  const prompter = new FakePrompter();
  const login: LoginDeps = {
    describeProvider,
    home: '/home/example',
    prompter,
    clock,
    trust: {
      gate: new TrustGate(trust, prompter, clock),
      yes: options.yes ?? true,
      posture: { readOnly: options.readOnly ?? false, source: 'default' as const },
    },
  };
  h.process.binaries.add('bitbucket-cli');
  h.process.on(['bitbucket-cli', '--version'], { code: 0, stdout: '0.24.0', stderr: '' });
  const plan = buildPlan(h.deps, login, { scopeEnvs: undefined });
  return { h, login, trust, plan, operation: new ServiceOperation(h.deps, login) };
}

describe('public service declarations', () => {
  it.each(['token', 'password', 'username', 'email', 'session', 'authorization', 'api_token'])(
    'rejects personal %s even without strict validation',
    (field) => {
      const text = workspace.replace(
        'auth_scheme: pat}',
        `auth_scheme: pat, ${field}: PERSONAL_VALUE_NEVER_SHARE}`,
      );
      try {
        loadWorkspace(text, { cliVersion: '1.0.0' });
        throw new Error('accepted credential');
      } catch (error) {
        expect(String(error)).not.toContain('PERSONAL_VALUE_NEVER_SHARE');
        expect(String(error)).toContain('public service settings');
      }
    },
  );

  it.each([
    'https://user:PERSONAL_VALUE_NEVER_SHARE@git.example.com',
    'https://git.example.com/?token=PERSONAL_VALUE_NEVER_SHARE',
  ])('rejects credentials embedded in URL without echoing them', (url) => {
    expect(() =>
      loadWorkspace(workspace.replace('https://git.example.com/deploy', url), {
        cliVersion: '1.0.0',
      }),
    ).toThrow('without credentials');
  });

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
      '--auth-scheme',
      'pat',
      'auth',
      'login',
    ]);
    expect(plan.steps[1]?.requires).toContain('bitbucket-cli.service');
    expect(JSON.stringify(plan)).not.toContain('PERSONAL_VALUE_NEVER_SHARE');
  });
});

describe('native preparation', () => {
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
      posture: login.trust.posture,
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

  it('withholds authenticated queries when the target preset is missing or conflicts', async () => {
    const { h } = await fixture();
    h.process.on(['bitbucket-cli', 'config'], { code: 11, stdout: '', stderr: '{}' });
    const client = new FamilyCli('bitbucket-cli', h.process, 'team', {
      base_url: 'https://git.example.com',
    });
    await expect(client.call(['whoami'])).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(h.process.calls.some((call) => call.vector.includes('whoami'))).toBe(false);
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
    const result = await operation.execute(plan.steps[0]!, false);
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
    const result = await operation.execute(plan.steps[0]!, true);
    expect(result.status).toBe('blocked');
    expect(trust.entries).toHaveLength(0);
    expect(h.process.calls.filter((call) => call.vector[0] === 'team-wrapper')).toEqual([]);
  });

  it('prepares and verifies only public settings, without activating, overwriting or logging in', async () => {
    const { h, operation, plan } = await fixture();
    let configured = false;
    const calls: readonly string[][] = [];
    vi.spyOn(h.process, 'run').mockImplementation(async (vector) => {
      (calls as string[][]).push([...vector]);
      if (vector.includes('--version')) return { code: 0, stdout: '0.24.0', stderr: '' };
      if (!vector.includes('--dry-run')) configured = true;
      return { code: 0, stdout: JSON.stringify({ changed: !configured }), stderr: '' };
    });
    expect((await operation.execute(plan.steps[0]!, false)).status).toBe('configured');
    expect((await operation.execute(plan.steps[0]!, false)).status).toBe('unchanged');
    expect(calls.filter((v) => !v.includes('--version') && !v.includes('--dry-run'))).toHaveLength(
      1,
    );
    expect(calls.flat()).not.toContain('login');
    expect(calls.flat()).not.toContain('--overwrite');
    expect(calls.flat()).not.toContain('--activate');
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
    const result = await operation.execute(plan.steps[0]!, false);
    expect(result.status).toBe('blocked');
    expect(result.changes?.['server']).toBeDefined();
    expect(result.next_steps?.[0]).toContain('--overwrite --dry-run');
    expect(JSON.stringify(result)).not.toContain('PERSONAL_VALUE_NEVER_SHARE');
    expect(h.process.calls.every((call) => !call.vector.includes('--overwrite'))).toBe(true);
  });

  it('does not call an old CLI with an unsupported preset command', async () => {
    const { h, operation, plan, login } = await fixture();
    h.process.clear().always({ code: 0, stdout: '0.19.1', stderr: '' });
    const blocked = await operation.execute(plan.steps[0]!, false);
    expect(blocked.detail).toContain('outdated');
    expect(blocked.actions?.[0]?.argv).toContain('update');
    for (const apply of [false, true]) {
      const preparation = await prepareWorkspaceSetup(h.deps, login, {
        apply,
        dryRun: false,
        posture: { readOnly: false, source: 'default' },
      });
      expect(
        preparation.checks.find((check) => check.resource === plan.steps[0]!.id)?.actions,
      ).toEqual(blocked.actions);
    }
    expect(h.process.calls.every((call) => call.vector.includes('--version'))).toBe(true);
  });

  it('does not modify settings under read-only posture', async () => {
    const { h, operation, plan } = await fixture({ readOnly: true });
    h.process.on(['bitbucket-cli', 'config'], {
      code: 0,
      stdout: JSON.stringify({ changed: true }),
      stderr: '',
    });
    expect(await operation.execute(plan.steps[0]!, false)).toMatchObject({
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
      posture: login.trust.posture,
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
    const { h } = await fixture();
    vi.spyOn(h.fs, 'exists').mockRejectedValue(new Error('filesystem unavailable'));
    const promise = new Sync(h.deps).execute({
      dryRun: false,
      posture: { readOnly: false, source: 'default' },
      jobs: 1,
      stages: {
        services: async () => ({ checks: [], summary: { configured: 1 }, details: { items: [] } }),
      },
    });
    await expect(promise).rejects.toMatchObject({
      partialResult: { stages: { services: { configured: 1 } } },
    });
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
      '--auth-scheme',
      'session',
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
        '--auth-scheme',
        'session',
        'auth',
        'status',
        '--format',
        'json',
      ],
      json: { path: 'authenticated', equals: true },
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

  it('creates only public Sentry defaults and preserves foreign files and symlinks', async () => {
    const env = `schema_version: 2
platforms:
  errors: {provider: sentry, capability: error-tracker, service: {base_url: 'https://sentry.example.com', org: team}}
envs: {dev: {platforms: {errors: {}}}}
`;
    const { h, operation, plan, login } = await fixture({ environments: env, tools: ['sentry'] });
    const step = plan.steps.find((item) => item.tool === 'sentry' && item.preparation)!;
    const target = path.join(ROOT, '.sentryclirc');
    expect((await operation.execute(step, true)).status).toBe('planned');
    expect(await h.fs.exists(target)).toBe(false);
    expect((await operation.execute(step, false)).status).toBe('configured');
    expect(await h.fs.readText(target)).not.toContain('[auth]');
    expect((await new Verifier(h.deps, login).verify(step)).ok).toBe(true);
    await h.fs.writeText(target, '[auth]\ntoken=PERSONAL_VALUE_NEVER_SHARE');
    const result = await operation.execute(step, false);
    expect(result.status).toBe('blocked');
    expect(JSON.stringify(result)).not.toContain('PERSONAL_VALUE_NEVER_SHARE');
    await h.fs.link('/elsewhere/private', target);
    expect((await operation.execute(step, false)).status).toBe('blocked');
  });

  it('runs service setup before repo/provider work and only when selected', async () => {
    const { h } = await fixture();
    const order: string[] = [];
    vi.spyOn(h.deps, 'codeHost').mockImplementation(() => {
      order.push('provider');
      return h.codeHost;
    });
    const stage = async () => {
      order.push('services');
      return { checks: [], summary: { configured: 1 } };
    };
    const input = {
      dryRun: true,
      posture: { readOnly: false, source: 'default' as const },
      jobs: 1,
      stages: { services: stage },
    };
    const result = await new Sync(h.deps).execute(input);
    expect(order[0]).toBe('services');
    expect(result.stages['services']).toEqual({ configured: 1 });
    order.length = 0;
    await new Sync(h.deps).execute({ ...input, only: 'repos' });
    expect(order).not.toContain('services');
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
    '--auth-scheme',
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
    const status = [...scope, 'none', '--timeout', '10s', 'auth', 'status', '--format', 'json'];
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
    expect(plan.steps[2]?.run).toEqual([...scope, 'bearer', 'auth', 'login']);
  });
});

describe('existing login reuse during initialization', () => {
  it.each([true, false])(
    'uses native identity reuse before deciding whether sign-in is needed (candidate=%s)',
    async (candidate) => {
      const { h, login } = await fixture();
      let associated = false;
      const run = vi.spyOn(h.process, 'run').mockImplementation(async (vector) => {
        if (vector.includes('--version')) return { code: 0, stdout: '0.24.0', stderr: '' };
        if (vector.includes('set-context'))
          return { code: 0, stdout: '{"changed":false}', stderr: '' };
        if (vector.includes('reuse')) {
          const changed = candidate && !associated;
          if (!vector.includes('--dry-run') && changed) associated = true;
          return { code: 0, stdout: JSON.stringify({ changed }), stderr: '' };
        }
        if (vector.includes('status'))
          return { code: 0, stdout: JSON.stringify({ configured: associated }), stderr: '' };
        throw new Error('Initialization must never invoke personal login');
      });
      const first = await new Login(h.deps, login).execute({
        mode: 'prepare',
        dryRun: false,
        noInput: true,
        skipManual: false,
        posture: login.trust.posture,
      });
      expect(first.items.find((item) => item.id === 'bitbucket-cli.reuse')?.result).toBe(
        candidate ? 'done' : 'verified',
      );
      expect(first.items.find((item) => item.id === 'bitbucket-cli.credential')?.result).toBe(
        candidate ? 'verified' : 'handoff',
      );
      const writes = () =>
        run.mock.calls.filter(
          ([vector]) => vector.includes('reuse') && !vector.includes('--dry-run'),
        );
      expect(writes()).toHaveLength(candidate ? 1 : 0);
      await new Login(h.deps, login).execute({
        mode: 'prepare',
        dryRun: false,
        noInput: true,
        skipManual: false,
        posture: login.trust.posture,
      });
      expect(writes()).toHaveLength(candidate ? 1 : 0);
      expect(run.mock.calls.some(([vector]) => vector.includes('login'))).toBe(false);
    },
  );

  it('retains native reuse failure and blocks dependent login instead of requesting a new credential', async () => {
    const { h, login } = await fixture();
    vi.spyOn(h.process, 'run').mockImplementation(async (vector) => {
      if (vector.includes('--version')) return { code: 0, stdout: '0.24.0', stderr: '' };
      if (vector.includes('set-context'))
        return { code: 0, stdout: '{"changed":false}', stderr: '' };
      if (vector.includes('reuse') && vector.includes('--dry-run'))
        return { code: 0, stdout: '{"changed":true}', stderr: '' };
      if (vector.includes('reuse'))
        return {
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
        };
      throw new Error('A failed reuse must not trigger a login');
    });
    const result = await new Login(h.deps, login).execute({
      mode: 'prepare',
      dryRun: false,
      noInput: true,
      skipManual: false,
      posture: login.trust.posture,
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
    vi.spyOn(h.process, 'run').mockImplementation(async (vector) => {
      if (vector.includes('--version')) return { code: 0, stdout: '0.24.0', stderr: '' };
      if (vector.includes('set-context'))
        return { code: 0, stdout: '{"changed":false}', stderr: '' };
      if (vector.includes('reuse') && vector.includes('--dry-run'))
        return { code: 0, stdout: '{"changed":true}', stderr: '' };
      throw new Error('Preview performed an unexpected mutation');
    });
    await operation.execute(plan.steps[0]!, false);
    await new Verifier(h.deps, login).verify(
      plan.steps.find((step) => step.id.endsWith('.reuse'))!,
    );
    const result = await new Login(h.deps, login).execute({
      mode: 'prepare',
      dryRun: true,
      noInput: true,
      skipManual: false,
      posture: login.trust.posture,
    });
    expect(result.items.find((item) => item.id === 'bitbucket-cli.reuse')?.result).toBe(
      'would_run',
    );
  });
});
