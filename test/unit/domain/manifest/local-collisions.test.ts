import { describe, expect, it } from 'vitest';

import { applyLocal } from '../../../../src/domain/manifest/local.js';
import type { Workspace } from '../../../../src/domain/manifest/types.js';

const ws: Workspace = {
  schema_version: 1,
  defaults: { host: 'ssh://git@git.example.com:12345' },
  repos: [{ name: 'a' }, { name: 'b', path: 'tools/b' }],
};

describe('applyLocal collisions', () => {
  it('refuses a local repository that shadows a shared name or reuses a checkout path', () => {
    expect(() => applyLocal(ws, { repos: [{ name: 'a', upstream: 'x' }] })).toThrow(
      /name a appears twice/,
    );
    expect(() => applyLocal(ws, { repos: [{ name: 'c', path: 'tools/b' }] })).toThrow(
      /share the path tools\/b/,
    );
    expect(applyLocal(ws, { repos: [{ name: 'c' }] }).repos.map((r) => r.name)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('refuses a checkout nested under another checkout', () => {
    expect(() => applyLocal(ws, { repos: [{ name: 'c', path: 'tools/b/child' }] })).toThrow(
      /overlap/,
    );
  });
});
