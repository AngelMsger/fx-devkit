// A service block is checked against what the provider it names declares, so each
// provider here is one such declaration: the settings it takes and how it signs in.
import { describe, expect, it } from 'vitest';

import type { ProviderCatalog } from '../../../../src/domain/manifest/providers.js';
import { serviceRules } from '../../../../src/domain/manifest/rules/services.js';

const providers: ProviderCatalog = [
  {
    id: 'with-sign-in',
    capability: 'code-host',
    tools: [],
    settings: { fields: ['base_url', 'context', 'auth_scheme'], authSchemes: ['pat'] },
  },
  {
    id: 'without-sign-in',
    capability: 'metrics',
    tools: [],
    settings: { fields: ['base_url', 'context', 'auth_scheme'], authSchemes: ['none', 'bearer'] },
  },
  {
    id: 'no-auth-setting',
    capability: 'error-tracker',
    tools: [],
    settings: { fields: ['base_url', 'org'] },
  },
  { id: 'no-settings', capability: 'cluster', tools: [] },
];
const path = 'providers.code-host.service';
const messages = (problems: readonly { path: string; message: string }[]): string[] =>
  problems.map((problem) => `${problem.path}: ${problem.message}`);

describe('serviceRules', () => {
  it('accepts a complete declaration a provider supports', () => {
    expect(
      serviceRules({
        providers,
        provider: 'with-sign-in',
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
          provider: 'no-auth-setting',
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
    ['without-sign-in', []],
    [
      'with-sign-in',
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
          provider: 'no-settings',
          service: { base_url: 'https://k8s.example.com' },
          vars: {},
          path,
        }),
      ),
    ).toEqual([`${path}: provider does not support shared service configuration`]);
  });

  it('skips the provider-specific checks, and only those, when no catalog was supplied', () => {
    const service = { base_url: 'https://sentry.example.com', auth_scheme: 'token' } as const;
    expect(
      serviceRules({ providers: undefined, provider: 'no-auth-setting', service, vars: {}, path }),
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
