import { describe, expect, it } from 'vitest';

import type { ResolvedRepo } from '../../../../src/domain/manifest/local.js';
import {
  planSync,
  type DiskState,
  type SyncPlanInput,
} from '../../../../src/domain/workspace/plan.js';
import type { RepoState } from '../../../../src/domain/workspace/state.js';
import { deriveStatus } from '../../../../src/domain/workspace/status.js';

const repo = (name: string, extra: Partial<ResolvedRepo> = {}): ResolvedRepo => ({
  name,
  path: name,
  branch: 'dev',
  project: 'fx',
  tags: [],
  origin: 'shared',
  overridden: [],
  ...extra,
});

const clean: RepoState = { branch: 'dev', dirty: false, untracked: 0, ahead: 0, behind: 0 };
const upstream = 'ssh://git@git.example.com:12345/fx/a.git';
const checkout = (
  state: Partial<RepoState> = {},
  remotes: Record<string, string> = { upstream },
): DiskState => ({
  kind: 'checkout',
  state: { ...clean, ...state },
  remotes,
});

function plan(disk: DiskState, extra: Partial<SyncPlanInput> = {}) {
  const input: SyncPlanInput = {
    repos: [repo('a')],
    available: [],
    states: { a: disk },
    readability: {},
    urls: { a: { upstream, origin: 'ssh://git@git.example.com:12345/~alice/a.git' } },
    contacts: { fx: '#platform' },
    ...extra,
  };
  return planSync(input).items[0]!;
}

describe('planSync', () => {
  it('clones a missing readable repository with both remotes', () => {
    expect(plan({ kind: 'absent' }, { readability: { a: 'readable' } })).toMatchObject({
      action: 'clone',
      upstream,
      origin: 'ssh://git@git.example.com:12345/~alice/a.git',
    });
  });

  it('still tries to clone when readability could not be determined', () => {
    expect(plan({ kind: 'absent' }, { readability: { a: 'unknown' } }).action).toBe('clone');
  });

  it('lists an unreadable repository with the project contact instead of cloning', () => {
    const item = plan({ kind: 'absent' }, { readability: { a: 'forbidden' } });
    expect(item).toMatchObject({ action: 'unreadable', contact: '#platform' });
    expect(plan({ kind: 'absent' }, { readability: { a: 'missing' } }).action).toBe('unreadable');
  });

  it('skips a directory that exists but is not a checkout', () => {
    expect(plan({ kind: 'not_git' })).toMatchObject({ action: 'skip_not_git', fetch: false });
  });

  it('skips a dirty checkout on the tracked branch but still fetches', () => {
    expect(plan(checkout({ dirty: true }))).toMatchObject({ action: 'skip_dirty', fetch: true });
  });

  it('moves only the ref when the checkout sits on another branch, dirty or not', () => {
    expect(plan(checkout({ branch: 'feature/x', dirty: true }))).toMatchObject({
      action: 'fast_forward',
      mode: 'ref',
    });
    expect(plan(checkout({ branch: undefined }))).toMatchObject({
      action: 'fast_forward',
      mode: 'ref',
    });
  });

  it('fast-forwards a clean checkout on the tracked branch by merging', () => {
    expect(plan(checkout())).toMatchObject({ action: 'fast_forward', mode: 'merge', fetch: true });
    expect(plan(checkout({ untracked: 3 })).action).toBe('fast_forward');
  });

  it('skips a checkout that is already known to have diverged', () => {
    expect(plan(checkout({ ahead: 1, behind: 2 }))).toMatchObject({
      action: 'skip_diverged',
      fetch: true,
    });
    expect(plan(checkout({ ahead: 1 })).action).toBe('fast_forward');
  });

  it('names the fork to add as origin when a checkout has none and the user is known', () => {
    const fork = 'ssh://git@git.example.com:12345/~alice/a.git';
    expect(plan(checkout())).toMatchObject({ action: 'fast_forward', origin: fork });
    expect(plan(checkout({ dirty: true }))).toMatchObject({ action: 'skip_dirty', origin: fork });
    expect(plan(checkout({}, { upstream, origin: 'ssh://elsewhere/a.git' }))).not.toHaveProperty(
      'origin',
    );
    expect(plan(checkout(), { urls: { a: { upstream } } })).not.toHaveProperty('origin');
  });

  it('leaves the manifest checkout to the refresh, apart from its fork remote', () => {
    const manifest = plan(checkout({ dirty: true }), {
      repos: [repo('a', { origin: 'manifest' })],
    });
    expect(manifest).toMatchObject({
      action: 'skip_manifest',
      fetch: false,
      origin: 'ssh://git@git.example.com:12345/~alice/a.git',
    });
    expect(
      plan(checkout({}, { upstream, origin: 'x' }), { repos: [repo('a', { origin: 'manifest' })] }),
    ).not.toHaveProperty('origin');
  });

  it('never touches a checkout whose upstream remote is not the expected one', () => {
    const item = plan(checkout({}, { upstream: 'ssh://git@elsewhere.example.com/a.git' }));
    expect(item).toMatchObject({ action: 'skip_remote_mismatch', fetch: false });
    expect(item.reason).toContain('elsewhere');
  });

  it('accepts a checkout without an upstream remote when only origin is known', () => {
    expect(plan(checkout({}, { origin: 'x' })).action).toBe('skip_remote_mismatch');
  });

  it('leaves unpicked repositories alone and says how to pick them', () => {
    const items = planSync({
      repos: [repo('a')],
      available: ['b'],
      states: { a: { kind: 'absent' } },
      readability: { a: 'readable' },
      urls: { a: { upstream } },
      contacts: {},
    }).items;
    expect(items.map((i) => [i.name, i.action])).toEqual([
      ['a', 'clone'],
      ['b', 'skip_unpicked'],
    ]);
    expect(items[1]?.reason).toContain('fx repo pick b');
  });

  it('cannot clone a repository with no upstream at all', () => {
    expect(plan({ kind: 'absent' }, { urls: { a: { upstream: undefined } } })).toMatchObject({
      action: 'unreadable',
    });
  });

  it('produces no write action for dirty or diverged checkouts', () => {
    for (const disk of [checkout({ dirty: true }), checkout({ ahead: 1, behind: 1 })]) {
      expect(['skip_dirty', 'skip_diverged']).toContain(plan(disk).action);
    }
  });
});

describe('deriveStatus', () => {
  it('describes a healthy checkout', () => {
    expect(deriveStatus(repo('a'), checkout(), upstream)).toEqual({
      name: 'a',
      path: 'a',
      exists: true,
      branch: 'dev',
      tracked_branch: 'dev',
      dirty: false,
      untracked: 0,
      uncommitted: false,
      ahead: 0,
      behind: 0,
      remotes_ok: true,
      note: null,
    });
  });

  it('notes the deviation in one sentence', () => {
    expect(deriveStatus(repo('a'), checkout({ branch: 'feature/x' }), upstream).note).toBe(
      'on feature/x',
    );
    expect(deriveStatus(repo('a'), checkout({ branch: undefined }), upstream).note).toBe(
      'detached HEAD',
    );
    expect(deriveStatus(repo('a'), checkout({}, { upstream: 'x' }), upstream)).toMatchObject({
      remotes_ok: false,
      note: expect.stringContaining('x'),
    });
    expect(deriveStatus(repo('a'), { kind: 'absent' }, upstream)).toMatchObject({
      exists: false,
      note: 'not cloned',
    });
    expect(deriveStatus(repo('a'), { kind: 'not_git' }, upstream).note).toBe('not a git checkout');
  });
});
