// Lark calendar readiness is one read-only agenda query for the authorized user identity.
// fx never creates, changes or answers an event.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const AGENDA = ['calendar', '+agenda', '--as', 'user', '--format', 'json'];

export const larkCalendarProvider: ProviderDescriptor<Coordinate> = {
  id: 'lark-calendar',
  capability: 'calendar',
  reference: true,
  tools: ['lark-cli'],
  vars: [],
  recipes: [
    {
      id: 'calendar-access',
      tool: 'lark-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Authorize the Lark calendar',
      instructions:
        'Use the lark-shared Skill to authorize the user identity for the calendar domain; do not silently switch to a bot.',
      verify: { command: AGENDA },
    },
  ],
  create: () => ({
    label: "Lark agenda for the authorized user's identity",
    command: ['lark-cli', ...AGENDA],
  }),
};
