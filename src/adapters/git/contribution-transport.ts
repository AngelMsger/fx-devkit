// Routing inspection records all effective source remotes and unsafe overrides.
// A push names one commit/ref, disables tag following and never uses force.

import { createHash } from 'node:crypto';

import type { ContributionRemoteSettings } from '../../domain/contribution/remote.js';
import { DevkitError } from '../../domain/errors.js';
import type {
  ContributionPush,
  ContributionUpstream,
  FetchContributionBase,
  ContributionRemoteBranch,
  ContributionTransport,
  SourceDirectory,
} from '../../ports/contribution-transport.js';
import type { Process } from '../../ports/process.js';

import { assertObjectId, runContributionGit } from './contribution-command.js';

export class ContributionGitTransport implements ContributionTransport {
  constructor(private readonly process: Process) {}

  async inspect({ dir }: SourceDirectory): Promise<ContributionRemoteSettings> {
    const read = async (args: readonly string[]): Promise<string[]> => {
      const text = await runContributionGit({
        process: this.process,
        dir,
        args: ['config', '-z', ...args],
        allowAbsent: true,
      });
      return text.split('\0').filter(Boolean);
    };
    const originUrls = await read(['--get-all', 'remote.origin.url']);
    const configuredPush = await read(['--get-all', 'remote.origin.pushurl']);
    const upstreamUrls = await read(['--get-all', 'remote.upstream.url']);
    const mirror = await read(['--type=bool', '--get', 'remote.origin.mirror']);
    const receivePack = await read(['--get-all', 'remote.origin.receivepack']);
    const rewrites = await read(['--get-regexp', '^url\\..*\\.(insteadof|pushinsteadof)$']);
    const values = {
      originUrls,
      pushUrls: configuredPush.length ? configuredPush : originUrls,
      upstreamUrls,
      hasRewrite: rewrites.length > 0,
      isMirror: mirror.includes('true'),
      receivePack: receivePack.length ? receivePack.join('\n') : null,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ ...values, rewrites }))
      .digest('hex');
    return { ...values, fingerprint };
  }

  async upstream(input: SourceDirectory): Promise<ContributionUpstream> {
    const text = await runContributionGit({
      process: this.process,
      dir: input.dir,
      args: ['ls-remote', '--symref', 'upstream', 'HEAD'],
      network: true,
    });
    const branch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(text)?.[1];
    const sha = /^([0-9a-f]+)\tHEAD$/m.exec(text)?.[1];
    if (!branch || !sha)
      throw new DevkitError(
        'config',
        'SOURCE_BASE_UNVERIFIED',
        'The upstream did not identify its default branch.',
      );
    assertObjectId(sha);
    return { sha, branch };
  }

  async fetch(input: FetchContributionBase): Promise<void> {
    const current = await this.inspect(input);
    if (
      current.fingerprint !== input.settings.fingerprint ||
      current.upstreamUrls.length !== 1 ||
      current.hasRewrite
    )
      throw new DevkitError(
        'conflict',
        'SOURCE_REMOTE_CHANGED',
        'Upstream routing changed after planning.',
      );
    await runContributionGit({
      process: this.process,
      dir: input.dir,
      args: ['check-ref-format', `refs/heads/${input.branch}`],
    });
    await runContributionGit({
      process: this.process,
      dir: input.dir,
      args: [
        'fetch',
        '--no-tags',
        '--no-recurse-submodules',
        'upstream',
        `refs/heads/${input.branch}:refs/remotes/upstream/${input.branch}`,
      ],
      network: true,
    });
  }

  async head(input: ContributionRemoteBranch): Promise<string | null> {
    await this.assertCurrent(input);
    const text = await runContributionGit({
      process: this.process,
      dir: input.dir,
      args: ['ls-remote', '--heads', 'origin', `refs/heads/${input.branch}`],
      network: true,
    });
    if (!text.trim()) return null;
    const lines = text.trim().split('\n');
    const [sha, ref] = lines[0]!.split('\t');
    if (lines.length !== 1 || ref !== `refs/heads/${input.branch}` || !sha)
      throw new DevkitError(
        'parse',
        'SOURCE_REMOTE_HEAD_INVALID',
        'The remote did not return one exact branch identity.',
      );
    assertObjectId(sha);
    return sha;
  }

  async push(input: ContributionPush): Promise<void> {
    assertObjectId(input.commit);
    await this.assertCurrent(input);
    await runContributionGit({
      process: this.process,
      dir: input.dir,
      args: [
        '-c',
        'push.followTags=false',
        'push',
        '--porcelain',
        '--no-follow-tags',
        '--recurse-submodules=no',
        'origin',
        `${input.commit}:refs/heads/${input.branch}`,
      ],
      network: true,
    });
  }

  private async assertCurrent(input: ContributionRemoteBranch): Promise<void> {
    if (
      !/^fx\/contribution\/[a-zA-Z0-9_-]+$/.test(input.branch) ||
      input.branch === input.remote.targetBranch
    )
      throw new DevkitError(
        'usage',
        'SOURCE_BRANCH_INVALID',
        'Use a dedicated contribution branch.',
      );
    const settings = await this.inspect(input);
    if (
      settings.fingerprint !== input.remote.fingerprint ||
      settings.pushUrls.length !== 1 ||
      settings.pushUrls[0] !== input.remote.url ||
      settings.hasRewrite ||
      settings.isMirror ||
      settings.receivePack !== null
    )
      throw new DevkitError(
        'conflict',
        'SOURCE_REMOTE_CHANGED',
        'Source remote routing changed after verification.',
      );
  }
}
