// GitHub Actions through gh: one sign-in, shared with the github code host; each
// environment names the workflow and trigger that build it, and may name the branch.

import type { Ci } from '../../../ports/ci.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { BINARY, GH_RECIPES, qualifiedRepository } from '../../github/gh.js';

import { GitHubActionsCi, ID } from './ci.js';

export const githubActionsProvider: ProviderDescriptor<Ci> = {
  id: ID,
  capability: 'ci',
  tools: [BINARY],
  recipes: GH_RECIPES,
  vars: [
    {
      name: 'repository',
      desc: '[HOST/]OWNER/NAME of the repository the workflows live in (github.com without a host), may use {repo}',
      required: true,
    },
  ],
  envVars: [
    { name: 'workflow', desc: 'workflow file name or name, e.g. ci.yml', required: true },
    {
      name: 'branch',
      desc: 'only runs of this branch; without it, release check counts the branch it checks',
      required: false,
    },
    {
      name: 'event',
      desc: 'only runs this trigger started, e.g. push; without it, any trigger',
      required: false,
    },
  ],
  recipeVars: (vars) => ({ hostname: qualifiedRepository(vars['repository'] ?? '').hostname }),
  create: (deps) => new GitHubActionsCi(deps.process),
};
