// Recipes come from the providers the manifest bound: workspace-scoped ones
// with the binding's variables, platform instances with theirs and the
// platform's name so the planner can expand them per environment.

import { planSetup, type RecipeSource } from '../../domain/setup/planner.js';
import type { SetupPlan } from '../../domain/setup/types.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { LoginDeps } from './deps.js';
import { validateSetupSelection } from './selection.js';

export interface PlanSelection {
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
  readonly scopeEnvs: readonly string[] | undefined;
}

export function collectRecipes(deps: WorkspaceDeps, setup: LoginDeps): RecipeSource[] {
  const sources: RecipeSource[] = [];
  for (const binding of deps.ctx.bindings) {
    if (binding.provider === null) continue;
    for (const recipe of setup.describeProvider(binding.provider)?.recipes ?? [])
      sources.push({ recipe, vars: binding.vars });
  }
  for (const binding of deps.ctx.platforms) {
    if (binding.provider === null) continue;
    for (const recipe of setup.describeProvider(binding.provider)?.recipes ?? [])
      sources.push({ recipe, vars: binding.vars, platform: binding.platform });
  }
  return sources;
}

export function buildPlan(
  deps: WorkspaceDeps,
  setup: LoginDeps,
  selection: PlanSelection,
): SetupPlan {
  validateSetupSelection(deps.ctx, selection);
  const providerTools = [...deps.ctx.bindings, ...deps.ctx.platforms].flatMap((binding) =>
    binding.provider === null ? [] : (setup.describeProvider(binding.provider)?.tools ?? []),
  );
  return planSetup({
    tools: toolchainOf(deps.ctx).tools,
    recipes: collectRecipes(deps, setup),
    providerTools,
    environments: deps.ctx.manifest.environments?.result.doc,
    scopeEnvs: selection.scopeEnvs,
    filter: { tools: selection.tools, envs: selection.envs },
  });
}
