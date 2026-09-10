// Jenkins through jenkins-cli: one server, one credential; environments
// differ only in the job path.

import type { Ci } from '../../../ports/ci.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

import { BINARY, JenkinsCi } from './ci.js';
import { JENKINS_RECIPES } from './recipes.js';

export const jenkinsCliProvider: ProviderDescriptor<Ci> = {
  id: BINARY,
  capability: 'ci',
  tools: [BINARY],
  recipes: JENKINS_RECIPES,
  vars: [
    { name: 'host', desc: 'Jenkins host name', required: false },
    {
      name: 'context',
      desc: 'jenkins-cli context name when more than one server is configured',
      required: false,
    },
  ],
  envVars: [{ name: 'path', desc: 'job path template, may use {repo}', required: true }],
  create: (deps) => new JenkinsCi(deps.process),
};
