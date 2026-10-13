import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fx, git } from './harness.js';
import { githubSourceFixture, sourceFingerprint, sourceMetadata } from './source-harness.js';

type Fixture = ReturnType<typeof githubSourceFixture>;
interface Contribution {
  branch: string;
  commit: string;
  action: string;
  source: { project: string; name: string };
  target: { project: string; name: string };
  pull_request: { id: string; url: string; state: string } | null;
}
function push(f: Fixture, env: NodeJS.ProcessEnv = {}) {
  return fx(
    ['source', 'push', 'notes.md', ...sourceMetadata, '--yes'],
    { ...f.env, ...env },
    f.workspace,
  );
}
function succeeded(result: ReturnType<typeof push>): Contribution {
  expect(result.status, result.stderr).toBe(0);
  return result.json() as Contribution;
}
function state(f: Fixture): {
  prs: { number: number; state: string; merged: boolean; body: string }[];
} {
  return JSON.parse(readFileSync(f.state, 'utf8'));
}

describe('source push to a GitHub-hosted manifest', () => {
  it('opens a pull request from the personal fork and reuses it while nothing changed', () => {
    const f = githubSourceFixture();
    const first = succeeded(push(f));
    expect(first).toMatchObject({
      source: { project: 'alice', name: 'manifest' },
      target: { project: 'team', name: 'manifest' },
      pull_request: { id: '1', url: 'https://github.com/team/manifest/pull/1', state: 'open' },
    });
    expect(git(['rev-parse', `refs/heads/${first.branch}`], f.origin)).toBe(first.commit);
    expect(state(f).prs).toHaveLength(1);
    expect(state(f).prs[0]?.body).toContain('Issue: g-1');
    expect(succeeded(push(f))).toMatchObject({ action: 'unchanged', branch: first.branch });
    expect(state(f).prs).toHaveLength(1);
  });

  it('retires a merged pull request and starts a new one', () => {
    const f = githubSourceFixture();
    const first = succeeded(push(f));
    git(['fetch', '-q', f.origin, first.commit], f.upstream);
    git(['update-ref', 'refs/heads/main', first.commit], f.upstream);
    const remote = state(f);
    Object.assign(remote.prs[0]!, { state: 'closed', merged: true });
    writeFileSync(f.state, JSON.stringify(remote));
    writeFileSync(path.join(f.source, 'notes.md'), 'change after merge');
    const next = succeeded(push(f));
    expect(next.branch).not.toBe(first.branch);
    expect(next.pull_request?.id).toBe('2');
  });

  it('refuses a fork of another repository before creating any state', () => {
    const f = githubSourceFixture();
    const before = sourceFingerprint(f.home);
    expect(push(f, { FX_TEST_WRONG_PARENT: '1' }).error().code).toBe('SOURCE_REMOTE_UNSAFE');
    expect(sourceFingerprint(f.home)).toBe(before);
    expect(
      git(['for-each-ref', '--format=%(refname)', 'refs/heads/fx/contribution'], f.origin),
    ).toBe('');
  });
});
