// Registry readiness has one recovery route shared by self update and doctor.
// Internal coordinates are explicit; the public distribution has a public default.

import type { Handoff } from '../../domain/errors.js';

export const REGISTRY_HANDOFF: Handoff = {
  summary: 'The distribution registry is missing or invalid.',
  command: 'fx self info --format json',
  userSteps: [
    {
      id: 'fx-registry',
      kind: 'manual',
      title:
        'For @fx/devkit, set FX_REGISTRY from your team. For @angelmsger/fx, remove an invalid override to use npmjs or select a valid mirror.',
    },
  ],
};
