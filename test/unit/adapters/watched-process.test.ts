// Whatever fx starts is what a watcher is waiting on. The label is the caller's own
// name for the call or the executable alone, and a child that owns the terminal gets it.
import { describe, expect, it } from 'vitest';

import { WatchedProcess } from '../../../src/adapters/process/watched-process.js';
import type { Activity, Release } from '../../../src/ports/activity.js';
import { FakeProcess } from '../../fakes/fake-process.js';

function watcher(): Activity & { readonly said: string[] } {
  const said: string[] = [];
  const until =
    (what: string): Release =>
    () =>
      void said.push(`end ${what}`);
  return {
    said,
    waiting: ({ label, mayAsk }) => {
      said.push(`wait ${label}${mayAsk ? ', may ask' : ''}`);
      return until(label);
    },
    handover: () => {
      said.push('handover');
      return until('handover');
    },
    counted: () => undefined,
  };
}

describe('WatchedProcess', () => {
  it('names a call by its phase, or by its executable and never by its arguments', async () => {
    const watch = watcher();
    const process = new WatchedProcess(new FakeProcess().always(ok()), watch);
    await process.run(['/opt/tools/bin/logs', 'query', '--token', 'private-token'], {
      diagnostic: { phase: 'logs.access@test check' },
    });
    await process.run(['/opt/tools/bin/logs', 'query', '--token', 'private-token']);
    expect(watch.said).toEqual([
      'wait logs.access@test check, may ask',
      'end logs.access@test check',
      'wait logs, may ask',
      'end logs',
    ]);
  });

  it('knows a call given no deadline stays in the terminal session, where it can ask', async () => {
    const watch = watcher();
    const process = new WatchedProcess(new FakeProcess().always(ok()), watch);
    await process.run(['git', 'fetch', 'upstream']);
    await process.run(['logs', 'auth', 'status'], { timeoutMs: 30_000 });
    // Only a bounded call leaves the session, and Windows keeps even that one within reach.
    const apart = globalThis.process.platform === 'win32' ? ', may ask' : '';
    expect(watch.said).toEqual(['wait git, may ask', 'end git', `wait logs${apart}`, 'end logs']);
  });

  it('hands the terminal to a child that owns it and takes it back when the child fails', async () => {
    const watch = watcher();
    const inner = new FakeProcess();
    inner.run = async () => {
      throw new Error('spawn failed');
    };
    await expect(
      new WatchedProcess(inner, watch).run(['logs', 'auth', 'login'], { interactive: true }),
    ).rejects.toThrow('spawn failed');
    expect(watch.said).toEqual(['handover', 'end handover']);
  });
});

function ok(): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout: '', stderr: '' };
}
