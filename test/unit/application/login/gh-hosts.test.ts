import { expect, it } from 'vitest';

import { githubActionsProvider } from '../../../../src/adapters/ci/github-actions/provider.js';
import { githubProvider } from '../../../../src/adapters/code-host/github/provider.js';
import { collectRecipes } from '../../../../src/application/login/collect.js';
import { toolchainOf } from '../../../../src/application/tool/toolchain.js';
import { planSetup } from '../../../../src/domain/setup/planner.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness, MANIFEST_DIR } from '../../../fakes/workspace.js';

// gh signs in per host, so its sign-in step names the host each binding uses: the code
// host and Actions on one host share a step, and a second host gets a step of its own.
async function plan(host: string, repository: string) {
  const h = await harness({
    workspace: `schema_version: 2\nproviders: {code-host: {provider: github, vars: {host: '${host}'}}}\ndefaults: {upstream_project: octo, branch: main}\nrepos: [{name: tool}]\n`,
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: `schema_version: 2\nplatforms:\n  actions: {provider: github-actions, capability: ci, vars: {repository: '${repository}'}}\nenvs:\n  prod: {platforms: {actions: {vars: {workflow: ci.yml}}}}\n`,
    },
  });
  const login = fakeLoginDeps({ github: githubProvider, 'github-actions': githubActionsProvider });
  return planSetup({
    tools: toolchainOf(h.deps.ctx).tools,
    recipes: collectRecipes(h.deps, login),
    providerTools: ['gh'],
    environments: h.deps.ctx.manifest.environments?.result.doc,
    scopeEnvs: undefined,
  });
}

it('plans one sign-in for a code host and Actions on github.com, checked on that host alone', async () => {
  const { steps, problems } = await plan('https://github.com', 'octo/{repo}');
  expect(problems).toEqual([]);
  expect(steps).toEqual([
    expect.objectContaining({
      id: 'gh.login-github.com',
      title: 'Log in to GitHub at github.com',
      run: ['gh', 'auth', 'login', '--hostname', 'github.com'],
      verify: { command: ['gh', 'auth', 'status', '--active', '--hostname', 'github.com'] },
    }),
  ]);
});

it('plans a sign-in per host when the code host is a GitHub Enterprise server', async () => {
  const { steps, problems } = await plan('ssh://git@github.example.com', 'octo/{repo}');
  expect(problems).toEqual([]);
  expect(steps.map((step) => step.verify)).toEqual([
    { command: ['gh', 'auth', 'status', '--active', '--hostname', 'github.example.com'] },
    { command: ['gh', 'auth', 'status', '--active', '--hostname', 'github.com'] },
  ]);
  const same = await plan('https://github.example.com', 'github.example.com/octo/{repo}');
  expect(same.steps.map((step) => step.id)).toEqual(['gh.login-github.example.com']);
});
