import { describe, expectTypeOf, it } from 'vitest';

import type { CodeHostContributionWrites, CodeHostQueries } from '../../../src/ports/code-host.js';

describe('the contribution platform write surface', () => {
  it('exposes exactly createPullRequest to contribution writers and leaves release queries narrow', () => {
    expectTypeOf<keyof CodeHostContributionWrites>().toEqualTypeOf<'createPullRequest'>();
    expectTypeOf<keyof CodeHostQueries>().toEqualTypeOf<
      'branches' | 'compare' | 'commit' | 'readFile'
    >();
  });
});
