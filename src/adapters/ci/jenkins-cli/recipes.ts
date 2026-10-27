// The one step Jenkins needs: an API token, which its CLI prompts for.

import type { SetupRecipe } from '../../../domain/setup/types.js';

export const JENKINS_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'login',
    tool: 'jenkins-cli',
    perEnv: false,
    kind: 'run',
    phase: 'authenticate',
    title: 'Log in to Jenkins',
    instructions:
      'Prompts for your user name and an API token (Jenkins: your profile → Configure → API Token).',
    run: ['auth', 'login'],
    // `auth status` exits zero when nobody is signed in, so only `authenticated` tells.
    verify: {
      command: ['auth', 'status'],
      json: { path: 'authenticated', equals: true, reason: 'error' },
    },
  },
];
