// Two steps per environment. The kubeconfig has to name the declared context before the
// access check can ask the cluster anything; that first check reads the file alone. The
// access check asks one question of the cluster, and its failure cases keep a cluster
// that said no apart from one that was never asked: only an answer is a permission
// verdict. Read access is a manual step because only the cluster's owner can grant it.

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
    verify: {
      command: [
        '--kubeconfig',
        '{kubeconfig}',
        'config',
        'get-contexts',
        '{context}',
        '-o',
        'name',
      ],
    },
  },
  {
    id: 'access',
    tool: 'kubectl',
    perEnv: true,
    kind: 'manual',
    title: 'Confirm read access to {context}',
    instructions: 'The check asks the cluster whether you may get pods in {namespace}.',
    verify: {
      // One check sends several requests; each gets a deadline short enough that a
      // cluster which never answers is kubectl's verdict rather than a check fx abandons.
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
        '--request-timeout=5s',
      ],
      failures: [
        {
          cause: 'credential',
          stderr: 'Unauthorized|system:unauthenticated|system:anonymous|must be logged in',
          instructions:
            'Authentication was not established for this request. Check {kubeconfig} and its authentication method. Renew its credentials if required, or obtain an updated kubeconfig for context "{context}" from the configured source.',
          open: '{setup.source}',
        },
        {
          cause: 'permission',
          exitCode: 1,
          stdout: '^\\s*no(\\s+-\\s.*)?\\s*$',
          stderr: '^\\s*$',
          instructions:
            'The cluster answered no. Ask its owner for a read-only role that may get pods in {namespace}.',
        },
        {
          cause: 'network',
          stderr:
            'was refused|dial tcp|no such host|i/o timeout|network is unreachable|context deadline exceeded',
          instructions:
            'A connection to the cluster could not be completed. Check the endpoint in {kubeconfig}, the network and any proxy or VPN; this does not establish a credential or permission failure.',
        },
      ],
    },
    requires: ['kubeconfig'],
    defaults: { namespace: 'default' },
  },
];
