// The one step OpenObserve needs in each environment: the context its own
// wizard writes, named after the environment.

import type { SetupRecipe } from '../../../domain/setup/types.js';

export const OPENOBSERVE_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'context',
    tool: 'openobserve-cli',
    perEnv: true,
    kind: 'run',
    phase: 'authenticate',
    title: 'Add the OpenObserve context "{context}" for {env}',
    instructions:
      'The wizard asks for the server URL, organization and credentials of the {env} OpenObserve.',
    run: ['config', 'init', '--context', '{context}'],
    // `auth status` exits zero when nobody is signed in, so only `authenticated` tells.
    verify: {
      command: ['auth', 'status', '--use-context', '{context}'],
      json: { path: 'authenticated', equals: true, reason: 'error' },
    },
  },
];
