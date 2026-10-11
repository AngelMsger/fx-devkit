import { describe, expect, it } from 'vitest';

import {
  publicationRegistry,
  runtimeRegistry,
} from '../../../../src/adapters/registry/registry-policy.js';

describe('runtime registry', () => {
  it('defaults to npmjs and follows a valid configured mirror', () => {
    expect(runtimeRegistry(undefined)).toBe('https://registry.npmjs.org/');
    expect(runtimeRegistry('https://registry.npmjs.org')).toBe('https://registry.npmjs.org/');
    expect(runtimeRegistry('https://mirror.example.com/team/')).toBe(
      'https://mirror.example.com/team/',
    );
    expect(runtimeRegistry('https://registry.yarnpkg.com/')).toBe('https://registry.yarnpkg.com/');
  });
  it.each([
    'https://user:password@npm.example.com',
    'https://npm.example.com?token=secret',
    'file:///tmp/registry',
    'not a URL',
  ])('refuses an unsafe registry without echoing %s', (FX_REGISTRY) => {
    expect(runtimeRegistry(FX_REGISTRY)).toBeNull();
  });
});

describe('publication registry', () => {
  it('publishes only to npmjs, whatever ambient configuration says', () => {
    expect(publicationRegistry(undefined)).toBe('https://registry.npmjs.org/');
    expect(publicationRegistry('https://REGISTRY.NPMJS.ORG/')).toBe('https://registry.npmjs.org/');
    expect(publicationRegistry('https://mirror.example.com/')).toBeNull();
    expect(publicationRegistry('')).toBeNull();
  });
});
