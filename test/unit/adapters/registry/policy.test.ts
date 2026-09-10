import { describe, expect, it } from 'vitest';

import { configuredRegistry } from '../../../../src/composition/registry-location.js';

describe('configured private registry', () => {
  it('uses an explicit runtime coordinate instead of bundled publishing metadata', () => {
    expect(configuredRegistry({ FX_REGISTRY: 'https://npm.example.com/team/' })).toBe(
      'https://npm.example.com/team/',
    );
    expect(configuredRegistry({})).toBeNull();
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
    expect(configuredRegistry({ FX_REGISTRY })).toBeNull();
  });
});
