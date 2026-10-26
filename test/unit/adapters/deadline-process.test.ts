import { describe, expect, it } from 'vitest';

import { DeadlineProcess } from '../../../src/adapters/process/deadline-process.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const DONE = { code: 0, stdout: '', stderr: '' };
const OWN_DEADLINE = { flag: '--timeout', minimumMs: 10_000 };

function lent(budget: { totalMs: number; commandMs: number }, asked?: number): Promise<unknown> {
  const inner = new FakeProcess().always(DONE);
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

  it('tells a command that takes its own deadline a second less than the run has left, among its flags', async () => {
    const inner = new FakeProcess().always(DONE);
    await new DeadlineProcess(inner, { totalMs: 12_900, commandMs: 15_000 }).run(
      ['companion', 'reuse', '--', 'name'],
      { timeoutMs: 30_000, deadline: OWN_DEADLINE },
    );
    const call = inner.soleCallTo(['companion']);
    expect(call.vector).toEqual(['companion', 'reuse', '--timeout', '11s', '--', 'name']);
    expect(call.options.timeoutMs).toBeGreaterThan(11_900);
    expect(call.options.timeoutMs).toBeLessThanOrEqual(12_900);
  });

  it('starts no command its share would leave short of the time it needs to answer', async () => {
    const inner = new FakeProcess().always(DONE);
    const process = new DeadlineProcess(inner, { totalMs: 10_500, commandMs: 15_000 });
    await expect(
      process.run(['companion', 'reuse'], { deadline: OWN_DEADLINE }),
    ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
    expect(inner.calls).toEqual([]);
  });
});
