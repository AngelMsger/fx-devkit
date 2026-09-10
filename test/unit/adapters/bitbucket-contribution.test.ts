import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BitbucketCodeHost } from '../../../src/adapters/code-host/bitbucket-cli/provider.js';
import type { Process } from '../../../src/ports/process.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const source = { repo: { project: '~alice', name: 'manifest' }, branch: 'fx/contribution/test' };
const target = { repo: { project: 'TEAM', name: 'manifest' }, branch: 'main' };
const pr = {
  id: 12,
  state: 'OPEN',
  url: 'https://git.example.com/projects/TEAM/repos/manifest/pull-requests/12',
  source: { branch: source.branch, repository: '~alice/manifest' },
  destination: { branch: 'main', repository: 'TEAM/manifest' },
  repository: { workspace: 'TEAM', slug: 'manifest' },
};
const ok = (data: unknown) => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });
function host(process: Process): BitbucketCodeHost {
  return new BitbucketCodeHost(
    { process, fs: new FakeFs(), clock: new FakeClock() },
    { host: 'ssh://git@git.example.com', web: 'https://git.example.com' },
  );
}

describe('code-host contribution queries and creation', () => {
  it('keeps absent parent evidence unknown for the installed companion contract', async () => {
    const process = new FakeProcess().always(
      ok({
        workspace: '~alice',
        slug: 'manifest',
        default_branch: 'main',
        clone_ssh: 'ssh://git@git.example.com/~alice/manifest.git',
      }),
    );
    const result = await host(process).repositoryIdentity(source.repo);
    expect(result.parent).toBeUndefined();
    expect(result.personalOwner).toBe('alice');
  });
  it('reads explicit parent and confirmed non-fork identities', async () => {
    const process = new FakeProcess().always(
      ok({
        workspace: '~alice',
        slug: 'manifest',
        default_branch: 'main',
        clone_ssh: 'ssh://git@git.example.com/~alice/manifest.git',
        parent: { workspace: 'TEAM', slug: 'manifest' },
      }),
    );
    expect((await host(process).repositoryIdentity(source.repo)).parent).toEqual(target.repo);
    process.clear().always(
      ok({
        workspace: 'TEAM',
        slug: 'manifest',
        default_branch: 'main',
        clone_ssh: 'ssh://git@git.example.com/TEAM/manifest.git',
        parent: null,
      }),
    );
    expect((await host(process).repositoryIdentity(target.repo)).parent).toBeNull();
  });
  it('reads one known PR and does not turn permission errors into absence', async () => {
    const process = new FakeProcess().always(ok(pr));
    expect(await host(process).pullRequest({ repo: target.repo, id: '12' })).toMatchObject({
      id: '12',
      state: 'open',
      source,
      target,
    });
    expect(process.calls[0]?.vector).toEqual([
      'bitbucket-cli',
      '--format',
      'json',
      'pr',
      'get',
      'TEAM/manifest/12',
      '--scope',
      'summary',
    ]);
    process.clear().always({ code: 6, stdout: '', stderr: '' });
    expect(await host(process).pullRequest({ repo: target.repo, id: '12' })).toBeNull();
    process.clear().always({ code: 5, stdout: '', stderr: '' });
    await expect(host(process).pullRequest({ repo: target.repo, id: '12' })).rejects.toMatchObject({
      category: 'permission',
    });
  });
  it('resolves a PR URL only within the current repository website', async () => {
    const process = new FakeProcess()
      .when(
        (vector) => vector.includes('repo'),
        ok({ url: 'https://git.example.com/projects/TEAM/repos/manifest/browse' }),
      )
      .always(ok(pr));
    expect(
      await host(process).pullRequest({ repo: target.repo, id: pr.url + '/overview' }),
    ).toMatchObject({ id: '12' });
    await expect(
      host(process).pullRequest({
        repo: target.repo,
        id: pr.url.replace('git.example.com', 'other.example.com'),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_PR_REFERENCE_INVALID' });
    expect(process.calls.filter((call) => call.vector.includes('pr'))).toHaveLength(1);
  });
  it('passes exact description bytes in a temporary file and forwards only explicit write override', async () => {
    let descriptionFile = '';
    let observed = '';
    const calls: (readonly string[])[] = [];
    const process: Process = {
      which: async () => '/fake',
      run: async (vector) => {
        calls.push(vector);
        descriptionFile = vector[vector.indexOf('--description-file') + 1]!;
        observed = readFileSync(descriptionFile, 'utf8');
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
        allowWrites: true,
      }),
    ).toMatchObject({ id: '12', source, target });
    expect(observed).toBe(description);
    expect(existsSync(descriptionFile)).toBe(false);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        '--source-repo',
        '~alice/manifest',
        '--repo',
        'TEAM/manifest',
        '--source',
        source.branch,
        '--target',
        'main',
        '--allow-writes',
      ]),
    );
    await host(process).createPullRequest({
      source,
      target,
      title: 'Contribution',
      description,
      allowWrites: false,
    });
    expect(calls[1]).not.toContain('--allow-writes');
  });
  it('cleans the description file when the companion rejects creation', async () => {
    let descriptionFile = '';
    const process: Process = {
      which: async () => '/fake',
      run: async (vector) => {
        descriptionFile = vector[vector.indexOf('--description-file') + 1]!;
        return { code: 4, stdout: '', stderr: '' };
      },
    };
    await expect(
      host(process).createPullRequest({
        source,
        target,
        title: 'Contribution',
        description: 'text',
        allowWrites: false,
      }),
    ).rejects.toMatchObject({ category: 'auth', handoff: expect.any(Object) });
    expect(existsSync(descriptionFile)).toBe(false);
  });
  it('returns an installation handoff when the companion binary is missing', async () => {
    const process = new FakeProcess().always({ code: 127, stdout: '', stderr: '' });
    await expect(host(process).repositoryIdentity(source.repo)).rejects.toMatchObject({
      code: 'TOOL_MISSING',
      handoff: expect.any(Object),
    });
  });
  it('does not accept a creation response for a different source branch', async () => {
    const process = new FakeProcess().always(
      ok({ ...pr, source: { ...pr.source, branch: 'unexpected' } }),
    );
    await expect(
      host(process).createPullRequest({
        source,
        target,
        title: 'Contribution',
        description: 'text',
        allowWrites: false,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_PR_RESPONSE_INVALID' });
  });
});
