import { describe, expect, it } from 'vitest';

import { runtimeRegistry } from '../../../../src/adapters/registry/registry-policy.js';

describe('configured private registry', () => {
  it('uses an explicit runtime coordinate instead of bundled publishing metadata', () => {
    expect(runtimeRegistry('@fx/devkit', 'https://npm.example.com/team/')).toBe(
      'https://npm.example.com/team/',
    );
    expect(runtimeRegistry('@fx/devkit', undefined)).toBeNull();
  });
  it.each([
    'https://registry.npmjs.org/',
    'https://REGISTRY.NPMJS.ORG./',
    'https://registry.yarnpkg.com',
    'https://user:password@npm.example.com',
    'https://npm.example.com?token=secret',
    'file:///tmp/registry',
    'not a URL',
  ])('refuses an unsafe registry without echoing %s', (FX_REGISTRY) => {
    expect(runtimeRegistry('@fx/devkit', FX_REGISTRY)).toBeNull();
  });
});

describe('public distribution registry', () => {
  it('defaults only the public package to npmjs and rejects malformed overrides', () => {
    expect(runtimeRegistry('@angelmsger/fx', undefined)).toBe('https://registry.npmjs.org/');
    expect(runtimeRegistry('@angelmsger/fx', 'https://registry.npmjs.org')).toBe(
      'https://registry.npmjs.org/',
    );
    expect(runtimeRegistry('@angelmsger/fx', 'https://mirror.example.com/')).toBe(
      'https://mirror.example.com/',
    );
    expect(runtimeRegistry('@angelmsger/fx', 'https://registry.yarnpkg.com/')).toBe(
      'https://registry.yarnpkg.com/',
    );
    expect(runtimeRegistry('@angelmsger/fx', 'invalid')).toBeNull();
  });
});
