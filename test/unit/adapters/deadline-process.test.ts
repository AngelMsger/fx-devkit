import { describe, expect, it } from 'vitest';

import { DeadlineProcess } from '../../../src/adapters/process/deadline-process.js';
import { FakeProcess } from '../../fakes/fake-process.js';

function lent(budget: { totalMs: number; commandMs: number }, asked?: number): Promise<unknown> {
  const inner = new FakeProcess().always({ code: 0, stdout: '', stderr: '' });
  const options = asked === undefined ? {} : { timeoutMs: asked };
  return new DeadlineProcess(inner, budget)
    .run(['companion', 'check'], options)
    .then(() => inner.soleCallTo(['companion']).options.timeoutMs);
}

describe('DeadlineProcess', () => {
  it('lends a command its own limit at most, and a shorter request as asked', async () => {
    const budget = { totalMs: 60_000, commandMs: 500 };
    expect(await lent(budget)).toBe(500);
    expect(await lent(budget, 60_000)).toBe(500);
    expect(await lent(budget, 100)).toBe(100);
  });

  it('still starts a command once the task budget is spent, with no time to lend', async () => {
    expect(await lent({ totalMs: 0, commandMs: 500 })).toBe(1);
  });
});
