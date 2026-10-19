import { describe, expect, it } from 'vitest';

import { capabilitiesInScope } from '../../../../src/domain/capability.js';
import {
  bindProviders,
  requireProvider,
  type BindableProvider,
  type Binding,
  type ProviderCatalog,
} from '../../../../src/domain/manifest/providers.js';
import type { Workspace } from '../../../../src/domain/manifest/types.js';

describe('bindProviders', () => {
  const providers: ProviderCatalog = [
    { id: 'bitbucket-cli', capability: 'code-host', tools: [], impliedByDefaultHost: true },
  ];

  it('binds the code host by default on a schema 1 document, taking the host from defaults', () => {
    const ws: Workspace = {
      schema_version: 1,
      defaults: { host: 'ssh://git@git.example.com:12345' },
      repos: [{ name: 'a' }],
    };
    const bindings = bindProviders(ws, providers);
    expect(bindings.find((b) => b.capability === 'code-host')).toEqual({
      capability: 'code-host',
      provider: 'bitbucket-cli',
      source: 'default',
      vars: { host: 'ssh://git@git.example.com:12345' },
    });
    expect(bindings.find((b) => b.capability === 'im')).toEqual({
      capability: 'im',
      provider: null,
      source: 'unbound',
      vars: {},
    });
  });

  it('reports explicit bindings as explicit and lists only workspace-scoped capabilities', () => {
    const ws: Workspace = {
      schema_version: 2,
      providers: {
        'code-host': {
          provider: 'bitbucket-cli',
          vars: { host: 'ssh://git@git.example.com:12345' },
        },
        im: { provider: 'lark-cli' },
      },
      defaults: {},
      repos: [{ name: 'a' }],
    };
    const bindings = bindProviders(ws, providers);
    expect(bindings.map((b) => b.capability)).toEqual(capabilitiesInScope('workspace'));
    expect(bindings.find((b) => b.capability === 'im')).toMatchObject({
      provider: 'lark-cli',
      source: 'explicit',
    });
  });

  it('reports a binding for a capability the workspace should not bind', () => {
    const ws: Workspace = {
      schema_version: 2,
      providers: { ci: { provider: 'jenkins-cli' } },
      defaults: {},
      repos: [{ name: 'a' }],
    };
    expect(bindProviders(ws, providers).find((b) => b.capability === 'ci')).toMatchObject({
      source: 'misplaced',
    });
  });
});

describe('requireProvider', () => {
  const registered: readonly BindableProvider[] = [
    {
      id: 'alpha-host',
      capability: 'code-host',
      tools: [],
      vars: [
        { name: 'host', desc: 'where the repositories live', required: true },
        { name: 'user', desc: 'the fork namespace', required: false },
      ],
    },
    { id: 'beta-host', capability: 'code-host', tools: [], vars: [] },
    { id: 'chat', capability: 'im', tools: [], vars: [] },
  ];
  const bound = (binding: Partial<Binding>): Binding => ({
    capability: 'code-host',
    provider: 'alpha-host',
    source: 'explicit',
    vars: { host: '/srv/git' },
    ...binding,
  });

  it('returns the provider a binding names once every required variable is supplied', () => {
    expect(requireProvider(bound({}), registered)).toBe(registered[0]);
  });

  it('lists what could serve a capability nothing is bound to', () => {
    expect(() => requireProvider(bound({ provider: null }), registered)).toThrow(
      expect.objectContaining({
        code: 'PROVIDER_UNBOUND',
        hint: expect.stringContaining('Available: alpha-host, beta-host.'),
      }),
    );
    expect(() => requireProvider(bound({ capability: 'ci', provider: null }), registered)).toThrow(
      expect.objectContaining({ hint: expect.stringContaining('Available: (none).') }),
    );
  });

  it('offers the nearest provider of the capability for an id it does not know', () => {
    expect(() => requireProvider(bound({ provider: 'alpha-hots' }), registered)).toThrow(
      expect.objectContaining({ code: 'PROVIDER_UNKNOWN', hint: 'Did you mean "alpha-host"?' }),
    );
  });

  it('refuses a provider registered under another capability and names only its own', () => {
    expect(() =>
      requireProvider(bound({ capability: 'im', provider: 'beta-host' }), registered),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_UNKNOWN', hint: 'Available: chat.' }));
  });

  it.each([{}, { host: '  ' }])('names a required variable the binding leaves out: %j', (vars) => {
    expect(() => requireProvider(bound({ vars }), registered)).toThrow(
      expect.objectContaining({
        code: 'PROVIDER_VAR_MISSING',
        message: 'providers.code-host (alpha-host) is missing host',
        hint: 'host: where the repositories live',
      }),
    );
  });
});
