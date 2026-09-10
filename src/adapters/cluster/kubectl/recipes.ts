// Two steps per environment. The kubeconfig has to be in place before the
// access check can ask the cluster anything, and read access is a manual step
// because only the cluster's owner can grant it.

import type { SetupRecipe } from '../../../domain/setup/types.js';

export const KUBECTL_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'kubeconfig',
    tool: 'kubectl',
    perEnv: true,
    kind: 'file',
    title: 'Put the {env} kubeconfig in place',
    open: '{setup.source}',
    instructions: 'Download the kubeconfig for context "{context}" and save it as {kubeconfig}.',
    expects: { path: '{kubeconfig}' },
    verify: { file: '{kubeconfig}' },
  },
  {
    id: 'access',
    tool: 'kubectl',
    perEnv: true,
    kind: 'manual',
    title: 'Confirm read access to {context}',
    instructions:
      'The check asks the cluster whether you may list pods in {namespace}; if it says no, ask the cluster owner for a read-only role.',
    verify: {
      command: [
        '--kubeconfig',
        '{kubeconfig}',
        '--context',
        '{context}',
        'auth',
        'can-i',
        'get',
        'pods',
        '-n',
        '{namespace}',
      ],
    },
    requires: ['kubeconfig'],
    defaults: { namespace: 'default' },
  },
];
