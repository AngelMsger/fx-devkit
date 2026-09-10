// The one step OpenObserve needs in each environment: the context its own
// wizard writes, named after the environment.

import type { SetupRecipe } from '../../../domain/setup/types.js';

export const OPENOBSERVE_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'context',
    tool: 'openobserve-cli',
    perEnv: true,
    kind: 'run',
    title: 'Add the OpenObserve context "{context}" for {env}',
    instructions:
      'The wizard asks for the server URL, organization and credentials of the {env} OpenObserve.',
    run: ['config', 'init', '--context', '{context}'],
    verify: { command: ['auth', 'status', '--use-context', '{context}'] },
  },
];
