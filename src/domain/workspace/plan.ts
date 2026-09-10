// What sync would do to each repository, decided from facts alone. This is
// the whole safety argument of sync in one table: a plan item is either a
// clone into an empty place, a fast-forward that git itself refuses when it
// is not one, or a skip with its reason. Nothing here can lose work. An
// item's `origin` is the fork remote to add when the checkout has none.

import type { ResolvedRepo } from '../manifest/local.js';

import type { RepoState } from './state.js';

export type Readability = 'readable' | 'forbidden' | 'missing' | 'unknown';

export type DiskState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'not_git' }
  | {
      readonly kind: 'checkout';
      readonly state: RepoState;
      readonly remotes: Readonly<Record<string, string>>;
    };

export type SyncAction =
  | 'clone'
  | 'fast_forward'
  | 'skip_dirty'
  | 'skip_diverged'
  | 'skip_unpicked'
  | 'skip_not_git'
  | 'skip_remote_mismatch'
  | 'skip_manifest'
  | 'unreadable';

export interface RepoUrls {
  readonly upstream: string | undefined;
  readonly origin?: string | undefined;
}

export interface SyncPlanInput {
  readonly repos: readonly ResolvedRepo[];
  readonly available: readonly string[];
  readonly states: Readonly<Record<string, DiskState>>;
  readonly readability: Readonly<Record<string, Readability>>;
  readonly urls: Readonly<Record<string, RepoUrls>>;
  readonly contacts: Readonly<Record<string, string>>;
}

export interface PlanItem {
  readonly name: string;
  readonly path: string;
  readonly branch: string | undefined;
  readonly action: SyncAction;
  readonly mode?: 'merge' | 'ref';
  readonly fetch: boolean;
  readonly reason?: string;
  readonly upstream?: string;
  readonly origin?: string;
  readonly contact?: string;
}

export interface SyncPlan {
  readonly items: readonly PlanItem[];
}

export function planSync(input: SyncPlanInput): SyncPlan {
  const picked = input.repos.map((repo) => decide(repo, input));
  const unpicked = input.available.map<PlanItem>((name) => ({
    name,
    path: name,
    branch: undefined,
    action: 'skip_unpicked',
    fetch: false,
    reason: `not selected on this machine; fx repo pick ${name}`,
  }));
  return { items: [...picked, ...unpicked] };
}

type Base = Pick<PlanItem, 'name' | 'path' | 'branch'>;

function decide(repo: ResolvedRepo, input: SyncPlanInput): PlanItem {
  const disk = input.states[repo.name] ?? { kind: 'absent' };
  const urls = input.urls[repo.name] ?? { upstream: undefined };
  const base: Base = { name: repo.name, path: repo.path, branch: repo.branch };
  if (disk.kind === 'not_git') {
    return {
      ...base,
      action: 'skip_not_git',
      fetch: false,
      reason: 'directory exists but is not a git checkout',
    };
  }
  if (disk.kind === 'absent') return decideAbsent(base, repo, urls, input);
  // The manifest checkout is pulled before the workspace loads; here it only gets its fork.
  if (repo.origin === 'manifest') {
    return {
      ...base,
      ...forkToAdd(disk.remotes, urls),
      action: 'skip_manifest',
      fetch: false,
      reason: 'refreshed before the workspace loaded',
    };
  }
  return decideCheckout(base, repo, urls, disk.remotes, disk.state);
}

function forkToAdd(
  remotes: Readonly<Record<string, string>>,
  urls: RepoUrls,
): Pick<PlanItem, 'origin'> {
  return remotes['origin'] === undefined && urls.origin !== undefined
    ? { origin: urls.origin }
    : {};
}

function decideAbsent(
  base: Base,
  repo: ResolvedRepo,
  urls: RepoUrls,
  input: SyncPlanInput,
): PlanItem {
  const contact = repo.project === undefined ? undefined : input.contacts[repo.project];
  const unreadable = (reason: string): PlanItem => ({
    ...base,
    action: 'unreadable',
    fetch: false,
    reason,
    ...(urls.upstream === undefined ? {} : { upstream: urls.upstream }),
    ...(contact === undefined ? {} : { contact }),
  });
  if (urls.upstream === undefined)
    return unreadable('no upstream URL: the entry names neither a project nor an upstream');
  const readability = input.readability[repo.name] ?? 'unknown';
  if (readability === 'forbidden' || readability === 'missing')
    return unreadable(`${readability} on the code host`);
  if (repo.branch === undefined) return unreadable('no branch to track');
  return {
    ...base,
    action: 'clone',
    fetch: false,
    upstream: urls.upstream,
    ...(urls.origin === undefined ? {} : { origin: urls.origin }),
  };
}

function decideCheckout(
  base: Base,
  repo: ResolvedRepo,
  urls: RepoUrls,
  remotes: Readonly<Record<string, string>>,
  state: RepoState,
): PlanItem {
  const actual = remotes['upstream'];
  if (urls.upstream !== undefined && actual !== urls.upstream) {
    const reason =
      actual === undefined
        ? 'no upstream remote'
        : `upstream remote is ${actual}, expected ${urls.upstream}`;
    return { ...base, action: 'skip_remote_mismatch', fetch: false, reason };
  }
  const origin = forkToAdd(remotes, urls);
  if (state.branch !== repo.branch) {
    const reason =
      state.branch === undefined
        ? 'detached HEAD; only the branch ref moves'
        : `on ${state.branch}; only the ${repo.branch} ref moves`;
    return { ...base, ...origin, action: 'fast_forward', mode: 'ref', fetch: true, reason };
  }
  if (state.dirty)
    return {
      ...base,
      ...origin,
      action: 'skip_dirty',
      fetch: true,
      reason: 'uncommitted changes on the tracked branch',
    };
  if (state.ahead > 0 && state.behind > 0) {
    return {
      ...base,
      ...origin,
      action: 'skip_diverged',
      fetch: true,
      reason: `${state.ahead} ahead and ${state.behind} behind upstream`,
    };
  }
  return { ...base, ...origin, action: 'fast_forward', mode: 'merge', fetch: true };
}
