// Lark user chat discovery is verified with one read-only metadata query.
// The entry remains data; fx never reads or sends messages itself.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const CHATS = ['im', '+chat-list', '--as', 'user', '--types', 'group'];

export const larkProvider: ProviderDescriptor<Coordinate> = {
  id: 'lark',
  capability: 'im',
  reference: true,
  tools: ['lark-cli'],
  vars: [],
  recipes: [
    {
      id: 'access',
      tool: 'lark-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Authorize Lark user chat discovery',
      instructions:
        'Use the Lark Skill to authorize the user identity and the scopes reported by chat discovery; do not silently switch to a bot.',
      verify: { command: [...CHATS, '--page-size', '1', '--format', 'json'] },
    },
  ],
  create: () => ({
    label: 'Lark group chats for the user identity',
    command: ['lark-cli', ...CHATS, '--page-size', '20', '--format', 'json'],
  }),
};
