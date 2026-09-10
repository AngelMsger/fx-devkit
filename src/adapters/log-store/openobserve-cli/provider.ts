// OpenObserve through openobserve-cli: every environment is its own server,
// held as a named context inside the tool's configuration.

import type { LogStore } from '../../../ports/log-store.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

import { OPENOBSERVE_RECIPES } from './recipes.js';

export const openobserveCliProvider: ProviderDescriptor<LogStore> = {
  id: 'openobserve-cli',
  capability: 'log-store',
  tools: ['openobserve-cli'],
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
