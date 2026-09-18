// Materialize and safely refresh Git manifest checkouts, preserving local work.

import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import type { RepoState } from '../../domain/workspace/state.js';
import type { FileReader } from '../../ports/fs.js';
import type { Git } from '../../ports/git.js';
import type {
  ManifestSource,
  ManifestSourceInspection,
  RefreshOutcome,
} from '../../ports/manifest-source.js';
import type { Process } from '../../ports/process.js';

import { PAYLOAD_PATHS } from './payload.js';

export class GitRepoSource implements ManifestSource {
  readonly kind = 'repo';

  constructor(
    private readonly url: string,
    private readonly process: Process,
    private readonly git: Git,
    private readonly localDirectory?: string,
    private readonly fs?: FileReader,
  ) {}

  get description(): string {
    return this.url;
  }

  async inspect(currentDir?: string): Promise<ManifestSourceInspection | undefined> {
    if (currentDir !== undefined) return this.inspectRefresh(currentDir);
    return this.localDirectory === undefined
      ? undefined
      : this.inspectCommit(this.localDirectory, 'HEAD');
  }

  private async inspectRefresh(dir: string): Promise<ManifestSourceInspection | undefined> {
    const branch = (await this.git.remoteHead(dir, 'upstream')) ?? 'main';
    const state = await this.git.status(dir);
    if (state.branch !== branch || (await this.worktreeProtection(dir, state)) !== undefined)
      return this.inspectWorktree(dir);
    if (this.localDirectory === undefined) return undefined;
    const head = await this.git.sha(dir, 'HEAD');
    if (head === undefined) return undefined;
    const ancestor = await this.process.run([
      'git',
      '-C',
      this.localDirectory,
      'merge-base',
      '--is-ancestor',
      head,
      branch,
    ]);
    if (ancestor.code === 1) return this.inspectWorktree(dir);
    if (ancestor.code !== 0) return undefined;
    return this.inspectCommit(this.localDirectory, branch);
  }

  private async worktreeProtection(dir: string, state: RepoState): Promise<string | undefined> {
    if (state.dirty) return `uncommitted changes on ${state.branch ?? 'a detached HEAD'}`;
    if (state.untracked > 0) return 'untracked files in the manifest source';
    const [untracked, ignored] = await Promise.all([
      this.process.run(['git', '-C', dir, 'ls-files', '--others', '--exclude-standard']),
      this.process.run([
        'git',
        '-C',
        dir,
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--',
        ...PAYLOAD_PATHS.map((file) => file.split(path.sep).join('/')),
      ]),
    ]);
    if (untracked.code !== 0 || ignored.code !== 0)
      return 'source payload status could not be verified; the manifest worktree was preserved';
    if (untracked.stdout.length > 0) return 'untracked files in the manifest source';
    if (ignored.stdout.length > 0)
      return 'ignored source payload affects workspace preparation; the manifest worktree was preserved';
    return undefined;
  }

  private inspectWorktree(dir: string): ManifestSourceInspection | undefined {
    const fs = this.fs;
    return fs === undefined
      ? undefined
      : { root: dir, contents: 'worktree', readText: (file) => fs.readText(path.join(dir, file)) };
  }

  private inspectCommit(dir: string, ref: string): ManifestSourceInspection {
    return {
      root: `${dir}@${ref}`,
      contents: 'commit',
      readText: async (file) => {
        const result = await this.process.run(['git', '-C', dir, 'show', `${ref}:${file}`]);
        if (result.code === 0) return result.stdout;
        if (file !== 'manifest/workspace.yaml') return undefined;
        throw new DevkitError(
          'config',
          'MANIFEST_SOURCE_INVALID',
          'Local Git source has no committed manifest/workspace.yaml',
          {
            nextSteps: [
              'Commit the manifest source before initializing, or use a directory snapshot.',
            ],
          },
        );
      },
    };
  }

  async materialize(dir: string): Promise<void> {
    const top = await this.git.toplevel(dir);
    if (top !== undefined && top === (await realpath(dir))) {
      const remotes = await this.git.remotes(dir);
      if (remotes['upstream'] !== this.url)
        throw new DevkitError(
          'conflict',
          'SOURCE_MISMATCH',
          'Existing manifest checkout has a different upstream',
          { nextSteps: ['Inspect the existing source checkout before retrying.'] },
        );
      await this.refresh(dir);
      return;
    }
    const result = await this.process.run([
      'git',
      'clone',
      '--quiet',
      '--origin',
      'upstream',
      this.url,
      dir,
    ]);
    if (result.code !== 0) {
      throw new DevkitError(
        'network',
        'MANIFEST_CLONE_FAILED',
        `Could not clone ${this.url}: ${lastLine(result.stderr)}`,
        {
          hint: 'The manifest repository must be reachable and readable with your git credentials.',
          nextSteps: [`git clone ${this.url}`],
        },
      );
    }
  }

  async refresh(dir: string): Promise<RefreshOutcome> {
    try {
      await this.git.fetch(dir, 'upstream');
    } catch (err) {
      throw new DevkitError(
        'network',
        'MANIFEST_REFRESH_FAILED',
        `Could not fetch the manifest repository into ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        {
          hint: 'The manifest repository must be reachable with your git credentials.',
          nextSteps: [`git -C ${dir} fetch upstream`],
        },
      );
    }
    const branch = (await this.git.remoteHead(dir, 'upstream')) ?? 'main';
    const state = await this.git.status(dir);
    const kept = (reason: string): RefreshOutcome => ({ result: 'kept', reason });
    const onBranch = state.branch === branch;
    const protection = await this.worktreeProtection(dir, state);
    if (protection !== undefined) return kept(protection);
    const outcome = await this.git.fastForward(dir, 'upstream', branch);
    if (outcome === 'diverged') {
      const suffix = onBranch ? '' : '; its ref was not moved';
      return kept(`local commits on ${branch} diverge from upstream${suffix}`);
    }
    if (!onBranch)
      return kept(
        `on ${state.branch ?? 'a detached HEAD'}, not ${branch}; only the ${branch} ref moved`,
      );
    return { result: outcome };
  }
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n');
  return lines[lines.length - 1] ?? '';
}
