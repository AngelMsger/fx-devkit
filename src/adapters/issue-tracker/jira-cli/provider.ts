// Jira through the family CLI: a workspace entry and a credential check. Business queries
// and transitions remain the caller's responsibility.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { familyService } from '../../family/service.js';
import { referenceEntry } from '../../reference/entry.js';

const PROJECT_ISSUES = ['issue', 'search', '--project', '{project}', '--format', 'json'];

export const jiraCliProvider: ProviderDescriptor<Coordinate> = {
  id: 'jira-cli',
  capability: 'issue-tracker',
  settings: {
    fields: ['base_url', 'context', 'flavor', 'auth_scheme', 'credential_url'],
    authSchemes: ['pat', 'basic'],
  },
  reference: true,
  tools: ['jira-cli'],
  vars: [
    { name: 'base_url', desc: 'verified Jira site URL', required: true },
    { name: 'project', desc: 'project key', required: true },
  ],
  service: (settings) => familyService('jira-cli', settings, '0.7.0'),
  recipes: [
    {
      id: 'access',
      tool: 'jira-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Connect the Jira project',
      instructions:
        'Configure jira-cli for the intended site and obtain access to the declared project.',
      open: '{base_url}',
      // Credentials answer for a site, so the check is who they authenticate as.
      verify: { command: ['whoami', '--format', 'json'] },
    },
  ],
  create: (_deps, vars) =>
    referenceEntry({
      template: {
        label: 'Work items in {project}',
        command: [
          'jira-cli',
          ...(vars['context'] ? ['--use-context', vars['context']] : []),
          ...PROJECT_ISSUES,
        ],
        url: '{base_url}',
      },
      vars,
    }),
};
