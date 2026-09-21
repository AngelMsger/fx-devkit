// Sentry discovers public workspace defaults, while authentication stays native.
import type { ServiceSettings } from '../../../domain/manifest/service.schema.js';
import type { ServiceDefinition } from '../../../domain/setup/service.js';

export function sentryService(settings: ServiceSettings): ServiceDefinition {
  const url = settings.base_url ?? '';
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
        kind: 'run',
        phase: 'authenticate',
        title: 'Sign in to the shared Sentry instance with your own account',
        instructions:
          'Complete the personal device/browser authorization. The manifest supplies only the service URL and organization, never a personal token.',
        run: ['auth', 'login', '--url', url],
        verify: { command: ['auth', 'status'] },
      },
    ],
  };
}
