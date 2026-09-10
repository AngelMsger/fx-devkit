// Registry readiness has one recovery route shared by self update and doctor.
// The coordinate is supplied by the private environment, never by the package.

import type { Handoff } from '../../domain/errors.js';

export const REGISTRY_HANDOFF: Handoff = {
  summary: 'A private registry coordinate is required.',
  command: 'fx self info --format json',
  userSteps: [
    {
      id: 'fx-registry',
      kind: 'manual',
      title: 'Set FX_REGISTRY from the private registry coordinate supplied by your team.',
    },
  ],
};
