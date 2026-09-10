// Feishu Project through Meegle: a workspace entry and a local auth check.
// Business queries and mutations remain the caller's responsibility.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { referenceEntry } from '../../reference/entry.js';

export const feishuProjectProvider: ProviderDescriptor<Coordinate> = {
  id: 'feishu-project',
  capability: 'issue-tracker',
  reference: true,
  tools: ['meegle'],
  vars: [{ name: 'project_key', desc: 'verified project key or simple name', required: true }],
  recipes: [
    {
      id: 'auth',
      tool: 'meegle',
      perEnv: false,
      kind: 'manual',
      title: 'Authenticate Meegle',
      instructions:
        'Run meegle auth login for the intended site, then verify the workspace project.',
      verify: {
        command: ['auth', 'status', '--format', 'json'],
        json: { path: 'authenticated', equals: true },
      },
    },
  ],
  create: (_deps, vars) =>
    referenceEntry({
      template: {
        label: 'Work items in {project_key}',
        command: [
          'meegle',
          'project',
          'search',
          '--project-key',
          '{project_key}',
          '--format',
          'json',
        ],
      },
      vars,
    }),
};
