// GitHub Actions through gh: one sign-in, shared with the github code host; each
// environment names the workflow, branch and trigger that build it.

import type { Ci } from '../../../ports/ci.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { BINARY, GH_RECIPES } from '../../github/gh.js';

import { GitHubActionsCi, ID } from './ci.js';

export const githubActionsProvider: ProviderDescriptor<Ci> = {
  id: ID,
  capability: 'ci',
  tools: [BINARY],
  recipes: GH_RECIPES,
  vars: [
    {
      name: 'repository',
      desc: 'OWNER/NAME of the repository the workflows live in, may use {repo}',
      required: true,
    },
  ],
  envVars: [
    { name: 'workflow', desc: 'workflow file name or name, e.g. ci.yml', required: true },
    {
      name: 'branch',
      desc: 'only runs of this branch; without it, the latest run on any branch',
      required: false,
    },
    {
      name: 'event',
      desc: 'only runs this trigger started, e.g. push; without it, any trigger',
      required: false,
    },
  ],
  create: (deps) => new GitHubActionsCi(deps.process),
};
