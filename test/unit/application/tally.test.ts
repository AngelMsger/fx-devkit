// A tally is what a watcher is told about counted work; it must stay true however the
// work goes and must not outlive it.
import { describe, expect, it } from 'vitest';

import { Tally } from '../../../src/application/tally.js';
import { FakeActivity } from '../../fakes/fake-activity.js';

describe('Tally', () => {
  it('counts planned units as they start and finish, a failed one included', async () => {
    const activity = new FakeActivity();
    await Tally.during(activity, 'checks', async (checks) => {
      checks.plan(2);
      await checks.unit('api', async () => undefined);
      await expect(
        checks.unit('web', async () => {
          throw new Error('unreachable');
        }),
      ).rejects.toThrow('unreachable');
    });
    expect(activity.of('checks')).toEqual([
      { phase: undefined, total: 2, completed: 0, active: [] },
      { phase: undefined, total: 2, completed: 0, active: ['api'] },
      { phase: undefined, total: 2, completed: 1, active: [] },
      { phase: undefined, total: 2, completed: 1, active: ['web'] },
      { phase: undefined, total: 2, completed: 2, active: [] },
    ]);
  });

  it('counts each pass from zero and ends with the work, even when the work fails', async () => {
    const activity = new FakeActivity();
    await expect(
      Tally.during(activity, 'repos', async (repos) => {
        await repos
          .enter('preflight')
          .plan(1)
          .unit('api', async () => undefined);
        expect(repos.enter('apply').plan(3).count).toEqual({
          phase: 'apply',
          total: 3,
          completed: 0,
          active: [],
        });
        throw new Error('interrupted');
      }),
    ).rejects.toThrow('interrupted');
    expect(activity.counts.at(-1)).toEqual({ id: 'repos', count: undefined });
  });

  it('says nothing more once the work is over, though a unit of it still runs', async () => {
    const activity = new FakeActivity();
    let finish = (): void => undefined;
    const straggler = new Promise<void>((resolve) => (finish = resolve));
    let running: Promise<void> = Promise.resolve();
    await expect(
      Tally.during(activity, 'repos', async (repos) => {
        repos.plan(2);
        running = repos.unit('api', () => straggler);
        await repos.unit('web', async () => {
          throw new Error('unreachable');
        });
      }),
    ).rejects.toThrow('unreachable');
    finish();
    await running;
    expect(activity.counts.at(-1)).toEqual({ id: 'repos', count: undefined });
  });
});
