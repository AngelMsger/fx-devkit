// Every provider's recipes must be satisfiable from what the manifest can
// say: the descriptor's variables, the environment's, the built-in names
// and the recipe's own defaults. And kubectl must never write.

import { describe, expect, it } from 'vitest';

import { jenkinsCliProvider } from '../../../src/adapters/ci/jenkins-cli/provider.js';
import {
  kubectlProvider,
  READ_ONLY_VERBS,
} from '../../../src/adapters/cluster/kubectl/provider.js';
import { bitbucketCliProvider } from '../../../src/adapters/code-host/bitbucket-cli/provider.js';
import { sentryProvider } from '../../../src/adapters/error-tracker/sentry/provider.js';
import { openobserveCliProvider } from '../../../src/adapters/log-store/openobserve-cli/provider.js';
import { prometheusCliProvider } from '../../../src/adapters/metrics/prometheus-cli/provider.js';
import { failureCaseOf } from '../../../src/domain/setup/failure-case.js';
import type { FailureCase } from '../../../src/domain/setup/types.js';
import { placeholders } from '../../../src/domain/template.js';
import type { Platform } from '../../../src/ports/platform.js';
import type { ProviderDescriptor } from '../../../src/ports/provider.js';

const PROVIDERS: readonly ProviderDescriptor<unknown>[] = [
  bitbucketCliProvider,
  sentryProvider,
  openobserveCliProvider,
  prometheusCliProvider,
  jenkinsCliProvider,
  kubectlProvider,
];

const BUILT_IN = ['env', 'setup.source'];

function failuresOf(recipe: ProviderDescriptor<unknown>['recipes'][number]): FailureCase[] {
  return 'command' in recipe.verify ? [...(recipe.verify.failures ?? [])] : [];
}

function texts(recipe: ProviderDescriptor<unknown>['recipes'][number]): string[] {
  return [
    recipe.title,
    recipe.instructions ?? '',
    recipe.open ?? '',
    recipe.expects?.path ?? '',
    ...(recipe.run ?? []),
    ...('command' in recipe.verify ? recipe.verify.command : []),
    ...('file' in recipe.verify ? [recipe.verify.file] : []),
    ...failuresOf(recipe).flatMap((failure) => [failure.instructions, failure.open ?? '']),
  ];
}

describe.each(PROVIDERS.map((p) => [p.id, p] as const))('%s recipes', (_, provider) => {
  it('only use variables the manifest can supply, and belong to the tool they drive', () => {
    const known = new Set([
      ...provider.vars.map((v) => v.name),
      ...(provider.envVars ?? []).map((v) => v.name),
      ...BUILT_IN,
    ]);
    for (const recipe of provider.recipes) {
      expect(provider.tools).toContain(recipe.tool);
      for (const name of new Set(texts(recipe).flatMap(placeholders))) {
        expect(
          known.has(name) || recipe.defaults?.[name] !== undefined,
          `{${name}} in ${recipe.id}`,
        ).toBe(true);
      }
      for (const dep of recipe.requires ?? [])
        expect(provider.recipes.map((r) => r.id)).toContain(dep);
    }
  });

  it('reads a failed check only by what the tool wrote, through patterns that compile', () => {
    for (const failure of provider.recipes.flatMap(failuresOf)) {
      const patterns = [failure.stdout, failure.stderr].filter((p) => p !== undefined);
      expect(patterns.length, `${failure.cause} states an output condition`).toBeGreaterThan(0);
      for (const pattern of patterns) expect(() => new RegExp(pattern)).not.toThrow();
    }
  });
});

describe('kubectl', () => {
  it('never generates a writing verb', () => {
    const vectors = [
      ...KUBECTL_VECTORS(),
      (kubectlProvider.create({} as never, {}) as Platform).locate({
        kubeconfig: 'k',
        context: 'c',
        namespace: 'n',
      }).command,
    ];
    for (const vector of vectors) {
      const verb = vector.find(
        (arg, i) =>
          !arg.startsWith('-') &&
          (i === 0 || !vector[i - 1]?.startsWith('--')) &&
          arg !== 'kubectl',
      );
      expect(READ_ONLY_VERBS, vector.join(' ')).toContain(verb);
      for (const bad of ['apply', 'delete', 'edit', 'exec', 'scale', 'patch', 'create', 'set'])
        expect(vector).not.toContain(bad);
    }
  });
});

// What kubectl writes when its access check does not pass. Only an answer is a permission
// verdict, only a refused identity is a credential one, and whatever names neither stays
// unknown instead of sending someone after a new kubeconfig or a role.
describe('kubectl access check', () => {
  const access = kubectlProvider.recipes.find((recipe) => recipe.id === 'access')!;
  const SERVER = 'Error from server (Forbidden)';
  const UNREACHABLE = 'Unable to connect to the server';

  it.each([
    ['the cluster answering no', 1, 'no\n', '', 'permission'],
    ['an answer with the authorizer reason', 1, 'no - no RBAC policy matched\n', '', 'permission'],
    [
      'a refused token',
      1,
      '',
      'error: You must be logged in to the server (Unauthorized)',
      'credential',
    ],
    [
      'a proxy that saw no identity',
      1,
      '',
      `${SERVER}: User "system:unauthenticated" cannot get resource "clusters"`,
      'credential',
    ],
    [
      'an anonymous request',
      1,
      '',
      `${SERVER}: User "system:anonymous" cannot create resource "selfsubjectaccessreviews"`,
      'credential',
    ],
    [
      'a refused connection',
      1,
      '',
      'The connection to the server 192.0.2.1:6443 was refused - did you specify the right host or port?',
      'network',
    ],
    [
      'a connection that timed out',
      1,
      '',
      `${UNREACHABLE}: dial tcp 192.0.2.1:443: i/o timeout`,
      'network',
    ],
    ['a request past its deadline', 1, '', `${UNREACHABLE}: context deadline exceeded`, 'network'],
    [
      'a host that does not resolve',
      1,
      '',
      `${UNREACHABLE}: dial tcp: lookup k8s.example.com: no such host`,
      'network',
    ],
    [
      'a forbidden request that names no identity',
      1,
      '',
      `${SERVER}: pods is forbidden`,
      undefined,
    ],
    [
      'a certificate the client does not trust',
      1,
      '',
      `${UNREACHABLE}: x509: certificate signed by unknown authority`,
      undefined,
    ],
    [
      'a credential plugin that did not run',
      1,
      '',
      `${UNREACHABLE}: getting credentials: exec: executable example-login not found`,
      undefined,
    ],
    ['a connection closed without a reason', 1, '', `${UNREACHABLE}: EOF`, undefined],
    ['an answer alongside a complaint', 1, 'no\n', 'error: something else went wrong', undefined],
  ])('reads %s', (_, code, stdout, stderr, cause) => {
    expect(failureCaseOf({ code, stdout, stderr }, failuresOf(access))?.cause).toBe(cause);
  });

  it('bounds each request below the deadline fx gives the whole check', () => {
    expect('command' in access.verify && access.verify.command).toContain('--request-timeout=5s');
  });
});

function KUBECTL_VECTORS(): readonly (readonly string[])[] {
  return kubectlProvider.recipes.flatMap((r) => [
    ...(r.run === undefined ? [] : [r.run]),
    ...('command' in r.verify ? [r.verify.command] : []),
  ]);
}
