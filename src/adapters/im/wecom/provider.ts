// WeCom readiness checks the response code of a read-only session query.
// Session visibility is scoped to the authorized bot, not the whole team.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const SESSIONS = ['message', 'aibot', 'sessions', 'list'];

export const wecomProvider: ProviderDescriptor<Coordinate> = {
  id: 'wecom',
  capability: 'im',
  reference: true,
  tools: ['wecom-cli'],
  vars: [],
  recipes: [
    {
      id: 'access',
      tool: 'wecom-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Authorize WeCom session discovery',
      instructions:
        'Use the wecomcli-shared Skill to authorize wecom-cli. Session discovery is limited to the authorized bot and does not establish access to every team conversation.',
      verify: { command: SESSIONS, json: { path: 'errcode', equals: 0 } },
    },
  ],
  create: () => ({
    label: 'WeCom conversations visible to the authorized bot',
    command: ['wecom-cli', ...SESSIONS],
  }),
};
