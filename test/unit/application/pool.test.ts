// The pool bounds how much runs at once and answers in input order however the work
// finishes. Callers rely on both and only pass their `jobs` through.
import { describe, expect, it } from 'vitest';

import { pooled } from '../../../src/application/pool.js';
import { HeldWork, settled } from '../../held-work.js';

function held() {
  const work = new HeldWork<string>();
  const run = async (item: string): Promise<string> => {
    await work.hold(item);
    return item.toUpperCase();
  };
  return { work, run };
}

describe('pooled', () => {
  it('starts the next item only when one of the running ones finishes', async () => {
    const { work, run } = held();
    const results = pooled(['a', 'b', 'c', 'd'], 2, run);
    await work.reached(2);
    expect(work.started).toEqual(['a', 'b']);

    work.release('b');
    await work.reached(3);
    expect(work.started, 'a is still running, so only one more starts').toEqual(['a', 'b', 'c']);

    work.releaseAll();
    expect(await results).toEqual(['A', 'B', 'C', 'D']);
  });

  it('answers in input order whatever order the work finishes in', async () => {
    const { work, run } = held();
    const results = pooled(['a', 'b', 'c'], 3, run);
    await work.reached(3);
    for (const item of ['c', 'a', 'b']) {
      work.release(item);
      await settled();
    }
    expect(await results).toEqual(['A', 'B', 'C']);
  });

  it.each([
    { jobs: 9, limit: 'above the number of items', atOnce: ['a', 'b', 'c'] },
    { jobs: 0, limit: 'of zero', atOnce: ['a'] },
    { jobs: -3, limit: 'below zero', atOnce: ['a'] },
  ])('runs $atOnce.length at once under a limit $limit', async ({ jobs, atOnce }) => {
    const { work, run } = held();
    const results = pooled(['a', 'b', 'c'], jobs, run);
    await work.reached(atOnce.length);
    expect(work.started).toEqual(atOnce);
    work.releaseAll();
    expect(await results).toEqual(['A', 'B', 'C']);
  });

  it('answers an empty list without running anything', async () => {
    const { work, run } = held();
    expect(await pooled([], 4, run)).toEqual([]);
    expect(work.started).toEqual([]);
  });

  it('rejects with the failure of an item, and a single worker starts nothing after it', async () => {
    const failure = new Error('b failed');
    const started: string[] = [];
    const run = async (item: string): Promise<string> => {
      started.push(item);
      if (item === 'b') throw failure;
      return item;
    };
    await expect(pooled(['a', 'b', 'c'], 1, run)).rejects.toBe(failure);
    expect(started).toEqual(['a', 'b']);
  });
});
