// One row of `fx status`: the facts, plus one sentence when something
// deviates from "clean, on the tracked branch, pointed at upstream".

import type { ResolvedRepo } from '../manifest/local.js';

import type { DiskState } from './plan.js';

export interface StatusRow {
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
  readonly branch: string | null;
  readonly tracked_branch: string | null;
  readonly dirty: boolean;
  readonly untracked: number;
  readonly uncommitted: boolean;
  readonly ahead: number;
  readonly behind: number;
  readonly remotes_ok: boolean;
  readonly note: string | null;
}

export function deriveStatus(
  repo: ResolvedRepo,
  disk: DiskState,
  expectedUpstream: string | undefined,
): StatusRow {
  const base = {
    name: repo.name,
    path: repo.path,
    tracked_branch: repo.branch ?? null,
    dirty: false,
    untracked: 0,
    uncommitted: false,
    ahead: 0,
    behind: 0,
  };
  if (disk.kind === 'absent')
    return { ...base, exists: false, branch: null, remotes_ok: false, note: 'not cloned' };
  if (disk.kind === 'not_git')
    return { ...base, exists: true, branch: null, remotes_ok: false, note: 'not a git checkout' };

  const actual = disk.remotes['upstream'];
  const remotesOk = expectedUpstream === undefined || actual === expectedUpstream;
  const { state } = disk;
  const notes: string[] = [];
  if (!remotesOk)
    notes.push(actual === undefined ? 'no upstream remote' : `upstream remote is ${actual}`);
  if (state.branch === undefined) notes.push('detached HEAD');
  else if (state.branch !== repo.branch) notes.push(`on ${state.branch}`);
  return {
    ...base,
    exists: true,
    branch: state.branch ?? null,
    dirty: state.dirty,
    untracked: state.untracked,
    uncommitted: state.dirty || state.untracked > 0,
    ahead: state.ahead,
    behind: state.behind,
    remotes_ok: remotesOk,
    note: notes.length === 0 ? null : notes.join('; '),
  };
}
