// The one step Prometheus needs in each environment when the manifest declares no
// service: the context its own wizard writes, named after the environment.

import type { SetupRecipe } from '../../../domain/setup/types.js';

import { answers, BINARY } from './service.js';

export const PROMETHEUS_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'context',
    tool: BINARY,
    perEnv: true,
    kind: 'run',
    phase: 'authenticate',
    title: 'Add the Prometheus context "{context}" for {env}',
    instructions:
      'The wizard asks for the server URL of the {env} Prometheus and, only where a gateway in front of it requires one, a credential.',
    run: ['config', 'init', '--context', '{context}'],
    verify: answers(['--use-context', '{context}']),
  },
];
