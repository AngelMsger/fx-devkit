// Git as sync and status need it, and nothing more: there is deliberately no checkout,
// reset, stash, rebase or merge here, so "sync never destroys work" holds at the type
// level. A fast-forward on the checked-out branch is the one merge that can happen, and
// only when the tree is clean; on any other branch only the branch ref moves.

import type { RepoState } from '../domain/workspace/state.js';

export interface CloneRequest {
  readonly dir: string;
  readonly upstream: string;
  readonly origin?: string | undefined;
  readonly branch: string;
}

export type FastForwardOutcome = 'updated' | 'up_to_date' | 'diverged';

export interface Git {
  clone(request: CloneRequest): Promise<void>;
  fetch(dir: string, remote: string): Promise<void>;
  fastForward(dir: string, remote: string, branch: string): Promise<FastForwardOutcome>;
  status(dir: string, compareTo?: string): Promise<RepoState>;
  toplevel(dir: string): Promise<string | undefined>;
  // Whether `dir` is itself the top of a checkout, not a directory inside one.
  isToplevel(dir: string): Promise<boolean>;
  remotes(dir: string, signal?: AbortSignal): Promise<Record<string, string>>;
  // The branch a remote's HEAD points at, e.g. `main` for refs/remotes/<remote>/HEAD.
  remoteHead(dir: string, remote: string, signal?: AbortSignal): Promise<string | undefined>;
  addRemote(dir: string, name: string, url: string): Promise<void>;
  // Where a remote's HEAD is right now, asked of the remote itself (no
  // fetch); undefined when it does not answer in time. The branch is absent
  // when the remote does not say.
  askRemoteHead(
    dir: string,
    remote: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RemoteHead | undefined>;
  sha(dir: string, ref: string, signal?: AbortSignal): Promise<string | undefined>;
}

export interface RemoteHead {
  readonly sha: string;
  readonly branch: string | undefined;
}
