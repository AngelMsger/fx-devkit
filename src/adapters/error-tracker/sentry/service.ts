// Sentry discovers public workspace defaults, while authentication stays native.
import type { ServiceSettings } from '../../../domain/manifest/service.schema.js';
import type { ServiceDefinition } from '../../../domain/setup/service.js';

export function sentryService(settings: ServiceSettings): ServiceDefinition {
  const url = settings.base_url ?? '';
  const token = settings.auth_scheme === 'token';
  const credentialUrl =
    settings.credential_url ?? `${url.replace(/\/+$/, '')}/settings/account/api/auth-tokens/`;
  return {
    preparation: {
      kind: 'file',
      relative: '.sentryclirc',
      publicDefaults: { url, org: settings.org ?? '' },
      text: `# fx:service public defaults; personal credentials must stay outside this file\n[defaults]\nurl = ${url}\norg = ${settings.org ?? ''}\n`,
    },
    env: { SENTRY_URL: url, SENTRY_HOST: url, SENTRY_ORG: settings.org ?? '' },
    recipes: [
      {
        id: 'credential',
        tool: 'sentry',
        perEnv: false,
        kind: token ? 'manual' : 'run',
        phase: 'authenticate',
        title: 'Sign in to the shared Sentry instance with your own account',
        instructions: token
          ? 'Create a personal token with the scopes needed for the requested operation, then save it through the Sentry CLI in your own terminal. Do not put the token in chat or the manifest. Browser sign-in alone does not authenticate the CLI.'
          : 'Complete personal device/browser authorization. If the server rejects the OAuth client (invalid_client), use a personal token from the linked page and configure service.auth_scheme: token for this instance; do not repeat the same device flow. The manifest never contains a personal token.',
        open: credentialUrl,
        ...(token ? {} : { run: ['auth', 'login', '--url', url] }),
        verify: { command: ['auth', 'status'] },
      },
    ],
  };
}
