// Contributions prepare objects through a private index. Publishing the branch
// is separate so recovery metadata can be durable before any ref is moved.

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import type {
  CaptureContribution,
  ConstructContribution,
  ConstructedContribution,
  ContributionCommit,
  InspectContribution,
  PublishContribution,
  ContributionGit,
  ContributionSnapshot,
} from '../../ports/contribution-git.js';
import type { Process } from '../../ports/process.js';

import { captureContribution, readContributionBase } from './contribution-capture.js';
import { assertObjectId, runContributionGit } from './contribution-command.js';

export class ContributionSystemGit implements ContributionGit {
  constructor(private readonly process: Process) {}

  capture(input: CaptureContribution): Promise<ContributionSnapshot> {
    return captureContribution(this.process, input);
  }

  async prepare(input: ConstructContribution): Promise<ConstructedContribution> {
    if (!/^fx\/contribution\/[a-zA-Z0-9_-]+$/.test(input.branch))
      throw new DevkitError('usage', 'SOURCE_BRANCH_INVALID', 'Use a managed contribution branch', {
        nextSteps: ['fx source push --new'],
      });
    assertObjectId(input.parent);
    if (input.expectedHead !== null) assertObjectId(input.expectedHead);
    const current = await this.capture(input.snapshot);
    if (current.fingerprint !== input.snapshot.fingerprint)
      throw new DevkitError(
        'conflict',
        'SOURCE_SNAPSHOT_CHANGED',
        'Selected source files or HEAD changed after planning',
        { nextSteps: ['Re-run the same fx source push command to plan the current source state.'] },
      );
    const temporary = await fs.mkdtemp(path.join(tmpdir(), 'fx-contribution-index-'));
    const index = path.join(temporary, 'index');
    try {
      return await writeCandidate({ process: this.process, input, current, index });
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  async inspect(input: InspectContribution): Promise<ContributionCommit | null> {
    const git = (args: readonly string[], allowAbsent = false): Promise<string> =>
      runContributionGit({ process: this.process, dir: input.dir, args, allowAbsent });
    const sha = (
      await git(
        ['rev-parse', '--verify', '--quiet', '--end-of-options', `${input.ref}^{commit}`],
        true,
      )
    ).trim();
    if (!sha) return null;
    assertObjectId(sha);
    const [tree, parents = ''] = (
      await git(['show', '-s', '--no-notes', '--format=%T%n%P', sha, '--'])
    )
      .trim()
      .split('\n');
    assertObjectId(tree ?? '');
    const lineage = parents.split(' ').filter(Boolean);
    for (const parent of lineage) assertObjectId(parent);
    return { sha, tree: tree!, parents: lineage };
  }

  readBase(input: InspectContribution): Promise<Readonly<Record<string, string>>> {
    return readContributionBase({ ...input, process: this.process });
  }

  async publish(input: PublishContribution): Promise<void> {
    if (!/^fx\/contribution\/[a-zA-Z0-9_-]+$/.test(input.branch))
      throw new DevkitError('usage', 'SOURCE_BRANCH_INVALID', 'Use a managed contribution branch', {
        nextSteps: ['fx source push --new'],
      });
    assertObjectId(input.commit);
    if (input.expectedHead !== null) assertObjectId(input.expectedHead);
    const git = (args: readonly string[]): Promise<string> =>
      runContributionGit({ process: this.process, dir: input.dir, args });
    const worktrees = await git(['worktree', 'list', '--porcelain']);
    if (worktrees.split('\n').includes(`branch refs/heads/${input.branch}`))
      throw new DevkitError(
        'conflict',
        'SOURCE_BRANCH_CHECKED_OUT',
        'The contribution branch is checked out; choose a new contribution',
        {
          nextSteps: [
            `git -C ${input.dir} worktree list`,
            'Check out another branch there, or run fx source push --new.',
          ],
        },
      );
    if (
      (await this.inspect({ dir: input.dir, ref: `refs/heads/${input.branch}` }))?.sha ===
      input.commit
    )
      return;
    await git([
      'update-ref',
      `refs/heads/${input.branch}`,
      input.commit,
      input.expectedHead ?? '0'.repeat(input.commit.length),
    ]);
  }
}

interface CandidateWrite {
  readonly process: Process;
  readonly input: ConstructContribution;
  readonly current: ContributionSnapshot;
  readonly index: string;
}

async function writeCandidate({
  process,
  input,
  current,
  index,
}: CandidateWrite): Promise<ConstructedContribution> {
  const git = (args: readonly string[], text?: string): Promise<string> =>
    runContributionGit({
      process,
      dir: current.dir,
      args,
      index,
      ...(text === undefined ? {} : { input: text }),
    });
  await git(['read-tree', current.base]);
  for (const file of current.files) {
    const blob =
      file.content === null
        ? '0'.repeat(input.parent.length)
        : (await git(['hash-object', '-w', '--stdin', '--no-filters'], file.content)).trim();
    assertObjectId(blob);
    await git(
      ['update-index', '-z', '--index-info'],
      `${file.content === null ? '0' : file.mode} ${blob}\t${file.path}\0`,
    );
  }
  const tree = (await git(['write-tree'])).trim();
  assertObjectId(tree);
  if (tree !== current.tree)
    throw new DevkitError(
      'conflict',
      'SOURCE_TREE_MISMATCH',
      'Constructed tree differs from the preview',
      { nextSteps: ['Re-run the same fx source push command with --dry-run and review the plan.'] },
    );
  const commit = (
    await git(
      ['-c', 'commit.gpgSign=false', 'commit-tree', tree, '-p', input.parent],
      input.message,
    )
  ).trim();
  assertObjectId(commit);
  return { commit, tree };
}
