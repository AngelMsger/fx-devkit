// Worklogs kept in Jira, read through the family CLI. fx reports what is logged; entering
// and correcting time stays with the person.
//
// The vector below is the one surface this provider depends on, and jira-cli 0.2.1 does not
// carry it yet: readiness therefore fails against a CLI without it, which is the intended
// answer rather than a silent pass. Confirm the vector against `jira-cli worklog --help`
// and raise the tool's version floor once a release ships it.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { familyService } from '../../family/service.js';
import { referenceEntry } from '../../reference/entry.js';

const PROJECT_WORKLOG = ['worklog', 'list', '--project', '{project}', '--format', 'json'];

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
      verify: { command: [...PROJECT_WORKLOG, '--limit', '1'] },
    },
  ],
  create: (_deps, vars) =>
    referenceEntry({
      template: {
        label: 'Worklogs in {project}',
        command: [
          'jira-cli',
          ...(vars['context'] ? ['--use-context', vars['context']] : []),
          ...PROJECT_WORKLOG,
        ],
        url: '{base_url}',
      },
      vars,
    }),
};
