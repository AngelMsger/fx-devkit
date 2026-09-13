// The one step Bitbucket needs: an access token, with the scopes fx uses named
// in the instructions and the page that issues one linked.

import type { SetupRecipe } from '../../../domain/setup/types.js';

export const BITBUCKET_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'credential',
    tool: 'bitbucket-cli',
    perEnv: false,
    kind: 'run',
    title: 'Store a Bitbucket access token',
    open: '{web}/plugins/servlet/access-tokens/manage',
    instructions:
      'Create an HTTP access token with Project read and Repository read (add Repository write to open pull requests), then paste it when asked. Run `bitbucket-cli config init` first if the server URL is not set yet.',
    run: ['auth', 'login'],
    verify: { command: ['auth', 'status'], json: { path: 'configured', equals: true } },
  },
];
