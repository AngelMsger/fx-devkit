// User journeys for fresh diagnostics, complete work-in-progress discovery and normal retries.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshHome, fx, git, manifestDirOf, repository } from './harness.js';

function stage() {
  const base = freshHome();
  const host = path.join(base, 'host');
  mkdirSync(host);
  const repo = repository(host, 'api', { README: 'initial\n' });
  const source = path.join(base, 'source');
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    [
      'schema_version: 2',
      `providers: {code-host: {provider: local-git, vars: {host: ${base}, user: tester}}}`,
      'defaults: {upstream_project: host, branch: main}',
      'repos: [{name: api}]',
      '',
    ].join('\n'),
  );
  const env = { FX_HOME: freshHome(), FX_AGENTS: '' };
  const root = path.join(base, 'workspace');
  const init = () =>
    fx(['init', root, '--name', 'sample', '--from', source, '--details', '--format', 'json'], env);
  return { base, host, repo, source, env, root, init };
}

function dirty(s: ReturnType<typeof stage>) {
  const result = fx(['status', '--dirty', '--format', 'json'], s.env, s.root);
  expect(result.status, result.stderr).toBe(0);
  return result.json() as {
    items: { name: string; dirty: boolean; untracked: number; uncommitted: boolean }[];
  };
}

describe('status and recovery journeys', () => {
  it('shows untracked, staged and tracked work while excluding ignored files', () => {
    const s = stage();
    const init = s.init();
    expect(init.status, init.stderr).toBe(0);
    const checkout = path.join(s.root, 'api');
    writeFileSync(path.join(checkout, '.git/info/exclude'), 'ignored.log\n');
    writeFileSync(path.join(checkout, 'ignored.log'), 'local log\n');
    expect(dirty(s).items).toEqual([]);

    git(['config', 'status.showUntrackedFiles', 'no'], checkout);
    mkdirSync(path.join(checkout, 'new'));
    writeFileSync(path.join(checkout, 'new/one.txt'), 'new work\n');
    writeFileSync(path.join(checkout, 'new/two.txt'), 'more work\n');
    expect(dirty(s).items).toMatchObject([
      { name: 'api', dirty: false, untracked: 2, uncommitted: true },
    ]);
    const human = fx(['status'], s.env, s.root);
    expect(human.stdout.toLowerCase()).toContain('untracked');
    expect(human.stdout.toLowerCase()).toContain('uncommitted');
    expect(human.stdout).toMatch(/api\s+main\s+true\s+false\s+2/);

    git(['add', 'new'], checkout);
    expect(dirty(s).items).toMatchObject([{ dirty: true, untracked: 0, uncommitted: true }]);
    git(['commit', '-qm', 'new work'], checkout);
    expect(dirty(s).items).toEqual([]);
    writeFileSync(path.join(checkout, 'README'), 'changed work\n');
    expect(dirty(s).items).toMatchObject([{ dirty: true, untracked: 0, uncommitted: true }]);
  });

  it('keeps untracked work and refuses a conflicting upstream fast-forward', () => {
    const s = stage();
    expect(s.init().status).toBe(0);
    const local = path.join(s.root, 'api/local.txt');
    writeFileSync(local, 'my uncommitted file\n');
    s.repo.commit({ 'other.txt': 'upstream\n' }, 'independent update');
    const updated = fx(['sync', '--only', 'repos', '--format', 'json', '--details'], s.env, s.root);
    expect(updated.status, updated.stderr).toBe(0);
    expect(updated.json()).toMatchObject({ summary: { failed: 0 } });
    expect(readFileSync(local, 'utf8')).toBe('my uncommitted file\n');
    expect(readFileSync(path.join(s.root, 'api/other.txt'), 'utf8')).toBe('upstream\n');
    s.repo.commit({ 'local.txt': 'conflicting upstream\n' }, 'conflicting update');
    const conflict = fx(
      ['sync', '--only', 'repos', '--format', 'json', '--details'],
      s.env,
      s.root,
    );
    expect(conflict.json()).toMatchObject({ preparation_complete: false, summary: { failed: 1 } });
    expect(readFileSync(local, 'utf8')).toBe('my uncommitted file\n');
  });

  it('normally retries a repository that was missing during initialization', () => {
    const s = stage();
    const hidden = `${s.repo.bare}.hidden`;
    renameSync(s.repo.bare, hidden);
    const initial = s.init();
    expect(initial.status, initial.stderr).toBe(0);
    expect(initial.json()).toMatchObject({
      preparation_complete: false,
      sync: { summary: { unreadable: 1 } },
    });
    expect(existsSync(path.join(s.root, 'api'))).toBe(false);
    renameSync(hidden, s.repo.bare);
    const retry = fx(['sync', '--only', 'repos', '--details', '--format', 'json'], s.env, s.root);
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.json()).toMatchObject({
      preparation_complete: true,
      items: [{ name: 'api', action: 'clone', result: 'done' }],
    });
    expect(readFileSync(path.join(s.root, 'api/README'), 'utf8')).toBe('initial\n');
  });

  it('fails validation after required manifest deletion but accepts absent optional documents', () => {
    const s = stage();
    expect(s.init().status).toBe(0);
    const before = fx(['manifest', 'validate', '--strict', '--format', 'json'], s.env, s.root);
    expect(before.status, before.stderr).toBe(0);
    expect(before.json()).toMatchObject({ ok: true });
    rmSync(path.join(manifestDirOf(s.env.FX_HOME, 'sample'), 'manifest/workspace.yaml'));
    for (const strict of [[], ['--strict']]) {
      const result = fx(['manifest', 'validate', ...strict, '--format', 'json'], s.env, s.root);
      expect(result.status, result.stderr).toBe(3);
      expect(result.json()).toMatchObject({
        ok: false,
        documents: [
          expect.objectContaining({
            kind: 'workspace',
            present: false,
            problems: [{ path: '(root)', message: 'Required manifest/workspace.yaml is missing.' }],
          }),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        ],
      });
    }
  });

  it('does not require optional bundled companions for a plain local-git workspace', () => {
    const s = stage();
    expect(s.init().status).toBe(0);
    const result = fx(['doctor', '--details', '--format', 'json'], s.env, s.root);
    expect(result.status, result.stderr).toBe(0);
    const report = result.json() as {
      ok: boolean;
      findings: { group: string; id: string; level: string }[];
    };
    expect(report.ok).toBe(true);
    expect(report.findings.filter((finding) => finding.group === 'tools')).toEqual([]);
    expect(report.findings.filter((finding) => finding.group === 'login')).toEqual([]);
  });
});
