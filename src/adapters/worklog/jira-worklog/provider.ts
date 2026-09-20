// Worklogs kept in Jira, read through the family CLI. fx points at what is logged; entering
// and correcting time stays with the person.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { familyService } from '../../family/service.js';
import { referenceEntry } from '../../reference/entry.js';

// `worklog search` requires a bounded window so a query cannot scan every visible issue,
// and it answers for the authenticated user by default.
const worklogSearch = (since: string): readonly string[] => [
  'worklog',
  'search',
  '--project',
  '{project}',
  '--since',
  since,
  '--format',
  'json',
];

export const jiraWorklogProvider: ProviderDescriptor<Coordinate> = {
  id: 'jira-worklog',
  capability: 'worklog',
  settings: {
    fields: ['base_url', 'context', 'flavor', 'auth_scheme', 'credential_url'],
    authSchemes: ['pat', 'basic'],
  },
  reference: true,
  tools: ['jira-cli'],
  vars: [
    { name: 'base_url', desc: 'verified Jira site URL', required: true },
    { name: 'project', desc: 'project key whose worklogs are read', required: true },
  ],
  service: (settings) => familyService('jira-cli', settings),
  recipes: [
    {
      id: 'worklog-access',
      tool: 'jira-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Connect Jira worklogs',
      instructions:
        'Configure jira-cli for the intended site and obtain access to the declared project.',
      open: '{base_url}',
      verify: { command: [...worklogSearch('24h'), '--limit', '1'] },
    },
  ],
  create: (_deps, vars) =>
    referenceEntry({
      template: {
        label: 'Recent worklogs in {project}',
        command: [
          'jira-cli',
          ...(vars['context'] ? ['--use-context', vars['context']] : []),
          ...worklogSearch('7d'),
        ],
        url: '{base_url}',
      },
      vars,
    }),
};
