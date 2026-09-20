import { expect, it } from 'vitest';

import { larkProvider } from '../../../../src/adapters/im/lark/provider.js';
import { larkWikiProvider } from '../../../../src/adapters/knowledge-base/lark-wiki/provider.js';
import { collectRecipes } from '../../../../src/application/login/collect.js';
import { toolchainOf } from '../../../../src/application/tool/toolchain.js';
import { planSetup } from '../../../../src/domain/setup/planner.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness } from '../../../fakes/workspace.js';

// lark-cli serves both `im` and `knowledge-base`. A step's identity is its tool and id, so
// two providers sharing one CLI would withhold each other's steps if they named them alike.
it('plans one lark-cli setup per capability without colliding on a step identity', async () => {
  const h = await harness({
    workspace:
      'schema_version: 2\nproviders: {code-host: {provider: local-git, vars: {host: /host}}, im: {provider: lark}, knowledge-base: {provider: lark-wiki, vars: {space: TEAM}}}\ndefaults: {upstream_project: fx, branch: main}\nrepos: [{name: sample}]\n',
  });
  const login = fakeLoginDeps({ lark: larkProvider, 'lark-wiki': larkWikiProvider });
  const plan = planSetup({
    tools: toolchainOf(h.deps.ctx).tools,
    recipes: collectRecipes(h.deps, login),
    providerTools: ['lark-cli'],
    environments: undefined,
    scopeEnvs: undefined,
  });
  expect(plan.problems).toEqual([]);
  expect(plan.steps.map((step) => step.id).sort()).toEqual([
    'lark-cli.access',
    'lark-cli.wiki-access',
  ]);
});
