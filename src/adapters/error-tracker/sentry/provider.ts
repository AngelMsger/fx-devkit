// The Sentry provider's descriptor: the host and the organization are the
// workspace's, the team and the project slug are each environment's.

import type { ErrorTracker } from '../../../ports/error-tracker.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

import { BINARY } from './client.js';
import { SENTRY_RECIPES } from './recipes.js';
import { SentryErrorTracker } from './tracker.js';

export const sentryProvider: ProviderDescriptor<ErrorTracker> = {
  id: BINARY,
  capability: 'error-tracker',
  tools: [BINARY],
  recipes: SENTRY_RECIPES,
  vars: [
    { name: 'host', desc: 'Sentry host name, e.g. sentry.example.com', required: true },
    { name: 'org', desc: 'organization slug', required: true },
  ],
  envVars: [
    { name: 'team', desc: 'team slug in this environment', required: false },
    { name: 'slug', desc: 'project slug template, may use {svc}', required: true },
  ],
  create: (deps) => new SentryErrorTracker(deps.process),
};
