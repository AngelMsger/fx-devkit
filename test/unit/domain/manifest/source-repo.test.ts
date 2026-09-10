import { describe, expect, it } from 'vitest';

import {
  describeManifestRepo,
  isRepositoryUrl,
} from '../../../../src/domain/manifest/source-repo.js';

const dir = '/home/.fx/workspaces/fx/source';

describe('describeManifestRepo', () => {
  it('names and places the repository from a source URL', () => {
    expect(
      describeManifestRepo('ssh://git@git.example.com:12345/fx/fx-workspace.git', dir, 'main'),
    ).toEqual({
      name: 'fx-workspace',
      path: dir,
      branch: 'main',
      project: 'fx',
      upstream: 'ssh://git@git.example.com:12345/fx/fx-workspace.git',
      tags: [],
      origin: 'manifest',
      overridden: [],
    });
  });

  it('gives a checkout used as the source neither a project nor an upstream', () => {
    expect(describeManifestRepo('/Users/me/fx-workspace', dir, 'main')).toMatchObject({
      name: 'fx-workspace',
      path: dir,
      project: undefined,
      origin: 'manifest',
    });
    expect(describeManifestRepo('/Users/me/fx-workspace', dir, 'main')).not.toHaveProperty(
      'upstream',
    );
  });

  it('reads the project out of an scp-style URL too, and keeps the upstream of any URL', () => {
    expect(
      describeManifestRepo('git@git.example.com:fx/fx-workspace.git', dir, 'main'),
    ).toMatchObject({
      name: 'fx-workspace',
      project: 'fx',
      upstream: 'git@git.example.com:fx/fx-workspace.git',
    });
    expect(describeManifestRepo('https://git.example.com/w.git', dir, 'main')).toMatchObject({
      name: 'w',
      project: 'git.example.com',
      upstream: 'https://git.example.com/w.git',
    });
  });

  it('tells a repository spec from a directory the way bootstrap does', () => {
    for (const spec of ['ssh://git@h/fx/w.git', 'git@h:fx/w.git', 'https://h/fx/w', '/tmp/w.git'])
      expect(isRepositoryUrl(spec), spec).toBe(true);
    expect(isRepositoryUrl('/Users/me/fx-workspace')).toBe(false);
    expect(isRepositoryUrl('-')).toBe(false);
  });
});
