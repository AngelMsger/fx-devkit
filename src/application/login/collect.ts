// Recipes come from the providers the manifest bound: workspace-scoped ones
// with the binding's variables, platform instances with theirs and the
// platform's name so the planner can expand them per environment.

import { planSetup, type RecipeSource } from '../../domain/setup/planner.js';
import type { SetupPlan } from '../../domain/setup/types.js';
import { serviceRecipes } from '../services/recipes.js';
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
    const descriptor = setup.describeProvider(binding.provider);
    if (binding.service && descriptor) {
      sources.push(
        ...serviceRecipes({ descriptor, settings: binding.service, vars: binding.vars }),
      );
      continue;
    }
    for (const recipe of setup.describeProvider(binding.provider)?.recipes ?? [])
      sources.push({ recipe, vars: binding.vars });
  }
  for (const binding of deps.ctx.platforms) {
    if (binding.provider === null) continue;
    const descriptor = setup.describeProvider(binding.provider);
    const envs = Object.entries(deps.ctx.manifest.environments?.result.doc.envs ?? {});
    if (
      descriptor &&
      (binding.service || envs.some(([, env]) => env.platforms?.[binding.platform]?.service))
    ) {
      for (const [env, spec] of envs) {
        const onEnv = spec.platforms?.[binding.platform];
        if (!onEnv) continue;
        if (!binding.service && !onEnv.service) {
          const vars = {
            ...binding.vars,
            ...onEnv.vars,
            env,
            ...Object.fromEntries(
              Object.entries(onEnv.setup ?? {}).map(([key, value]) => [`setup.${key}`, value]),
            ),
          };
          sources.push(
            ...descriptor.recipes.map((recipe) => ({
              recipe: { ...recipe, perEnv: false },
              vars,
              env,
            })),
          );
          continue;
        }
        sources.push(
          ...serviceRecipes({
            descriptor,
            settings: { ...binding.service, ...onEnv.service },
            vars: { ...binding.vars, ...onEnv.vars },
            env,
          }),
        );
      }
      continue;
    }
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
    recipes: collectRecipes(deps, setup).filter(
      (source) =>
        source.env === undefined ||
        ((!selection.envs || selection.envs.includes(source.env)) &&
          (!selection.scopeEnvs || selection.scopeEnvs.includes(source.env))),
    ),
    providerTools,
    environments: deps.ctx.manifest.environments?.result.doc,
    scopeEnvs: selection.scopeEnvs,
    filter: { tools: selection.tools, envs: selection.envs },
  });
}
