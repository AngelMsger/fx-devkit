import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fx, git } from './harness.js';
import {
  installPushFault,
  sourceFixture,
  sourceFingerprint,
  sourceMetadata,
} from './source-harness.js';

type Fixture = ReturnType<typeof sourceFixture>;
interface Contribution {
  branch: string;
  commit: string;
  action: string;
  pull_request: { id: string; url: string };
}
function push(
  f: Fixture,
  paths: string[] = ['notes.md'],
  extra: string[] = [],
  env: NodeJS.ProcessEnv = {},
) {
  return fx(
    ['source', 'push', ...paths, ...sourceMetadata, '--yes', ...extra],
    { ...f.env, ...env },
    f.workspace,
  );
}
function succeeded(result: ReturnType<typeof push>): Contribution {
  expect(result.status, result.stderr).toBe(0);
  return result.json() as Contribution;
}
function journal(f: Fixture): string {
  return readFileSync(path.join(f.home, 'workspaces/test/contributions.json'), 'utf8');
}
function state(f: Fixture): { nextId: number; prs: { id: number; state: string }[] } {
  return JSON.parse(readFileSync(f.state, 'utf8'));
}

describe('source contribution recovery through the built binary', () => {
  it('creates, skips an unchanged tree, reuses a covered PR and starts a new one for a subset', () => {
    const f = sourceFixture();
    const before = {
      head: git(['rev-parse', 'HEAD'], f.source),
      index: readFileSync(path.join(f.source, '.git/index')),
      status: git(['status', '--porcelain'], f.source),
      upstream: git(['rev-parse', 'HEAD'], f.upstream),
    };
    const first = succeeded(push(f));
    expect(state(f).prs).toHaveLength(1);
    expect(succeeded(push(f))).toMatchObject({
      action: 'unchanged',
      branch: first.branch,
      commit: first.commit,
    });
    expect(state(f).prs).toHaveLength(1);
    expect({
      head: git(['rev-parse', 'HEAD'], f.source),
      index: readFileSync(path.join(f.source, '.git/index')),
      status: git(['status', '--porcelain'], f.source),
      upstream: git(['rev-parse', 'HEAD'], f.upstream),
    }).toEqual(before);
    writeFileSync(path.join(f.source, 'notes.md'), 'revised notes');
    const update = succeeded(push(f, ['notes.md', 'note one.md']));
    expect(update).toMatchObject({
      action: 'update',
      branch: first.branch,
      pull_request: { id: first.pull_request.id },
    });
    expect(state(f).prs).toHaveLength(1);
    writeFileSync(path.join(f.source, 'note one.md'), 'next change');
    const separate = succeeded(push(f, ['note one.md']));
    expect(separate.action).toBe('create');
    expect(separate.branch).not.toBe(first.branch);
    expect(state(f).prs).toHaveLength(2);
  });
  it('retires merged PRs after a real upstream fast-forward and never pushes to upstream', () => {
    const f = sourceFixture();
    const first = succeeded(push(f));
    git(['fetch', '-q', f.origin, first.commit], f.upstream);
    git(['update-ref', 'refs/heads/main', first.commit], f.upstream);
    const remote = state(f);
    remote.prs[0]!.state = 'MERGED';
    writeFileSync(f.state, JSON.stringify(remote));
    writeFileSync(path.join(f.source, 'notes.md'), 'change after merge');
    const next = succeeded(push(f));
    expect(next.branch).not.toBe(first.branch);
    expect(git(['rev-parse', 'HEAD'], f.upstream)).toBe(first.commit);
    expect(JSON.parse(journal(f)).operations).toHaveLength(1);
  });
  it('retires an authoritatively missing branch and preserves records on an unavailable query', () => {
    const f = sourceFixture();
    const first = succeeded(push(f));
    const before = journal(f);
    const unavailable = push(f, ['notes.md'], [], { FX_TEST_QUERY_FAIL: '1' });
    expect(unavailable.error().category).toBe('network');
    expect(journal(f)).toBe(before);
    git(['update-ref', '-d', `refs/heads/${first.branch}`], f.origin);
    writeFileSync(path.join(f.source, 'notes.md'), 'replacement branch');
    const next = succeeded(push(f));
    expect(next.branch).not.toBe(first.branch);
    expect(JSON.parse(journal(f)).operations).toHaveLength(1);
  });
  it('does not repeat uncertain PR creation and recovers with its verified URL', () => {
    const f = sourceFixture();
    const failed = push(f, ['notes.md'], [], { FX_TEST_LOSE_PR_RESPONSE: '1' });
    expect(failed.error().category).toBe('network');
    expect(state(f).prs).toHaveLength(1);
    expect(JSON.parse(journal(f)).operations[0].phase).toBe('creating_pr');
    expect(push(f).error().code).toBe('SOURCE_PR_CONFIRM_REQUIRED');
    expect(state(f).prs).toHaveLength(1);
    const url = 'https://git.example.com/projects/TEAM/repos/manifest/pull-requests/1/overview';
    expect(succeeded(push(f, ['notes.md'], ['--pr', url]))).toMatchObject({
      action: 'associate',
      pull_request: { id: '1' },
    });
    expect(state(f).prs).toHaveLength(1);
    expect(JSON.parse(journal(f)).operations[0].phase).toBe('open');
  });
  it('recovers an actual successful push whose wrapper lost the response without a second push', async () => {
    const f = sourceFixture();
    const log = await installPushFault(f);
    const failed = push(f, ['notes.md'], [], { FX_TEST_DROP_PUSH_RESPONSE: '1' });
    expect(failed.error().category).toBe('network');
    const operation = JSON.parse(journal(f)).operations[0];
    expect(operation.phase).toBe('committed');
    expect(git(['rev-parse', `refs/heads/${operation.branch}`], f.origin)).toBe(operation.commit);
    expect(succeeded(push(f))).toMatchObject({ action: 'resume', commit: operation.commit });
    expect(JSON.parse(readFileSync(log, 'utf8'))).toHaveLength(1);
    expect(state(f).prs).toHaveLength(1);
  });
  it('rejects a forged fork identity before creating local or remote state', () => {
    const f = sourceFixture();
    const before = sourceFingerprint(f.home);
    expect(push(f, ['notes.md'], [], { FX_TEST_WRONG_PARENT: '1' }).error().code).toBe(
      'SOURCE_REMOTE_UNSAFE',
    );
    expect(sourceFingerprint(f.home)).toBe(before);
    expect(
      git(['for-each-ref', '--format=%(refname)', 'refs/heads/fx/contribution'], f.origin),
    ).toBe('');
  });
  it('refuses a remote advance even when its content tree is unchanged', () => {
    const f = sourceFixture();
    const first = succeeded(push(f));
    const tree = git(['rev-parse', `${first.commit}^{tree}`], f.origin);
    const outside = git(
      ['commit-tree', tree, '-p', first.commit, '-m', 'external update'],
      f.origin,
    );
    git(['update-ref', `refs/heads/${first.branch}`, outside], f.origin);
    const before = sourceFingerprint(f.home);
    expect(push(f).error().code).toBe('SOURCE_REMOTE_DIVERGED');
    expect(sourceFingerprint(f.home)).toBe(before);
    expect(git(['rev-parse', `refs/heads/${first.branch}`], f.origin)).toBe(outside);
    expect(state(f).prs).toHaveLength(1);
  });
});
