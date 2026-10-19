// Kubernetes through kubectl, read-only by construction: every generated vector leads
// with one of READ_ONLY_VERBS, and a test pins that leading verb.

import type { Cluster } from '../../../ports/cluster.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

import { KUBECTL_RECIPES } from './recipes.js';

export const READ_ONLY_VERBS = ['get', 'describe', 'logs', 'top', 'auth', 'config'] as const;

export const kubectlProvider: ProviderDescriptor<Cluster> = {
  id: 'kubectl',
  capability: 'cluster',
  impliedByPlatform: ['kube'],
  tools: ['kubectl'],
  recipes: KUBECTL_RECIPES,
  vars: [],
  envVars: [
    { name: 'kubeconfig', desc: 'kubeconfig file for this environment', required: true },
    { name: 'context', desc: 'context name inside that kubeconfig', required: true },
    {
      name: 'namespace',
      desc: 'namespace used for coordinate queries and explicit existence probes',
      required: false,
    },
  ],
  create: () =>
    new TemplatePlatform({
      id: 'kubectl',
      capability: 'cluster',
      label: 'pods in {namespace} on {context}',
      command: [
        'kubectl',
        '--kubeconfig',
        '{kubeconfig}',
        '--context',
        '{context}',
        'get',
        'pods',
        '-n',
        '{namespace}',
      ],
      probe: {
        label: 'namespace {namespace}',
        command: [
          'kubectl',
          '--kubeconfig',
          '{kubeconfig}',
          '--context',
          '{context}',
          'get',
          'namespace',
          '--',
          '{namespace}',
        ],
      },
    }),
};
