// Prometheus through prometheus-cli: every environment is its own server, held as a named
// context inside the tool's configuration. A service is found by its scrape job, the one
// label every scraped series carries. There is no probe: a selector that matches nothing
// still succeeds, so no query can tell a missing job from a silent one.

import type { Metrics } from '../../../ports/metrics.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

import { PROMETHEUS_RECIPES } from './recipes.js';
import { BINARY, prometheusService } from './service.js';

export const prometheusCliProvider: ProviderDescriptor<Metrics> = {
  id: BINARY,
  capability: 'metrics',
  impliedByPlatform: ['prometheus'],
  settings: {
    fields: ['base_url', 'context', 'auth_scheme', 'credential_url'],
    authSchemes: ['none', 'basic', 'bearer'],
  },
  tools: [BINARY],
  service: prometheusService,
  recipes: PROMETHEUS_RECIPES,
  vars: [],
  envVars: [
    { name: 'context', desc: 'prometheus-cli context name for this environment', required: true },
    { name: 'job', desc: 'scrape job template, may use {svc}', required: true },
  ],
  create: () =>
    new TemplatePlatform({
      id: BINARY,
      capability: 'metrics',
      label: 'Prometheus job {job}',
      optionalFlags: { base_url: '--base-url', auth_scheme: '--auth-scheme' },
      command: [
        BINARY,
        'query',
        'instant',
        '--use-context',
        '{context}',
        '--query',
        'up{job="{job}"}',
      ],
    }),
};
