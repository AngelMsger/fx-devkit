// Lark tasks: the to-dos assigned to the authorized user. fx reads the list and creates,
// completes or assigns nothing.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const MY_TASKS = ['task', '+get-my-tasks', '--format', 'json'];

export const larkTaskProvider: ProviderDescriptor<Coordinate> = {
  id: 'lark-task',
  capability: 'task',
  reference: true,
  tools: ['lark-cli'],
  vars: [],
  recipes: [
    {
      id: 'task-access',
      tool: 'lark-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Authorize Lark tasks',
      instructions:
        'Use the lark-shared Skill to authorize the user identity for the task domain; a bot identity sees its own tasks, not the person’s.',
      verify: { command: MY_TASKS },
    },
  ],
  create: () => ({
    label: 'Lark tasks assigned to the authorized user',
    command: ['lark-cli', ...MY_TASKS],
  }),
};
