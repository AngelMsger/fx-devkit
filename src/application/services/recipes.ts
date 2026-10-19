// Expand service configuration and personal login separately from one binding.
import { serviceVars, type ServiceSettings } from '../../domain/manifest/service.schema.js';
import { SERVICE_RECIPE_ID } from '../../domain/setup/names.js';
import type { RecipeSource } from '../../domain/setup/planner.js';
import type { Vars } from '../../domain/template.js';
import type { ProviderDescriptor } from '../../ports/provider.js';

export function serviceRecipes(input: {
  readonly descriptor: ProviderDescriptor<unknown>;
  readonly settings: ServiceSettings;
  readonly vars: Vars;
  readonly env?: string;
}): RecipeSource[] {
  const { descriptor, settings } = input;
  const definition = descriptor.service?.(settings);
  if (!definition) return [];
  const tool = descriptor.tools[0]!;
  const prep = definition.preparation;
  const common = {
    vars: { ...input.vars, ...serviceVars(settings) },
    ...(input.env ? { env: input.env } : {}),
    ...(definition.env ? { executionEnv: definition.env } : {}),
  };
  return [
    {
      ...common,
      preparation: prep,
      recipe: {
        id: SERVICE_RECIPE_ID,
        tool,
        perEnv: false,
        kind: 'run',
        phase: 'prepare',
        title: `Prepare public ${tool} service settings`,
        instructions:
          'Only public service settings are distributed. Each member obtains and stores their own credentials using the companion CLI.',
        ...(prep.kind === 'command' ? { run: prep.command } : {}),
        verify:
          prep.kind === 'command'
            ? { command: [...prep.agrees, '--dry-run'], json: { path: 'changed', equals: false } }
            : { file: prep.relative },
      },
    },
    ...definition.recipes.map((recipe) => ({
      ...common,
      recipe: {
        ...recipe,
        perEnv: false,
        requires: [SERVICE_RECIPE_ID, ...(recipe.requires ?? [])],
      },
    })),
  ];
}
