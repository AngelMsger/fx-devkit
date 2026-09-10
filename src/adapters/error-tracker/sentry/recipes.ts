// The one step Sentry needs: a token, either made by the CLI through the
// browser or pasted from the settings page.

import type { SetupRecipe } from '../../../domain/setup/types.js';

import { BINARY } from './client.js';

export const SENTRY_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'login',
    tool: BINARY,
    perEnv: false,
    kind: 'run',
    title: 'Log in to Sentry',
    open: 'https://{host}/settings/account/api/auth-tokens/',
    instructions:
      '`sentry auth login` opens the browser to authorize, or paste a token made on the page above.',
    run: ['auth', 'login'],
    verify: { command: ['auth', 'status'] },
  },
];
