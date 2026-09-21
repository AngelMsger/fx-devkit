import { describe, expect, it } from 'vitest';

import { KUBECTL_RECIPES } from '../../../../src/adapters/cluster/kubectl/recipes.js';
import type { Environments } from '../../../../src/domain/manifest/types.js';
import { planSetup, type RecipeSource } from '../../../../src/domain/setup/planner.js';
import type { SetupRecipe } from '../../../../src/domain/setup/types.js';
import type { ResolvedTool } from '../../../../src/domain/toolchain/resolve.js';

function tool(name: string, extra: Partial<ResolvedTool> = {}): ResolvedTool {
  return {
    name,
    binary: name,
    required: false,
    enabled: true,
    declared: false,
    versionArgs: ['--version'],
    install: [],
    setup: [],
    origins: {
      binary: 'base',
      versionArgs: 'base',
      install: 'base',
      skill: 'base',
      auth: 'base',
      setup: 'patch',
    },
    patchedFields: [],
    baseFields: [],
    ...extra,
  };
}

const kubeconfig: SetupRecipe = {
  id: 'kubeconfig',
  tool: 'kubectl',
  perEnv: true,
  kind: 'file',
  title: 'Kubeconfig for {env}',
  open: '{setup.source}',
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
    command: ['--context', '{context}', 'auth', 'can-i', 'get', 'pods', '-n', '{namespace}'],
  },
  requires: ['kubeconfig'],
  defaults: { namespace: 'default' },
};
const login: SetupRecipe = {
  id: 'login',
  tool: 'bitbucket-cli',
  perEnv: false,
  kind: 'run',
  phase: 'authenticate',
  title: 'Log in',
  open: '{web}/tokens',
  run: ['auth', 'login'],
  verify: { command: ['auth', 'status'] },
};

const environments: Environments = {
  schema_version: 1,
  platforms: { kube: { vars: { namespace: 'platform-ns' } }, sentry: {} },
  envs: {
    dev: {
      platforms: {
        kube: {
          vars: { kubeconfig: '~/.kube/dev', context: 'dev' },
          setup: { source: 'https://rancher.example.com/dev' },
        },
      },
    },
    test: {
      platforms: {
        kube: { vars: { kubeconfig: '~/.kube/test', context: 'test', namespace: 'apps' } },
      },
    },
    selfhosted: { platforms: { sentry: {} } },
  },
};

const kube = (recipe: SetupRecipe): RecipeSource => ({
  recipe,
  vars: { namespace: 'platform-ns' },
  platform: 'kube',
});

describe('planSetup', () => {
  it('reports conflicting platform steps and withholds their dependent actions', () => {
    const shared = { platforms: { alpha: {}, beta: {} } };
    const plan = planSetup({
      tools: [tool('kubectl')],
      recipes: ['alpha', 'beta'].flatMap((platform) =>
        KUBECTL_RECIPES.map((recipe) => ({
          recipe,
          platform,
          vars: { context: platform, kubeconfig: `/${platform}` },
        })),
      ),
      providerTools: ['kubectl'],
      environments: { schema_version: 2, platforms: shared.platforms, envs: { test: shared } },
      scopeEnvs: undefined,
    });
    expect(plan.steps).toEqual([]);
    expect(plan.problems).toMatchObject([
      { step: 'kubectl.kubeconfig@test', reason: 'step_conflict' },
      { step: 'kubectl.access@test', reason: 'step_conflict' },
    ]);

    const dependent = planSetup({
      tools: [tool('bitbucket-cli')],
      recipes: [
        { recipe: login, vars: { web: 'https://first.example.com' } },
        { recipe: login, vars: { web: 'https://second.example.com' } },
        {
          recipe: { ...login, id: 'after', requires: ['login'] },
          vars: { web: 'https://first.example.com' },
        },
      ],
      providerTools: ['bitbucket-cli'],
      environments: undefined,
      scopeEnvs: undefined,
    });
    expect(dependent.steps).toEqual([]);
    expect(dependent.problems).toMatchObject([
      { step: 'bitbucket-cli.login', reason: 'step_conflict' },
      { step: 'bitbucket-cli.after', reason: 'requires_unknown' },
    ]);
  });

  it('coalesces identical shared recipes without changing stable step identities', () => {
    const source = { recipe: login, vars: { web: 'https://git.example.com' } };
    const plan = planSetup({
      tools: [tool('bitbucket-cli')],
      recipes: [source, source],
      providerTools: ['bitbucket-cli'],
      environments: undefined,
      scopeEnvs: undefined,
    });
    expect(plan.problems).toEqual([]);
    expect(plan.steps.map((step) => step.id)).toEqual(['bitbucket-cli.login']);
  });

  it('expands a per-environment recipe over the environments that declare its platform, in their order', () => {
    const plan = planSetup({
      tools: [tool('kubectl')],
      recipes: [kube(kubeconfig)],
      providerTools: ['kubectl'],
      environments,
      scopeEnvs: undefined,
    });
    expect(plan.problems).toEqual([]);
    expect(plan.steps.map((s) => s.id)).toEqual([
      'kubectl.kubeconfig@dev',
      'kubectl.kubeconfig@test',
    ]);
    expect(plan.steps[0]).toMatchObject({
      tool: 'kubectl',
      env: 'dev',
      kind: 'file',
      title: 'Kubeconfig for dev',
      open: 'https://rancher.example.com/dev',
      expects: { path: '~/.kube/dev' },
      verify: { file: '~/.kube/dev' },
      origin: 'base',
      required: false,
    });
    expect(
      plan.steps[1]?.open,
      'no setup.source in test: the page is left out, the step stays',
    ).toBeUndefined();
  });

  it('honours scope, filters, and merges variables environment over platform over defaults', () => {
    const plan = planSetup({
      tools: [tool('kubectl')],
      recipes: [kube(kubeconfig), kube(access)],
      providerTools: ['kubectl'],
      environments,
      scopeEnvs: ['test', 'selfhosted'],
    });
    expect(plan.steps.map((s) => s.id)).toEqual(['kubectl.kubeconfig@test', 'kubectl.access@test']);
    expect(plan.steps[1]?.verify).toEqual({
      command: ['kubectl', '--context', 'test', 'auth', 'can-i', 'get', 'pods', '-n', 'apps'],
    });
    expect(plan.steps[1]?.requires).toEqual(['kubectl.kubeconfig@test']);

    const dev = planSetup({
      tools: [tool('kubectl')],
      recipes: [kube(access)],
      providerTools: ['kubectl'],
      environments,
      scopeEnvs: undefined,
      filter: { envs: ['dev'] },
    });
    expect(dev.steps.map((s) => s.id)).toEqual(['kubectl.access@dev']);
    expect((dev.steps[0]?.verify as { command: string[] }).command).toContain('platform-ns');
    expect(dev.problems).toEqual([
      {
        step: 'kubectl.access@dev',
        reason: 'requires_unknown',
        detail: 'kubectl.kubeconfig@dev is not in the plan',
      },
    ]);
  });

  it('drops a step whose executable fields lack a variable, and reports it', () => {
    const noContext: Environments = {
      ...environments,
      envs: { dev: { platforms: { kube: { vars: { kubeconfig: '~/.kube/dev' } } } } },
    };
    const plan = planSetup({
      tools: [tool('kubectl')],
      recipes: [kube(access)],
      providerTools: ['kubectl'],
      environments: noContext,
      scopeEnvs: undefined,
    });
    expect(plan.steps).toEqual([]);
    expect(plan.problems).toEqual([
      {
        step: 'kubectl.access@dev',
        reason: 'missing_vars',
        detail: '{context} not supplied by the manifest',
      },
    ]);
  });

  it('makes one step of a workspace-scoped recipe, and includes the team steps from tools.yaml as patch', () => {
    const worklog = tool('worklog-cli', {
      binary: 'worklog',
      setup: [
        {
          id: 'token',
          kind: 'manual',
          title: 'Get a JWT',
          open: 'https://form.example.com/',
          verify: { command: ['auth', 'status'] },
        },
      ],
    });
    const plan = planSetup({
      tools: [tool('bitbucket-cli', { required: true }), worklog],
      recipes: [
        {
          recipe: login,
          vars: { host: 'ssh://git@git.example.com', web: 'https://git.example.com' },
        },
      ],
      providerTools: ['bitbucket-cli'],
      environments: undefined,
      scopeEnvs: undefined,
    });
    expect(plan.steps.map((s) => [s.id, s.origin])).toEqual([
      ['bitbucket-cli.login', 'base'],
      ['worklog-cli.token', 'patch'],
    ]);
    expect(plan.steps[0]).toMatchObject({
      run: ['bitbucket-cli', 'auth', 'login'],
      open: 'https://git.example.com/tokens',
      verify: { command: ['bitbucket-cli', 'auth', 'status'] },
      required: true,
    });
    expect(plan.steps[1]).toMatchObject({
      verify: { command: ['worklog', 'auth', 'status'] },
      required: false,
    });
  });

  it('uses auth.command as the fallback readiness step only when no provider owns the tool', () => {
    const standalone = tool('standalone', {
      auth: { command: ['auth', 'status'], docs: 'https://docs.example.com/auth' },
      origins: {
        binary: 'patch',
        versionArgs: 'base',
        install: 'base',
        skill: 'base',
        auth: 'patch',
        setup: 'base',
      },
    });
    const fallback = planSetup({
      tools: [standalone],
      recipes: [],
      providerTools: [],
      environments: undefined,
      scopeEnvs: undefined,
    });
    expect(fallback.steps).toEqual([
      expect.objectContaining({
        id: 'standalone.auth',
        kind: 'manual',
        open: 'https://docs.example.com/auth',
        verify: { command: ['standalone', 'auth', 'status'] },
        origin: 'patch',
      }),
    ]);

    const providerOwned = planSetup({
      tools: [standalone],
      recipes: [{ recipe: { ...login, tool: 'standalone' }, vars: {} }],
      providerTools: ['standalone'],
      environments: undefined,
      scopeEnvs: undefined,
    });
    expect(providerOwned.steps.map((step) => step.id)).toEqual(['standalone.login']);
  });

  it('skips disabled tools, flags recipes for unknown tools, and filters by tool', () => {
    const plan = planSetup({
      tools: [tool('bitbucket-cli', { enabled: false }), tool('kubectl')],
      recipes: [
        { recipe: login, vars: { web: 'x' } },
        kube(kubeconfig),
        { recipe: { ...login, tool: 'ghost' }, vars: {} },
      ],
      providerTools: ['bitbucket-cli', 'kubectl'],
      environments,
      scopeEnvs: undefined,
      filter: { tools: ['kubectl'] },
    });
    expect(plan.steps.map((s) => s.tool)).toEqual(['kubectl', 'kubectl']);
    expect(plan.problems).toEqual([
      { step: 'ghost.login', reason: 'tool_unknown', detail: 'ghost is not in the toolchain' },
    ]);
  });

  it('orders required tools first, prerequisites before dependants, and reports a cycle', () => {
    const a: SetupRecipe = {
      id: 'a',
      tool: 'opt',
      perEnv: false,
      kind: 'manual',
      title: 'a',
      verify: { file: '/a' },
      requires: ['b'],
    };
    const b: SetupRecipe = { ...a, id: 'b', requires: [] };
    const plan = planSetup({
      tools: [tool('opt'), tool('req', { required: true })],
      recipes: [
        { recipe: a, vars: {} },
        { recipe: b, vars: {} },
        { recipe: { ...b, id: 'r', tool: 'req' }, vars: {} },
      ],
      providerTools: ['opt', 'req'],
      environments: undefined,
      scopeEnvs: undefined,
    });
    expect(plan.steps.map((s) => s.id)).toEqual(['req.r', 'opt.b', 'opt.a']);

    const cyclic = planSetup({
      tools: [tool('opt')],
      recipes: [
        { recipe: a, vars: {} },
        { recipe: { ...b, requires: ['a'] }, vars: {} },
      ],
      providerTools: ['opt'],
      environments: undefined,
      scopeEnvs: undefined,
    });
    expect(cyclic.steps).toHaveLength(2);
    expect(cyclic.problems.map((p) => p.reason)).toEqual(['requires_cycle']);
  });
});
