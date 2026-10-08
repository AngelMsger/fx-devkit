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

function texts(recipe: ProviderDescriptor<unknown>['recipes'][number]): string[] {
  return [
    recipe.title,
    recipe.instructions ?? '',
    recipe.open ?? '',
    recipe.expects?.path ?? '',
    ...(recipe.run ?? []),
    ...('command' in recipe.verify ? recipe.verify.command : []),
    ...('file' in recipe.verify ? [recipe.verify.file] : []),
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

function KUBECTL_VECTORS(): readonly (readonly string[])[] {
  return kubectlProvider.recipes.flatMap((r) => [
    ...(r.run === undefined ? [] : [r.run]),
    ...('command' in r.verify ? [r.verify.command] : []),
  ]);
}
