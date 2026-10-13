import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GitHubCodeHost } from '../../../src/adapters/code-host/github/provider.js';
import { verifyContributionRemote } from '../../../src/domain/contribution/remote.js';
import type { Process, ProcessResult } from '../../../src/ports/process.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const source = { repo: { project: 'alice', name: 'manifest' }, branch: 'fx/contribution/test' };
const target = { repo: { project: 'team', name: 'manifest' }, branch: 'main' };
const pr = {
  number: 12,
  html_url: 'https://github.com/team/manifest/pull/12',
  state: 'open',
  merged: false,
  head: { ref: source.branch, repo: 'alice/manifest' },
  base: { ref: 'main', repo: 'team/manifest' },
};
const fork = {
  full_name: 'alice/manifest',
  owner_type: 'User',
  default_branch: 'main',
  clone_url: 'https://github.com/alice/manifest.git',
  ssh_url: 'git@github.com:alice/manifest.git',
  fork: true,
  parent: 'team/manifest',
};
const upstream = {
  full_name: 'team/manifest',
  owner_type: 'Organization',
  default_branch: 'main',
  clone_url: 'https://github.com/team/manifest.git',
  ssh_url: 'git@github.com:team/manifest.git',
  fork: false,
  parent: null,
};
const ok = (data: unknown): ProcessResult => ({
  code: 0,
  stdout: JSON.stringify(data),
  stderr: '',
});
const http = (status: number, message: string): ProcessResult => ({
  code: 1,
  stdout: JSON.stringify({ message }),
  stderr: `gh: ${message} (HTTP ${status})`,
});
// A `gh api` call is told apart by the endpoint it ends with.
const api =
  (endpoint: string) =>
  (vector: readonly string[]): boolean =>
    vector[0] === 'gh' && vector[1] === 'api' && vector.at(-1) === endpoint;

function host(process: Process): GitHubCodeHost {
  return new GitHubCodeHost(
    { process, fs: new FakeFs(), clock: new FakeClock() },
    { host: 'https://github.com' },
  );
}

describe('GitHub contribution identity', () => {
  it('reads a personal fork with its parent, and an organization repository as no fork', async () => {
    const process = new FakeProcess()
      .when(api('repos/alice/manifest'), ok(fork))
      .when(api('repos/team/manifest'), ok(upstream));
    expect(await host(process).repositoryIdentity(source.repo)).toEqual({
      ref: source.repo,
      cloneUrls: [fork.ssh_url, fork.clone_url],
      defaultBranch: 'main',
      personalOwner: 'alice',
      parent: target.repo,
    });
    expect(await host(process).repositoryIdentity(target.repo)).toMatchObject({
      personalOwner: null,
      parent: null,
    });
    expect(process.callsTo(['gh', 'api', '--hostname', 'github.com'])).toHaveLength(2);
  });

  it('keeps a fork whose parent GitHub did not name unknown, not unforked', async () => {
    const process = new FakeProcess().always(ok({ ...fork, parent: null }));
    expect((await host(process).repositoryIdentity(source.repo)).parent).toBeUndefined();
  });

  it('refuses an answer about another repository or without a clone address', async () => {
    for (const answer of [
      { ...fork, full_name: 'alice/other' },
      { ...fork, clone_url: null, ssh_url: null },
      { ...fork, default_branch: null },
    ])
      await expect(
        host(new FakeProcess().always(ok(answer))).repositoryIdentity(source.repo),
      ).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_UNVERIFIED' });
  });

  it('passes the remote checks for remotes spelled in another letter case', async () => {
    const process = new FakeProcess()
      .when(api('repos/Alice/Manifest'), ok(fork))
      .when(api('repos/TEAM/manifest'), ok(upstream));
    const origin = await host(process).repositoryIdentity({ project: 'Alice', name: 'Manifest' });
    const official = await host(process).repositoryIdentity({ project: 'TEAM', name: 'manifest' });
    expect(origin.ref).toEqual(source.repo);
    expect(origin.cloneUrls).toContain('git@github.com:Alice/Manifest.git');
    const remote = verifyContributionRemote({
      settings: {
        originUrls: ['git@github.com:Alice/Manifest.git'],
        pushUrls: ['git@github.com:Alice/Manifest.git'],
        upstreamUrls: ['https://github.com/TEAM/manifest.git'],
        hasRewrite: false,
        isMirror: false,
        receivePack: null,
        fingerprint: 'f',
      },
      origin,
      upstream: official,
      user: 'alice',
      branch: source.branch,
    });
    expect(remote).toMatchObject({
      source: source.repo,
      target: target.repo,
      targetBranch: 'main',
    });
  });

  it('returns an installation handoff when gh is missing', async () => {
    const process = new FakeProcess().always({
      code: 127,
      stdout: '',
      stderr: '',
      notStarted: true,
    });
    await expect(host(process).repositoryIdentity(source.repo)).rejects.toMatchObject({
      code: 'TOOL_MISSING',
      handoff: expect.any(Object),
    });
  });
});

describe('GitHub contribution pull requests', () => {
  it('reads one known pull request and tells merged from declined', async () => {
    const process = new FakeProcess().when(api('repos/team/manifest/pulls/12'), ok(pr));
    expect(await host(process).pullRequest({ repo: target.repo, id: '12' })).toEqual({
      id: '12',
      url: pr.html_url,
      state: 'open',
      source,
      target,
    });
    for (const [merged, state] of [
      [true, 'merged'],
      [false, 'declined'],
    ] as const) {
      process.clear().always(ok({ ...pr, state: 'closed', merged }));
      expect((await host(process).pullRequest({ repo: target.repo, id: '12' }))?.state).toBe(state);
    }
  });

  it('answers a missing pull request with null and does not turn refusals into absence', async () => {
    const missing = new FakeProcess().always(http(404, 'Not Found'));
    expect(await host(missing).pullRequest({ repo: target.repo, id: '12' })).toBeNull();
    const refused = new FakeProcess().always(http(403, 'Resource not accessible by integration'));
    await expect(host(refused).pullRequest({ repo: target.repo, id: '12' })).rejects.toMatchObject({
      category: 'permission',
    });
    const signedOut = new FakeProcess().always(http(401, 'Bad credentials'));
    await expect(
      host(signedOut).pullRequest({ repo: target.repo, id: '12' }),
    ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED', nextSteps: ['fx login gh'] });
  });

  it('refuses an answer for another pull request, another repository or a deleted fork', async () => {
    for (const answer of [
      { ...pr, number: 13 },
      { ...pr, base: { ...pr.base, repo: 'other/manifest' } },
      { ...pr, head: { ...pr.head, repo: null } },
      { ...pr, state: 'closed', merged: null },
    ])
      await expect(
        host(new FakeProcess().always(ok(answer))).pullRequest({ repo: target.repo, id: '12' }),
      ).rejects.toMatchObject({ code: 'SOURCE_PR_RESPONSE_INVALID' });
  });

  it('resolves a pull request URL only within the current repository website', async () => {
    const process = new FakeProcess().when(api('repos/team/manifest/pulls/12'), ok(pr));
    for (const id of [
      pr.html_url,
      `${pr.html_url}/files`,
      'https://github.com/Team/Manifest/pull/12/',
      `${pr.html_url}#issuecomment-1`,
    ])
      expect(await host(process).pullRequest({ repo: target.repo, id })).toMatchObject({
        id: '12',
      });
    for (const id of [
      pr.html_url.replace('github.com', 'github.example.com'),
      'https://github.com/team/other/pull/12',
      'https://github.com/team/manifest/issues/12',
      `${pr.html_url}?diff=split`,
      'https://user@github.com/team/manifest/pull/12',
      '12 ',
    ])
      await expect(host(process).pullRequest({ repo: target.repo, id })).rejects.toMatchObject({
        code: 'SOURCE_PR_REFERENCE_INVALID',
      });
    expect(process.calls).toHaveLength(4);
  });

  it('posts the request from a private file with the exact description and removes the file', async () => {
    const calls: (readonly string[])[] = [];
    let file = '';
    let request: unknown;
    const process: Process = {
      which: async () => '/fake',
      run: async (vector) => {
        calls.push(vector);
        file = vector[vector.indexOf('--input') + 1]!;
        request = JSON.parse(readFileSync(file, 'utf8'));
        return ok(pr);
      },
    };
    const description = 'first line\nsecond line with literal \\n and `code`';
    expect(
      await host(process).createPullRequest({
        source,
        target,
        title: 'Contribution',
        description,
        allowWrites: false,
      }),
    ).toEqual({ id: '12', url: pr.html_url, state: 'open', source, target });
    expect(request).toEqual({
      title: 'Contribution',
      body: description,
      head: 'alice:fx/contribution/test',
      base: 'main',
    });
    expect(existsSync(file)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.arrayContaining(['--method', 'POST']));
    expect(calls[0]?.at(-1)).toBe('repos/team/manifest/pulls');
    expect(calls[0]?.join(' ')).not.toContain('Contribution');
  });

  it('removes the request file when GitHub refuses, without echoing its message', async () => {
    let file = '';
    const process: Process = {
      which: async () => '/fake',
      run: async (vector) => {
        file = vector[vector.indexOf('--input') + 1]!;
        return http(422, 'Validation Failed: Contribution text quoted back');
      },
    };
    const error = await host(process)
      .createPullRequest({
        source,
        target,
        title: 'Contribution',
        description: 'text',
        allowWrites: false,
      })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'PLATFORM_QUERY_FAILED' });
    expect(JSON.stringify(error)).not.toContain('quoted back');
    expect(existsSync(file)).toBe(false);
  });

  it('does not accept a creation answer for another branch or a closed pull request', async () => {
    for (const answer of [
      { ...pr, head: { ...pr.head, ref: 'unexpected' } },
      { ...pr, base: { ...pr.base, ref: 'release' } },
      { ...pr, state: 'closed', merged: true },
    ])
      await expect(
        host(new FakeProcess().always(ok(answer))).createPullRequest({
          source,
          target,
          title: 'Contribution',
          description: 'text',
          allowWrites: false,
        }),
      ).rejects.toMatchObject({ code: 'SOURCE_PR_RESPONSE_INVALID' });
  });

  it('refuses protected text before anything is sent', async () => {
    const process = new FakeProcess().always(ok(pr));
    await expect(
      host(process).createPullRequest({
        source,
        target,
        title: 'Contribution',
        description: 'token ghp_0123456789abcdefghijklmnopqrstuvwxyzAB',
        allowWrites: false,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_CONTENT_SENSITIVE' });
    expect(process.calls).toEqual([]);
  });
});
