// The Git port over the system `git`. Every vector is assembled here and
// nowhere else; a failure to reach a remote is a network error carrying
// git's own explanation, and a refused fast-forward is a value, not a fault.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import {
  parseAheadBehind,
  parsePorcelainStatus,
  parseRemotes,
  type RepoState,
} from '../../domain/workspace/state.js';
import type { CloneRequest, FastForwardOutcome, Git, RemoteHead } from '../../ports/git.js';
import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

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
        'network',
        'GIT_CLONE_FAILED',
        `git clone ${request.upstream} failed: ${lastLine(result.stderr)}`,
        {
          hint: 'The remote may be unreachable, or you may lack access to it.',
          nextSteps: ['fx repo list --unreadable', `git clone ${request.upstream}`],
        },
      );
    }
    if (request.origin !== undefined) await this.addRemote(request.dir, 'origin', request.origin);
  }

  async fetch(dir: string, remote: string): Promise<void> {
    const result = await this.git(['-C', dir, 'fetch', '--quiet', remote]);
    if (result.code !== 0) {
      throw new DevkitError(
        'network',
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
    if (result.code !== 0) return 'diverged';
    const after = await this.revParse(dir, ref);
    return before === after ? 'up_to_date' : 'updated';
  }

  async status(dir: string, compareTo?: string): Promise<RepoState> {
    const result = await this.git(['-C', dir, 'status', '--porcelain=v2', '--branch']);
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
        `could not add remote ${name} in ${dir}: ${lastLine(result.stderr)}`,
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

  private async git(args: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    const result = await this.process.run(['git', ...args], options);
    if (result.code === 127) {
      throw new DevkitError('config', 'TOOL_MISSING', 'git is not installed or not on PATH', {
        nextSteps: ['fx can git'],
      });
    }
    return result;
  }
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n');
  return lines[lines.length - 1] ?? '';
}
