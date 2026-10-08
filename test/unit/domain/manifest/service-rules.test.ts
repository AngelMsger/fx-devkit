// A service block is checked against the provider's own declaration, so these
// expectations move with the adapters rather than with a table in the rules.
import { describe, expect, it } from 'vitest';

import { providerCatalog } from '../../../../src/composition/registry.js';
import { serviceRules } from '../../../../src/domain/manifest/rules/services.js';

const providers = providerCatalog();
const path = 'providers.code-host.service';
const messages = (problems: readonly { path: string; message: string }[]): string[] =>
  problems.map((problem) => `${problem.path}: ${problem.message}`);

describe('serviceRules', () => {
  it('accepts a complete declaration a provider supports', () => {
    expect(
      serviceRules({
        providers,
        provider: 'bitbucket-cli',
        service: {
          base_url: 'https://git.example.com',
          context: 'corp',
          auth_scheme: 'pat',
        },
        vars: {},
        path,
      }),
    ).toEqual([]);
  });

  it('reports a setting, an authentication method and a required field the provider does not have', () => {
    expect(
      messages(
        serviceRules({
          providers,
          provider: 'sentry',
          service: { base_url: 'https://sentry.example.com', auth_scheme: 'token' },
          vars: {},
          path,
        }),
      ),
    ).toEqual([
      `${path}.auth_scheme: not supported by this provider`,
      `${path}.org: required for service setup`,
      `${path}.auth_scheme: authentication method is not supported by this provider`,
    ]);
  });

  it.each([
    ['prometheus-cli', []],
    [
      'jenkins-cli',
      [`${path}.auth_scheme: authentication method is not supported by this provider`],
    ],
  ])(
    'lets only a provider that says so declare a service without sign-in: %s',
    (provider, found) => {
      const service = {
        base_url: 'https://metrics.example.com',
        context: 'test',
        auth_scheme: 'none',
      } as const;
      expect(messages(serviceRules({ providers, provider, service, vars: {}, path }))).toEqual(
        found,
      );
    },
  );

  it('reports a provider that declares no service settings at all', () => {
    expect(
      messages(
        serviceRules({
          providers,
          provider: 'kubectl',
          service: { base_url: 'https://k8s.example.com' },
          vars: {},
          path,
        }),
      ),
    ).toEqual([`${path}: provider does not support shared service configuration`]);
  });

  // The degraded path: a load that was given no catalog cannot say what a provider
  // accepts, so it must skip those checks instead of reporting the provider as one
  // that refuses settings, while the provider-independent conflict still holds.
  it('skips the provider-specific checks, and only those, when no catalog was supplied', () => {
    const service = { base_url: 'https://sentry.example.com', auth_scheme: 'token' } as const;
    expect(
      serviceRules({ providers: undefined, provider: 'sentry', service, vars: {}, path }),
    ).toEqual([]);
    expect(
      messages(
        serviceRules({
          providers: undefined,
          provider: 'no-such-provider',
          service,
          vars: { auth_scheme: 'pat' },
          path,
        }),
      ),
    ).toEqual([`${path}.auth_scheme: conflicts with the legacy variable; keep one shared source`]);
  });
});
