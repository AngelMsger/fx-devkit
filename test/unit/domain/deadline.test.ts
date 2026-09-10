import { describe, expect, it } from 'vitest';

import { withDeadline } from '../../../src/domain/deadline.js';

describe('withDeadline', () => {
  it('returns the work in time, the fallback when late or thrown, and tells late work to stop', async () => {
    expect(await withDeadline(async () => 1, 50, 0)).toBe(1);
    expect(await withDeadline(() => Promise.reject(new Error('x')), 50, 0)).toBe(0);
    expect(
      await withDeadline(
        () => {
          throw new Error('sync');
        },
        50,
        0,
      ),
    ).toBe(0);
    let seen: AbortSignal | undefined;
    const late = await withDeadline(
      (signal) => {
        seen = signal;
        return new Promise<number>(() => undefined);
      },
      20,
      0,
    );
    expect(late).toBe(0);
    expect(seen?.aborted).toBe(true);
  });
});
