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
        'Check npm config get registry --global and the @angelmsger:registry scope setting. fx updates from npmjs unless a valid mirror is configured there or in FX_REGISTRY. Remove invalid overrides before retrying.',
    },
  ],
};
