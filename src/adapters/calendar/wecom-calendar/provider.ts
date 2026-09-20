// WeCom calendar readiness lists the schedules the authorized bot can see. Visibility is
// scoped to that bot, not to every calendar in the company.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const SCHEDULES = ['calendar', 'schedules', 'list'];

export const wecomCalendarProvider: ProviderDescriptor<Coordinate> = {
  id: 'wecom-calendar',
  capability: 'calendar',
  reference: true,
  tools: ['wecom-cli'],
  vars: [],
  recipes: [
    {
      id: 'calendar-access',
      tool: 'wecom-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Authorize WeCom schedule discovery',
      instructions:
        'Use the wecomcli-shared Skill to authorize wecom-cli. Schedule visibility is limited to the authorized bot.',
      verify: { command: SCHEDULES },
    },
  ],
  create: () => ({
    label: 'WeCom schedules visible to the authorized bot',
    command: ['wecom-cli', ...SCHEDULES],
  }),
};
