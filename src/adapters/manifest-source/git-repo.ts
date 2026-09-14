// Materialize and safely refresh Git manifest checkouts, preserving local work.

import { realpath } from 'node:fs/promises';

import { DevkitError } from '../../domain/errors.js';
import type { Git } from '../../ports/git.js';
import type { ManifestSource, RefreshOutcome } from '../../ports/manifest-source.js';
import type { Process } from '../../ports/process.js';

export class GitRepoSource implements ManifestSource {
  readonly kind = 'repo';

  constructor(
    private readonly url: string,
    private readonly process: Process,
    private readonly git: Git,
  ) {}

  get description(): string {
    return this.url;
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
        `could not clone ${this.url}: ${lastLine(result.stderr)}`,
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
        `could not fetch the manifest repository into ${dir}: ${err instanceof Error ? err.message : String(err)}`,
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
    // Like sync: a dirty tracked branch is not touched at all, not even its ref.
    if (onBranch && state.dirty) return kept(`uncommitted changes on ${branch}`);
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
