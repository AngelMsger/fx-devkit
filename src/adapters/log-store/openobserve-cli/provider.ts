// OpenObserve through openobserve-cli: every environment is its own server,
// held as a named context inside the tool's configuration.

import type { LogStore } from '../../../ports/log-store.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { familyService } from '../../family/service.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

import { OPENOBSERVE_RECIPES } from './recipes.js';

export const openobserveCliProvider: ProviderDescriptor<LogStore> = {
  id: 'openobserve-cli',
  capability: 'log-store',
  impliedByPlatform: ['openobserve'],
  settings: {
    fields: ['base_url', 'context', 'org', 'auth_scheme', 'credential_url'],
    authSchemes: ['basic', 'token', 'session'],
  },
  tools: ['openobserve-cli'],
  service: (settings) => familyService('openobserve-cli', settings, 'authenticated', '0.13.0'),
  recipes: OPENOBSERVE_RECIPES,
  vars: [],
  envVars: [
    { name: 'context', desc: 'openobserve-cli context name for this environment', required: true },
    { name: 'stream', desc: 'log stream template, may use {svc}', required: true },
  ],
  create: () =>
    new TemplatePlatform({
      id: 'openobserve-cli',
      capability: 'log-store',
      label: 'OpenObserve stream {stream}',
      optionalFlags: { base_url: '--base-url', org: '--org', auth_scheme: '--auth-scheme' },
      command: [
        'openobserve-cli',
        'search',
        'run',
        '--use-context',
        '{context}',
        '--stream',
        '{stream}',
        '--from',
        'now-1h',
      ],
      probe: {
        label: 'stream {stream}',
        command: [
          'openobserve-cli',
          'stream',
          'get',
          '--use-context',
          '{context}',
          '--',
          '{stream}',
        ],
      },
    }),
};
