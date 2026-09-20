import { describe, expect, it } from 'vitest';

import { providerCatalog } from '../../../../src/composition/registry.js';
import { capabilitiesInScope } from '../../../../src/domain/capability.js';
import { bindProviders } from '../../../../src/domain/manifest/providers.js';
import type { Workspace } from '../../../../src/domain/manifest/types.js';

describe('bindProviders', () => {
  it('binds the code host by default on a schema 1 document, taking the host from defaults', () => {
    const ws: Workspace = {
      schema_version: 1,
      defaults: { host: 'ssh://git@git.example.com:12345' },
      repos: [{ name: 'a' }],
    };
    const bindings = bindProviders(ws, providerCatalog());
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
    const bindings = bindProviders(ws, providerCatalog());
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
    expect(bindProviders(ws, providerCatalog()).find((b) => b.capability === 'ci')).toMatchObject({
      source: 'misplaced',
    });
  });
});
