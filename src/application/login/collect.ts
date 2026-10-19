// Recipes come from the providers the manifest bound: workspace-scoped ones
// with the binding's variables, platform instances with theirs and the
// platform's name so the planner can expand them per environment.

import { setupVars } from '../../domain/setup/names.js';
import { planSetup, type RecipeSource } from '../../domain/setup/planner.js';
import type { SetupPlan } from '../../domain/setup/types.js';
import type { Vars } from '../../domain/template.js';
import type { ProviderDescriptor } from '../../ports/provider.js';
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
    sources.push(...sourcesOf(descriptor, binding.vars));
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
          const vars = recipeVars(descriptor, {
            ...binding.vars,
            ...onEnv.vars,
            env,
            ...setupVars(onEnv.setup),
          });
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
    sources.push(...sourcesOf(descriptor, binding.vars, binding.platform));
  }
  return sources;
}

// A provider's recipes read the binding's variables and what the provider derives from them.
function recipeVars(descriptor: ProviderDescriptor<unknown> | undefined, vars: Vars): Vars {
  return { ...vars, ...descriptor?.recipeVars?.(vars) };
}

function sourcesOf(
  descriptor: ProviderDescriptor<unknown> | undefined,
  vars: Vars,
  platform?: string,
): RecipeSource[] {
  const all = recipeVars(descriptor, vars);
  return (descriptor?.recipes ?? []).map((recipe) => ({ recipe, vars: all, platform }));
}

export function buildPlan(
  deps: WorkspaceDeps,
  setup: LoginDeps,
  selection: PlanSelection,
): SetupPlan {
  validateSetupSelection(deps.ctx, selection, deps.commandShell);
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
