import { describe, expect, it } from 'vitest';

import { applyLocal } from '../../../../src/domain/manifest/local.js';
import type { Workspace } from '../../../../src/domain/manifest/types.js';

const workspace: Workspace = {
  schema_version: 1,
  defaults: { host: 'ssh://git@git.example.com:12345', upstream_project: 'fx', branch: 'dev' },
  repos: [
    { name: 'fx-example-api', desc: 'Backend', tags: ['backend'] },
    { name: 'fx-example-auth', branch: 'main', project: 'auth' },
    {
      name: 'fx-example-docs',
      path: 'docs/help',
      upstream: 'ssh://git@git.example.com:12345/docs/help.git',
    },
  ],
};

describe('applyLocal', () => {
  it('tracks every shared repository when nothing was selected, filling in defaults', () => {
    const resolved = applyLocal(workspace, {});
    expect(resolved.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-auth',
      'fx-example-docs',
    ]);
    expect(resolved.available).toEqual([]);
    expect(resolved.repos[0]).toMatchObject({
      path: 'fx-example-api',
      branch: 'dev',
      project: 'fx',
      origin: 'shared',
      overridden: [],
    });
    expect(resolved.repos[0]).not.toHaveProperty('upstream');
    expect(resolved.repos[2]).toMatchObject({
      path: 'docs/help',
      upstream: expect.stringContaining('docs/help'),
    });
  });

  it('distinguishes an empty selection from no selection', () => {
    const none = applyLocal(workspace, { scope: { repos: [] } });
    expect(none.repos).toEqual([]);
    expect(none.available).toEqual(['fx-example-api', 'fx-example-auth', 'fx-example-docs']);
  });

  it('keeps the selected repositories and offers the rest', () => {
    const resolved = applyLocal(workspace, { scope: { repos: ['fx-example-auth'] } });
    expect(resolved.repos.map((r) => r.name)).toEqual(['fx-example-auth']);
    expect(resolved.available).toEqual(['fx-example-api', 'fx-example-docs']);
  });

  it('overrides only path and branch and says which', () => {
    const resolved = applyLocal(workspace, {
      overrides: { 'fx-example-api': { path: 'fx-example-api-wt', branch: 'feature/x' } },
    });
    expect(resolved.repos[0]).toMatchObject({
      path: 'fx-example-api-wt',
      branch: 'feature/x',
      overridden: ['path', 'branch'],
    });
  });

  it('appends machine-local repositories after the shared ones', () => {
    const resolved = applyLocal(workspace, {
      scope: { repos: ['fx-example-api'] },
      repos: [
        {
          name: 'scratch',
          path: '../scratch',
          upstream: 'ssh://git@git.example.com:12345/~me/scratch.git',
        },
      ],
    });
    expect(resolved.repos.map((r) => [r.name, r.origin])).toEqual([
      ['fx-example-api', 'shared'],
      ['scratch', 'local'],
    ]);
  });

  it('reports selections and overrides that name no repository', () => {
    const resolved = applyLocal(workspace, {
      scope: { repos: ['fx-example-api', 'ghost'] },
      overrides: { phantom: { branch: 'x' } },
    });
    expect(resolved.unmatched).toEqual(['scope.repos.ghost', 'overrides.phantom']);
  });

  it('carries a repository release block through untouched, and omits an absent one', () => {
    const resolved = applyLocal(
      {
        ...workspace,
        repos: [
          { name: 'fx-example-api', release: { covered: false } },
          { name: 'fx-example-auth' },
        ],
      },
      {},
    );
    expect(resolved.repos[0]?.release).toEqual({ covered: false });
    expect(resolved.repos[1]).not.toHaveProperty('release');
  });

  it('passes the environment selection through', () => {
    expect(applyLocal(workspace, { scope: { envs: ['dev', 'test'] } }).envs).toEqual([
      'dev',
      'test',
    ]);
    expect(applyLocal(workspace, {}).envs).toBeUndefined();
  });
});
