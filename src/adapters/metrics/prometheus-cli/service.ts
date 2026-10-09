// How prometheus-cli is prepared for a declared server. Prometheus has no accounts of its
// own, so a server is usually declared with the `none` scheme: there is no login to reuse
// or obtain — `auth login` refuses the scheme — and readiness is whether the server answers.

import type { ServiceSettings } from '../../../domain/manifest/service.schema.js';
import type { ServiceDefinition } from '../../../domain/setup/service.js';
import type { SetupCheck } from '../../../domain/setup/types.js';
import { familyService, serviceScope } from '../../family/service.js';

export const BINARY = 'prometheus-cli';

// `auth status` exits zero when the server does not answer, so only `authenticated` tells.
// Its own request timeout stays under fx's check deadline: a server that never answers is
// then the companion's verdict rather than a check fx had to abandon.
export function answers(scope: readonly string[]): SetupCheck {
  return {
    command: [...scope, '--timeout', '10s', 'auth', 'status', '--format', 'json'],
    json: { path: 'authenticated', equals: true, reason: 'error' },
  };
}

export function prometheusService(settings: ServiceSettings): ServiceDefinition {
  const family = familyService(BINARY, settings, '0.2.0', 'authenticated');
  if (settings.auth_scheme !== 'none') return family;
  return {
    ...family,
    recipes: [
      {
        id: 'access',
        tool: BINARY,
        perEnv: false,
        kind: 'manual',
        title: 'Reach the Prometheus server',
        instructions:
          'This server takes no sign-in. Connect to the network it is served on; no token or auth login is involved.',
        verify: answers(serviceScope(settings)),
      },
    ],
  };
}
