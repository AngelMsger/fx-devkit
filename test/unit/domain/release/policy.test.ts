import { describe, expect, it } from 'vitest';

import type { Workspace } from '../../../../src/domain/manifest/types.js';
import { releasePolicyOf } from '../../../../src/domain/release/policy.js';

const base: Workspace = {
  schema_version: 2,
  defaults: { branch: 'dev' },
  repos: [{ name: 'fx-example-api' }, { name: 'fx-example-auth', branch: 'main' }],
};

describe('releasePolicyOf', () => {
  it('fills every default when the manifest says nothing about releases', () => {
    expect(releasePolicyOf(base, 'fx-example-api')).toEqual({
      covered: true,
      source: 'dev',
      targets: ['main', 'master'],
      env: undefined,
      since: '14d',
      ci: undefined,
      bots: [],
    });
  });

  it("takes the source branch from the repository's manifest entry, not defaults", () => {
    expect(releasePolicyOf(base, 'fx-example-auth').source).toBe('main');
  });

  it('lets the repository override the workspace block, field by field', () => {
    const workspace: Workspace = {
      ...base,
      release: {
        source: 'develop',
        targets: ['release'],
        env: 'test',
        since: '7d',
        ci: { source_env: 'dev', target_env: 'prod' },
        bots: ['ci'],
      },
      repos: [
        {
          name: 'fx-example-api',
          release: { target: 'master', ci: { target_env: 'prod-global' } },
        },
        { name: 'fx-example-auth' },
      ],
    };
    expect(releasePolicyOf(workspace, 'fx-example-api')).toEqual({
      covered: true,
      source: 'develop',
      targets: ['master'],
      env: 'test',
      since: '7d',
      ci: { sourceEnv: 'dev', targetEnv: 'prod-global' },
      bots: ['ci'],
    });
    expect(releasePolicyOf(workspace, 'fx-example-auth').targets).toEqual(['release']);
  });

  it('has no ci envs until both sides are named', () => {
    const workspace: Workspace = { ...base, release: { ci: { source_env: 'dev' } } };
    expect(releasePolicyOf(workspace, 'fx-example-api').ci).toBeUndefined();
  });

  it('keeps a repository marked covered: false, and any unknown one, off the checklist', () => {
    const workspace: Workspace = {
      ...base,
      repos: [{ name: 'fx-example-api', release: { covered: false } }],
    };
    expect(releasePolicyOf(workspace, 'fx-example-api').covered).toBe(false);
    expect(releasePolicyOf(workspace, 'scratch').covered).toBe(false);
  });
});
