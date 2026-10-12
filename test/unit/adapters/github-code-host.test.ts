import { describe, expect, it } from 'vitest';

import { GitHubCodeHost } from '../../../src/adapters/code-host/github/provider.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const ref = { project: 'octo', name: 'tool' };

function host(proc: FakeProcess, vars = { host: 'https://github.com' }): GitHubCodeHost {
  return new GitHubCodeHost({ process: proc, fs: new FakeFs(), clock: new FakeClock() }, vars);
}

// A `gh api` call is told apart by the endpoint it ends with.
const api =
  (endpoint: string) =>
  (vector: readonly string[]): boolean =>
    vector[0] === 'gh' && vector[1] === 'api' && (vector.at(-1) ?? '').startsWith(endpoint);
const out = (...lines: unknown[]) => ({
  code: 0,
  stdout: lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'),
  stderr: '',
});
const http = (status: number, message: string) => ({
  code: 1,
  stdout: JSON.stringify({ message }),
  stderr: `gh: ${message} (HTTP ${status})`,
});
const commit = (sha: string, parents: string[], message = 'feat: one') => ({
  sha,
  author: 'Alice',
  date: '2026-10-01T00:00:00Z',
  message,
  parents,
});

describe('GitHubCodeHost queries', () => {
  it('lists every page of branches and marks the repository default', async () => {
    const proc = new FakeProcess()
      .when(
        api('repos/octo/tool/branches'),
        out({ name: 'dev', sha: 'aaa' }, { name: 'main', sha: 'bbb' }),
      )
      .when(api('repos/octo/tool'), out('main'));
    expect(await host(proc).branches(ref)).toEqual([
      { name: 'dev', sha: 'aaa', default: false },
      { name: 'main', sha: 'bbb', default: true },
    ]);
    const call = proc.calls.find((c) => api('repos/octo/tool/branches')(c.vector));
    expect(call?.vector).toContain('--paginate');
    expect(call?.options.timeoutMs).toBe(15_000);
  });

  it('compares two refs across pages and keeps the committer date and parents', async () => {
    const proc = new FakeProcess().when(
      api('repos/octo/tool/compare/main...dev'),
      out(
        { total: 2, commits: [commit('c1', ['bbb'])] },
        { total: 2, commits: [commit('c2', ['c1'], 'fix: two\n\nbody')] },
      ),
    );
    expect(await host(proc).compare(ref, { from: 'main', to: 'dev' })).toEqual([
      commit('c1', ['bbb']),
      commit('c2', ['c1'], 'fix: two\n\nbody'),
    ]);
  });

  it('refuses a range shorter than the total GitHub states, rather than reading agreement', async () => {
    const proc = new FakeProcess().when(
      api('repos/octo/tool/compare/'),
      out({ total: 300, commits: [commit('c1', ['bbb'])] }),
    );
    await expect(host(proc).compare(ref, { from: 'main', to: 'dev' })).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
    });
  });

  it('keeps the slashes of a branch name in the endpoint', async () => {
    const proc = new FakeProcess().when(
      api('repos/octo/tool/compare/'),
      out({ total: 0, commits: [] }),
    );
    await host(proc).compare(ref, { from: 'main', to: 'feature/a b' });
    expect(proc.soleCallTo(['gh', 'api']).vector.at(-1)).toBe(
      'repos/octo/tool/compare/main...feature/a%20b?per_page=100',
    );
  });

  it('reads one commit without its diff', async () => {
    const proc = new FakeProcess().when(
      api('repos/octo/tool/commits/c1'),
      out(commit('c1', ['p'])),
    );
    expect(await host(proc).commit(ref, 'c1')).toEqual(commit('c1', ['p']));
    expect(proc.soleCallTo(['gh', 'api']).vector).toContain('--jq');
  });

  it('reads a file raw, answers undefined for a missing one and throws for anything else', async () => {
    const proc = new FakeProcess()
      .when(api('repos/octo/tool/contents/package.json'), out('{"version":"1.0.0"}'))
      .when(api('repos/octo/tool/contents/pom.xml'), http(404, 'Not Found'))
      .when(api('repos/octo/tool/contents/go.mod'), http(401, 'Bad credentials'));
    expect(await host(proc).readFile(ref, 'package.json', 'aaa')).toBe('{"version":"1.0.0"}');
    expect(await host(proc).readFile(ref, 'pom.xml', 'aaa')).toBeUndefined();
    await expect(host(proc).readFile(ref, 'go.mod', 'aaa')).rejects.toMatchObject({
      code: 'PLATFORM_AUTH',
      nextSteps: ['fx login gh', 'gh auth status'],
    });
    const raw = proc.calls.find((c) => api('repos/octo/tool/contents/package.json')(c.vector));
    expect(raw?.vector).toEqual(expect.arrayContaining(['Accept: application/vnd.github.raw']));
    expect(raw?.vector.at(-1)).toBe('repos/octo/tool/contents/package.json?ref=aaa');
  });

  it('reads access in the four states the workspace reports', async () => {
    const answer = async (result: { code: number; stdout: string; stderr: string }) =>
      host(new FakeProcess().always(result)).canRead(ref);
    expect(await answer(out('octo/tool'))).toBe('readable');
    expect(await answer(http(403, 'Resource not accessible by integration'))).toBe('forbidden');
    expect(await answer(http(404, 'Not Found'))).toBe('missing');
    expect(await answer({ code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 502)' })).toBe(
      'unknown',
    );
  });

  it('says gh is missing rather than that the repository is', async () => {
    const proc = new FakeProcess().always({ code: 127, stdout: '', stderr: '', notStarted: true });
    await expect(host(proc).branches(ref)).rejects.toMatchObject({ code: 'TOOL_MISSING' });
  });

  it('classifies a rate limit and an absent sign-in by what gh said', async () => {
    const limited = new FakeProcess().always(http(403, 'API rate limit exceeded for user'));
    await expect(host(limited).commit(ref, 'c1')).rejects.toMatchObject({ category: 'rate_limit' });
    const signedOut = new FakeProcess().always({
      code: 4,
      stdout: '',
      stderr: 'To get started with GitHub CLI, please run:  gh auth login',
    });
    await expect(host(signedOut).commit(ref, 'c1')).rejects.toMatchObject({
      code: 'PLATFORM_AUTH',
    });
  });

  it('asks the host the binding names and builds its URLs from it', async () => {
    const proc = new FakeProcess().always(out('me'));
    const enterprise = host(proc, { host: 'ssh://git@github.example.com' });
    expect((await enterprise.whoami()).user).toBe('me');
    expect(proc.soleCallTo(['gh', 'api']).vector.slice(0, 4)).toEqual([
      'gh',
      'api',
      '--hostname',
      'github.example.com',
    ]);
    expect(enterprise.upstreamUrl(ref)).toBe('ssh://git@github.example.com/octo/tool.git');
    expect(enterprise.forkUrl('me', ref)).toBe('ssh://git@github.example.com/me/tool.git');
    expect(enterprise.webUrl(ref)).toBe('https://github.example.com/octo/tool');
    const dotcom = new FakeProcess().always(out('me'));
    await host(dotcom).whoami();
    expect(dotcom.soleCallTo(['gh', 'api']).vector).not.toContain('--hostname');
  });

  it('forks once: an existing fork is reused, a same-named repository is refused', async () => {
    const reuse = new FakeProcess()
      .when(api('user'), out('me'))
      .when(api('repos/me/tool'), out('true'));
    expect(await host(reuse).fork(ref)).toEqual({
      url: 'https://github.com/me/tool.git',
      created: false,
    });
    const create = new FakeProcess()
      .when(api('user'), out('me'))
      .when(api('repos/me/tool'), http(404, 'Not Found'))
      .on(['gh', 'repo', 'fork'], out(''));
    expect(await host(create).fork(ref)).toEqual({
      url: 'https://github.com/me/tool.git',
      created: true,
    });
    expect(create.soleCallTo(['gh', 'repo', 'fork']).vector).toEqual([
      'gh',
      'repo',
      'fork',
      'octo/tool',
      '--clone=false',
      '--remote=false',
    ]);
    const taken = new FakeProcess()
      .when(api('user'), out('me'))
      .when(api('repos/me/tool'), out('false'));
    await expect(host(taken).fork(ref)).rejects.toMatchObject({ code: 'FORK_FAILED' });
    expect(taken.calledWith(['gh', 'repo', 'fork'])).toBe(false);
  });

  it('declines contribution workflows instead of half-running them', async () => {
    const sut = host(new FakeProcess());
    expect(sut.supportsContributions).toBe(false);
    await expect(sut.repositoryIdentity(ref)).rejects.toMatchObject({
      code: 'SOURCE_CONTRIBUTION_UNSUPPORTED',
    });
  });
});
