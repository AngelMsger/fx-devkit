// Git transport and checkout operations with structured failure recovery.

import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import { shellLine } from '../../domain/shell.js';
import {
  parseAheadBehind,
  parsePorcelainStatus,
  parseRemotes,
  type RepoState,
} from '../../domain/workspace/state.js';
import type { CloneRequest, FastForwardOutcome, Git, RemoteHead } from '../../ports/git.js';
import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

import { lastLine, runGit } from './run.js';

export class SystemGit implements Git {
  constructor(private readonly process: Process) {}

  async clone(request: CloneRequest): Promise<void> {
    const vector = [
      'clone',
      '--quiet',
      '--origin',
      'upstream',
      '--branch',
      request.branch,
      request.upstream,
      request.dir,
    ];
    const result = await this.git(vector);
    if (result.code !== 0) {
      throw new DevkitError(
        gitFailureCategory(result.stderr),
        'GIT_CLONE_FAILED',
        `git clone ${request.upstream} failed: ${lastLine(result.stderr)}`,
        {
          hint: gitFailureHint(result.stderr),
          nextSteps: [
            shellLine(['git', 'ls-remote', '--heads', request.upstream, request.branch]),
            shellLine(['git', ...vector]),
          ],
        },
      );
    }
    if (request.origin !== undefined) await this.addRemote(request.dir, 'origin', request.origin);
  }

  async fetch(dir: string, remote: string): Promise<void> {
    const result = await this.git(['-C', dir, 'fetch', '--quiet', '--prune', remote]);
    if (result.code !== 0) {
      throw new DevkitError(
        gitFailureCategory(result.stderr),
        'GIT_FETCH_FAILED',
        `git fetch ${remote} in ${dir} failed: ${lastLine(result.stderr)}`,
        {
          hint: 'The remote may be unreachable, or the remote name may be wrong.',
          nextSteps: ['fx status', `git -C ${dir} remote -v`],
        },
      );
    }
  }

  async fastForward(dir: string, remote: string, branch: string): Promise<FastForwardOutcome> {
    const state = await this.status(dir);
    const onBranch = state.branch === branch && !state.dirty;
    const ref = onBranch ? 'HEAD' : branch;
    const before = await this.revParse(dir, ref);
    const result = onBranch
      ? await this.git(['-C', dir, 'merge', '--ff-only', '--quiet', `${remote}/${branch}`])
      : await this.git(['-C', dir, 'fetch', '--quiet', remote, `${branch}:${branch}`]);
    if (result.code !== 0) {
      if (/not possible to fast-forward|non-fast-forward/i.test(result.stderr)) return 'diverged';
      throw new DevkitError(
        gitFailureCategory(result.stderr),
        'GIT_FAST_FORWARD_FAILED',
        `Could not update ${branch}: ${lastLine(result.stderr)}`,
        {
          hint: gitFailureHint(result.stderr),
          nextSteps: [
            shellLine(['git', '-C', dir, 'status']),
            shellLine(['git', '-C', dir, 'ls-remote', '--heads', remote, branch]),
          ],
        },
      );
    }
    const after = await this.revParse(dir, ref);
    return before === after ? 'up_to_date' : 'updated';
  }

  async status(dir: string, compareTo?: string): Promise<RepoState> {
    const result = await this.git([
      '-C',
      dir,
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
    ]);
    if (result.code !== 0) {
      throw new DevkitError(
        'conflict',
        'NOT_A_CHECKOUT',
        `${dir} is not a git checkout: ${lastLine(result.stderr)}`,
        {
          nextSteps: ['fx status'],
        },
      );
    }
    const state = parsePorcelainStatus(result.stdout);
    if (compareTo === undefined) return state;
    const counted = await this.git([
      '-C',
      dir,
      'rev-list',
      '--left-right',
      '--count',
      `HEAD...${compareTo}`,
    ]);
    return counted.code === 0 ? { ...state, ...parseAheadBehind(counted.stdout) } : state;
  }

  async toplevel(dir: string): Promise<string | undefined> {
    const result = await this.git(['-C', dir, 'rev-parse', '--show-toplevel']);
    return result.code === 0 ? path.normalize(result.stdout.trim()) : undefined;
  }

  // git answers with a resolved path, while a directory under /tmp or /var is reached
  // through a symbolic link, so both sides are compared as physical paths.
  async isToplevel(dir: string): Promise<boolean> {
    const top = await this.toplevel(dir);
    return top !== undefined && samePath(await realpath(top), await realpath(dir));
  }

  async remotes(dir: string, signal?: AbortSignal): Promise<Record<string, string>> {
    const result = await this.git(['-C', dir, 'remote', '-v'], { signal });
    return result.code === 0 ? parseRemotes(result.stdout) : {};
  }

  async remoteHead(dir: string, remote: string, signal?: AbortSignal): Promise<string | undefined> {
    const ref = `refs/remotes/${remote}/HEAD`;
    const result = await this.git(['-C', dir, 'symbolic-ref', '--short', ref], { signal });
    if (result.code !== 0) return undefined;
    return result.stdout.trim().replace(new RegExp(`^${remote}/`), '') || undefined;
  }

  async addRemote(dir: string, name: string, url: string): Promise<void> {
    const result = await this.git(['-C', dir, 'remote', 'add', name, url]);
    if (result.code !== 0) {
      throw new DevkitError(
        'conflict',
        'GIT_REMOTE_ADD_FAILED',
        `Could not add remote ${name} in ${dir}: ${lastLine(result.stderr)}`,
        {
          nextSteps: [`git -C ${dir} remote -v`],
        },
      );
    }
  }

  async askRemoteHead(
    dir: string,
    remote: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RemoteHead | undefined> {
    const ask = (symref: boolean): Promise<ProcessResult> =>
      this.git(
        ['-C', dir, 'ls-remote', '--quiet', ...(symref ? ['--symref'] : []), remote, 'HEAD'],
        { timeoutMs, signal },
      );
    // A git too old for --symref answers with usage (129); the branch is then unknown.
    let result = await ask(true);
    if (result.code === 129) result = await ask(false);
    const sha = /^([0-9a-f]{40,64})\tHEAD$/m.exec(result.stdout)?.[1];
    if (result.code !== 0 || sha === undefined) return undefined;
    return { sha, branch: /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(result.stdout)?.[1] };
  }

  sha(dir: string, ref: string, signal?: AbortSignal): Promise<string | undefined> {
    return this.revParse(dir, ref, signal);
  }

  private async revParse(
    dir: string,
    ref: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const result = await this.git(['-C', dir, 'rev-parse', '--verify', '--quiet', ref], { signal });
    return result.code === 0 ? result.stdout.trim() : undefined;
  }

  private git(args: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    return runGit(this.process, args, options);
  }
}

function gitFailureCategory(stderr: string): 'not_found' | 'auth' | 'network' | 'conflict' {
  if (
    /remote branch .*not found|couldn't find remote ref|not something we can merge|repository .* does not exist/i.test(
      stderr,
    )
  )
    return 'not_found';
  if (/permission denied|authentication failed|could not read username|access denied/i.test(stderr))
    return 'auth';
  if (
    /could not resolve|unable to access|connection|timed out|network|could not read from remote/i.test(
      stderr,
    )
  )
    return 'network';
  return 'conflict';
}
function gitFailureHint(stderr: string): string {
  const category = gitFailureCategory(stderr);
  if (category === 'not_found') return 'Verify the configured branch still exists on the remote.';
  if (category === 'auth')
    return 'Verify Git transport credentials and repository access; API login is separate.';
  if (category === 'network')
    return 'Check Git transport connectivity and retry after it is restored.';
  return 'Inspect Git diagnostics and local checkout state before retrying; no divergence was inferred.';
}
