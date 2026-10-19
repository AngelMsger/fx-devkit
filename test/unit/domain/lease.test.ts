import { describe, expect, it } from 'vitest';

import {
  hooksLeaseKey,
  projectionLeaseKey,
  withLease,
  workspaceLeaseKey,
} from '../../../src/domain/lease.js';
import { pathKey } from '../../../src/domain/path.js';

function recordingLock(held: boolean) {
  const events: string[] = [];
  return {
    events,
    acquire: async (request: { key: string }) => {
      if (held) return null;
      events.push(`acquire ${request.key}`);
      return {
        release: async () => {
          events.push('release');
        },
      };
    },
  };
}

describe('lease keys', () => {
  it('keeps the text that an fx of another version holds for the same resource', () => {
    expect(workspaceLeaseKey('alpha')).toBe('workspace:alpha');
    expect(hooksLeaseKey('alpha')).toBe('hooks:alpha');
    expect(projectionLeaseKey('/ws/alpha/AGENTS.md')).toBe(
      `projection:${pathKey('/ws/alpha/AGENTS.md')}`,
    );
  });
});

describe('withLease', () => {
  it('releases after the work returns and after it throws', async () => {
    const lock = recordingLock(false);
    const busy = () => new Error('busy');
    expect(
      await withLease(lock, { key: 'k', waitMs: 0 }, busy, async () => {
        lock.events.push('work');
        return 'done';
      }),
    ).toBe('done');
    await expect(
      withLease(lock, { key: 'k', waitMs: 0 }, busy, async () => {
        throw new Error('failed work');
      }),
    ).rejects.toThrow('failed work');
    expect(lock.events).toEqual(['acquire k', 'work', 'release', 'acquire k', 'release']);
  });

  it('raises the caller-supplied error without running the work when the lease is held', async () => {
    const lock = recordingLock(true);
    let ran = false;
    await expect(
      withLease(
        lock,
        { key: 'k', waitMs: 0 },
        () => new Error('held elsewhere'),
        async () => {
          ran = true;
        },
      ),
    ).rejects.toThrow('held elsewhere');
    expect(ran).toBe(false);
  });
});
