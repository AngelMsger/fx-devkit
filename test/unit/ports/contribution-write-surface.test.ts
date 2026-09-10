import { describe, expect, expectTypeOf, it } from 'vitest';

import { BitbucketCodeHost } from '../../../src/adapters/code-host/bitbucket-cli/provider.js';
import { LocalGitCodeHost } from '../../../src/adapters/code-host/local-git/provider.js';
import type { CodeHostContributionWrites, CodeHostQueries } from '../../../src/ports/code-host.js';

const QUERIES_AND_HELPERS = [
  'constructor',
  'host',
  'git',
  'whoami',
  'canRead',
  'branches',
  'compare',
  'commit',
  'readFile',
  'upstreamUrl',
  'forkUrl',
  'webUrl',
  'repositoryIdentity',
  'pullRequest',
];

describe('the contribution platform write surface', () => {
  it('exposes exactly createPullRequest to contribution writers and leaves release queries narrow', () => {
    expectTypeOf<keyof CodeHostContributionWrites>().toEqualTypeOf<'createPullRequest'>();
    expectTypeOf<keyof CodeHostQueries>().toEqualTypeOf<
      'branches' | 'compare' | 'commit' | 'readFile'
    >();
  });
  it.each([BitbucketCodeHost, LocalGitCodeHost])(
    'separates the legacy fork from the only new write on %s',
    (ctor) => {
      const writes = Object.getOwnPropertyNames(ctor.prototype).filter(
        (name) => !QUERIES_AND_HELPERS.includes(name),
      );
      expect(new Set(writes)).toEqual(new Set(['fork', 'createPullRequest']));
    },
  );
});
