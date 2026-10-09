// WeCom to-dos the authorized bot created or takes part in. The list is that bot's view,
// not the company's.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const TODOS = ['todo', 'list'];

export const wecomTodoProvider: ProviderDescriptor<Coordinate> = {
  id: 'wecom-todo',
  capability: 'task',
  reference: true,
  tools: ['wecom-cli'],
  vars: [],
  recipes: [
    {
      id: 'task-access',
      tool: 'wecom-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Authorize WeCom to-do discovery',
      instructions:
        'Use the wecomcli-shared Skill to authorize wecom-cli. The to-do list covers what the authorized bot created or participates in.',
      verify: {
        command: TODOS,
        json: { path: 'errcode', equals: 0, unmet: 'the WeCom API returned an error' },
      },
    },
  ],
  create: () => ({
    label: 'WeCom to-dos visible to the authorized bot',
    command: ['wecom-cli', ...TODOS],
  }),
};
