import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { LoginDeps } from '../../../src/application/login/deps.js';
import { Login, type LoginInput } from '../../../src/application/login/run.js';
import { Verifier } from '../../../src/application/login/verify.js';
import { TrustGate } from '../../../src/application/safety/trust.js';
import { DevkitError } from '../../../src/domain/errors.js';
import type { LocalLayer } from '../../../src/domain/manifest/types.js';
import type { SetupRecipe } from '../../../src/domain/setup/types.js';
import type { ProviderDescriptor } from '../../../src/ports/provider.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../fakes/fake-trust-store.js';
import { MANIFEST_DIR, harness, type Harness } from '../../fakes/workspace.js';

const HOME = path.resolve('/home/me');

const environments = [
  'schema_version: 1',
  'platforms:',
  '  kube: {}',
  '  jenkins: {}',
  'envs:',
  '  dev: { platforms: { kube: { vars: { kubeconfig: ~/.kube/dev, context: dev } } } }',
  '  test: { platforms: { kube: { vars: { kubeconfig: ~/.kube/test, context: test } } } }',
  '',
].join('\n');

const tools = [
  'schema_version: 2',
  'tools:',
  '  - name: worklog',
  '    setup:',
  '      - { id: token, kind: manual, title: Get a token, open: "https://form.example.com/", verify: { command: [auth, status] } }',
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
  expects: { path: '{kubeconfig}' },
  verify: { file: '{kubeconfig}' },
};
const access: SetupRecipe = {
  id: 'access',
  tool: 'kubectl',
  perEnv: true,
  kind: 'manual',
  title: 'Access to {context}',
  verify: {
    command: [
      '--kubeconfig',
      '{kubeconfig}',
      '--context',
      '{context}',
      'auth',
      'can-i',
      'get',
      'pods',
    ],
  },
  requires: ['kubeconfig'],
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
    recipes: [kubeconfig, access],
    vars: [],
    create: () => ({}),
  },
};

interface Stage {
  readonly h: Harness;
  readonly prompter: FakePrompter;
  readonly trust: FakeTrustStore;
  readonly setup: Login;
  readonly deps: LoginDeps;
  loggedIn: boolean;
  reporter(): readonly { code: string }[];
}

async function stage(
  options: { local?: LocalLayer; yes?: boolean; unavailable?: boolean; tools?: string } = {},
): Promise<Stage> {
  const h = await harness({
    local: options.local ?? { scope: { envs: ['dev', 'test'] } },
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: environments,
      [`${MANIFEST_DIR}/manifest/tools.yaml`]: options.tools ?? tools,
    },
  });
  const prompter = new FakePrompter();
  prompter.unavailable = options.unavailable ?? false;
  const trust = new FakeTrustStore();
  const deps: LoginDeps = {
    describeProvider: (id) => DESCRIPTORS[id],
    prompter,
    clock: new FakeClock(),
    home: HOME,
    trust: {
      gate: new TrustGate(trust, prompter, new FakeClock()),
      yes: options.yes ?? false,
      posture: { readOnly: false, source: 'default' },
    },
  };
  const s: Stage = {
    h,
    prompter,
    trust,
    deps,
    setup: new Login(h.deps, deps),
    loggedIn: false,
    reporter: () => h.reporter.notices,
  };
  const isStatus = (v: readonly string[]): boolean =>
    v[0] === 'bitbucket-cli' && v[1] === 'auth' && v[2] === 'status';
  // Logging in flips the status check: the fake tool remembers its credential.
  h.process
    .when((v) => isStatus(v) && s.loggedIn, { code: 0, stdout: '', stderr: '' })
    .when(isStatus, { code: 1, stdout: '', stderr: 'no credential stored' })
    .when(
      (v) => {
        if (v[0] !== 'bitbucket-cli' || v[2] !== 'login') return false;
        s.loggedIn = true;
        return true;
      },
      { code: 0, stdout: '', stderr: '' },
    )
    .on(['kubectl'], { code: 1, stdout: 'no', stderr: 'forbidden' })
    .on(['worklog'], { code: 1, stdout: '', stderr: 'no token' });
  return s;
}

const run: LoginInput = {
  skipManual: false,
  dryRun: false,
  noInput: false,
  posture: { readOnly: false, source: 'default' },
};

describe('Verifier', () => {
  it('checks a file under ~, a command, and trusts a patch-supplied command first', async () => {
    const s = await stage();
    const verifier = new Verifier(s.h.deps, s.deps);
    const plan = await s.setup.plan({});
    const file = plan.steps.find((x) => x.id === 'kubectl.kubeconfig@dev')!;
    expect(await verifier.verify(file)).toEqual({
      ok: false,
      detail: `${HOME}/.kube/dev is missing`,
    });
    await s.h.fs.writeText(`${HOME}/.kube/dev`, 'k');
    expect((await verifier.verify(file)).ok).toBe(true);

    const team = plan.steps.find((x) => x.id === 'worklog.token')!;
    expect(team.origin).toBe('patch');
    s.prompter.unavailable = true;
    await expect(verifier.verify(team)).rejects.toMatchObject({ code: 'VECTOR_UNTRUSTED' });
    s.prompter.unavailable = false;
    s.prompter.confirmWith = true;
    expect(await verifier.verify(team)).toEqual({ ok: false, detail: 'no token' });
    expect(s.trust.entries.map((e) => e.label)).toEqual(['worklog.token check']);

    const base = plan.steps.find((x) => x.id === 'kubectl.access@dev')!;
    expect((await verifier.verify(base)).ok).toBe(false);
    expect(s.h.process.calls.at(-1)?.vector).toEqual([
      'kubectl',
      '--kubeconfig',
      `${HOME}/.kube/dev`,
      '--context',
      'dev',
      'auth',
      'can-i',
      'get',
      'pods',
    ]);
    expect(s.trust.entries, 'a bundled recipe needs no trust').toHaveLength(1);
  });

  it('refuses a bundled provider recipe when the patch replaced its executable', async () => {
    const s = await stage({
      unavailable: true,
      tools: ['schema_version: 2', 'tools:', '  - { name: bitbucket-cli, binary: surprise }'].join(
        '\n',
      ),
    });
    const step = (await s.setup.plan({})).steps.find((item) => item.id === 'bitbucket-cli.login')!;

    await expect(new Verifier(s.h.deps, s.deps).verify(step)).rejects.toMatchObject({
      code: 'VECTOR_UNTRUSTED',
    });
    expect(s.h.process.calls).toEqual([]);
  });
});

describe('Login', () => {
  it.each([
    { selection: { tools: ['bitbuckt-cli'] }, code: 'TOOL_UNKNOWN', suggestion: 'bitbucket-cli' },
    { selection: { envs: ['tset'] }, code: 'ENV_NOT_FOUND', suggestion: 'test' },
  ])(
    'rejects invalid selectors before planning or changing scope: $code',
    async ({ selection, code, suggestion }) => {
      const s = await stage({ local: {} });
      await expect(s.setup.plan(selection)).rejects.toMatchObject({
        code,
        hint: expect.stringContaining(suggestion),
      });
      await expect(s.setup.execute({ ...run, ...selection })).rejects.toMatchObject({ code });
      expect(s.prompter.questions).toEqual([]);
      expect(s.h.localStore.writes).toEqual([]);
      expect(s.h.process.calls).toEqual([]);
    },
  );

  it('accepts declared disabled tools and tools without setup recipes', async () => {
    const s = await stage({
      tools:
        'schema_version: 2\ntools: [{name: disabled, enabled: false}, {name: standalone, auth: {command: []}}]\n',
    });
    for (const tool of ['disabled', 'standalone'])
      expect(await s.setup.plan({ tools: [tool], envs: ['test'] })).toMatchObject({
        steps: [],
        problems: [],
      });
  });

  it('lists the plan without running anything', async () => {
    const s = await stage();
    const plan = await s.setup.plan({});
    expect(plan.steps.map((x) => x.id)).toEqual([
      'bitbucket-cli.login',
      'kubectl.kubeconfig@dev',
      'kubectl.access@dev',
      'kubectl.kubeconfig@test',
      'kubectl.access@test',
      'worklog.token',
    ]);
    expect(s.h.process.calls).toEqual([]);
  });

  it('previews an untrusted check without prompting or recording trust', async () => {
    const s = await stage();
    const out = await s.setup.execute({ ...run, dryRun: true, tools: ['worklog'] });
    expect(out.items).toEqual([
      expect.objectContaining({ id: 'worklog.token', result: 'would_ask' }),
    ]);
    expect(s.prompter.questions).toEqual([]);
    expect(s.trust.entries).toEqual([]);
    expect(s.h.process.calls).toEqual([]);
  });

  it('verifies first, runs a run step after confirmation, and blocks what depends on an undone step', async () => {
    const s = await stage();
    await s.h.fs.writeText(`${HOME}/.kube/dev`, 'k');
    s.prompter.confirmWith = true;
    const out = await s.setup.execute({ ...run, envs: ['dev'], skipManual: true });
    expect(out.items.map((r) => [r.id, r.result])).toEqual([
      ['bitbucket-cli.login', 'done'],
      ['kubectl.kubeconfig@dev', 'verified'],
      ['kubectl.access@dev', 'skipped'],
      ['worklog.token', 'skipped'],
    ]);
    const login = s.h.process.calls.find((c) => c.vector[1] === 'auth' && c.vector[2] === 'login');
    expect(login?.options.interactive).toBe(true);
    expect(s.prompter.questions.some((q) => q.includes('bitbucket-cli auth login'))).toBe(true);

    const s2 = await stage();
    s2.loggedIn = true;
    const blocked = await s2.setup.execute({
      ...run,
      envs: ['test'],
      tools: ['kubectl'],
      dryRun: true,
    });
    expect(blocked.items.map((r) => [r.id, r.result])).toEqual([
      ['kubectl.kubeconfig@test', 'would_ask'],
      ['kubectl.access@test', 'blocked'],
    ]);
  });

  it('walks a manual step: explain, wait, verify, acknowledge; and never acknowledges a failed one', async () => {
    const s = await stage({ local: { scope: { envs: ['dev'] } } });
    s.loggedIn = true;
    s.prompter.pause = async (message: string): Promise<void> => {
      s.prompter.questions.push(message);
      if (message.includes('kubectl.kubeconfig@dev'))
        await s.h.fs.writeText(`${HOME}/.kube/dev`, 'k');
    };
    s.prompter.confirmWith = true;
    const out = await s.setup.execute(run);
    expect(out.items.map((r) => [r.id, r.result])).toEqual([
      ['bitbucket-cli.login', 'verified'],
      ['kubectl.kubeconfig@dev', 'done'],
      ['kubectl.access@dev', 'failed'],
      ['worklog.token', 'failed'],
    ]);
    expect(out.items[2]?.detail).toBe('forbidden');
    const local = await s.h.localStore.read('fx');
    expect(Object.keys(local.setup ?? {})).toEqual(['kubectl.kubeconfig@dev']);
    expect(local.setup?.['kubectl.kubeconfig@dev']?.acknowledged).toBe('2026-09-01T00:00:00.000Z');
    expect(out.summary).toMatchObject({ verified: 1, done: 1, failed: 2 });
  });

  it('with nobody to ask, turns the undone human steps into LOGIN_REQUIRED with a handoff', async () => {
    const s = await stage({ unavailable: true });
    const failure = await s.setup
      .execute({ ...run, noInput: true, envs: ['test'], tools: ['bitbucket-cli', 'kubectl'] })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DevkitError);
    const err = failure as DevkitError;
    expect(err.code).toBe('LOGIN_REQUIRED');
    expect(err.category).toBe('config');
    expect(err.handoff?.userSteps.map((u) => [u.id, u.kind])).toEqual([
      ['bitbucket-cli.login', 'run'],
      ['kubectl.kubeconfig@test', 'file'],
    ]);
    expect(err.handoff?.userSteps[0]?.command).toEqual(['bitbucket-cli', 'auth', 'login']);
    expect(err.handoff?.userSteps[1]?.expects).toEqual({ path: '~/.kube/test' });
    expect(err.handoff?.command).toBe('fx login bitbucket-cli kubectl --env test');
    expect(s.h.process.calls.every((c) => c.options.interactive !== true)).toBe(true);
    expect(s.h.localStore.writes).toEqual([]);
  });

  it('with --yes and nobody to ask, runs the run steps through pipes and hands off only the rest', async () => {
    const s = await stage({ unavailable: true, yes: true });
    const failure = await s.setup
      .execute({ ...run, noInput: true, envs: ['test'], tools: ['bitbucket-cli', 'kubectl'] })
      .catch((e: unknown) => e);
    const login = s.h.process.calls.find((c) => c.vector[2] === 'login');
    expect(login?.options.interactive).toBe(false);
    expect((failure as DevkitError).handoff?.userSteps.map((u) => u.id)).toEqual([
      'kubectl.kubeconfig@test',
    ]);
  });

  it('resumes after human completion without rerunning already-valid setup', async () => {
    const s = await stage({ unavailable: true, yes: true });
    const input = { ...run, noInput: true, envs: ['test'], tools: ['bitbucket-cli', 'kubectl'] };
    await expect(s.setup.execute(input)).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    await s.h.fs.writeText(`${HOME}/.kube/test`, 'existing user configuration');
    s.h.process
      .clear()
      .on(['bitbucket-cli', 'auth', 'status'], { code: 0, stdout: '', stderr: '' })
      .on(['kubectl'], { code: 0, stdout: 'yes', stderr: '' });
    const callsBeforeResume = s.h.process.calls.length;
    const out = await s.setup.execute(input);
    expect(out.items.map((item) => item.result)).toEqual(['verified', 'verified', 'verified']);
    expect(
      s.h.process.calls.slice(callsBeforeResume).some((call) => call.vector.includes('login')),
    ).toBe(false);
    expect(await s.h.fs.readText(`${HOME}/.kube/test`)).toBe('existing user configuration');
    expect(s.h.localStore.writes).toEqual([]);
  });

  it.each(['network unreachable', 'configuration missing', 'forbidden: missing scope'])(
    'preserves the failed verification cause for focused diagnosis: %s',
    async (reason) => {
      const s = await stage();
      s.h.process.clear().on(['bitbucket-cli', 'auth', 'status'], {
        code: 1,
        stdout: '',
        stderr: reason,
      });
      const plan = await s.setup.plan({ tools: ['bitbucket-cli'] });
      expect(await new Verifier(s.h.deps, s.deps).verify(plan.steps[0]!)).toEqual({
        ok: false,
        detail: reason,
      });
      expect(s.h.process.calls).toHaveLength(1);
      expect(s.h.localStore.writes).toEqual([]);
    },
  );

  it('asks which environments once, writes the answer, and does not ask without a person', async () => {
    const s = await stage({ local: {} });
    s.loggedIn = true;
    s.prompter.answers = ['test', 'test'];
    const out = await s.setup.execute({ ...run, dryRun: true, tools: ['kubectl'] });
    expect(out.items.map((r) => r.id)).toEqual(['kubectl.kubeconfig@test', 'kubectl.access@test']);
    expect(s.h.localStore.writes, 'dry run: chosen but not written').toEqual([]);
    await s.setup.execute({ ...run, tools: ['kubectl'], skipManual: true });
    expect((await s.h.localStore.read('fx')).scope?.envs).toEqual(['test']);

    const quiet = await stage({ local: {}, unavailable: true });
    quiet.loggedIn = true;
    await quiet.setup.execute({ ...run, noInput: true, dryRun: true, tools: ['kubectl'] });
    expect(quiet.reporter().map((n) => n.code)).toContain('SCOPE_ENVS_UNSET');
    expect(quiet.prompter.questions).toEqual([]);
  });

  it('keeps dynamic all when guided environment selection is left empty', async () => {
    const s = await stage({ local: {} });
    s.loggedIn = true;
    s.prompter.answers = [''];
    await s.setup.execute({ ...run, tools: ['kubectl'], skipManual: true });
    expect((await s.h.localStore.read('fx')).scope?.envs).toBeUndefined();
    expect(s.h.localStore.writes).toEqual([]);
  });

  it('respects read-only posture after verifying', async () => {
    const s = await stage();
    await expect(
      s.setup.execute({
        ...run,
        tools: ['bitbucket-cli'],
        posture: { readOnly: true, source: 'env' },
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(s.h.process.calls.map((c) => c.vector.join(' '))).toEqual(['bitbucket-cli auth status']);
  });
});
