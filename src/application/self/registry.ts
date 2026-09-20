// Registry readiness has one recovery route shared by self update and doctor.
// Runtime discovery follows npm configuration, with an optional explicit override.

import type { Handoff } from '../../domain/errors.js';

export const REGISTRY_HANDOFF: Handoff = {
  summary: 'The distribution registry is missing or invalid.',
  command: 'fx self info --format json',
  userSteps: [
    {
      id: 'fx-registry',
      kind: 'manual',
      title:
        'Check npm config get registry --global and the package scope registry. Configure @fx:registry for @fx/devkit, or use FX_REGISTRY as an optional override. Remove invalid overrides before retrying.',
    },
  ],
};
