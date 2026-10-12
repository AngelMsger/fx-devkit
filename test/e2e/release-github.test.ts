// fx release check on GitHub end to end: the code host and CI are bound to the github and
// github-actions providers, and a stand-in gh answers the API from bare repositories,
// so the release check runs unchanged against a host it was not written for.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutable, runtimeTools, systemPath, writeNodeShim } from '../platform.js';

import { freshHome, fx, tempDir } from './harness.js';

interface Finding {
  readonly group: string;
  readonly id: string;
  readonly level: string;
  readonly evidence?: Record<string, unknown>;
}

const identity = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

// A GitHub API over `<root>/<owner>/<name>.git`: the endpoints the github code host
// reads, `gh run list` from a fixed table, and every invocation logged. It runs git by
// its full path: on Windows the git on the test's PATH is a batch file, which
// execFileSync cannot start.
const FAKE_GH = `
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
const out = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v) + '\\n');
const notFound = () => { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); };
if (args[0] === '--version') { out('gh version 2.89.0 (2026-03-26)\\n'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') process.exit(0);
const flag = (name) => args[args.indexOf(name) + 1];
if (args[0] === 'run' && args[1] === 'list') {
  if (flag('--workflow') !== 'ci.yml') { process.stderr.write('HTTP 404: workflow not found\\n'); process.exit(1); }
  const broken = flag('--repo') === 'github.com/octo/a' && flag('--branch') === 'dev';
  out([{ number: broken ? 4 : 9, status: 'completed', conclusion: broken ? 'failure' : 'success',
    startedAt: '2999-01-01T00:00:00Z', url: 'https://github.example/actions/runs/' + (broken ? 4 : 9) }]);
  process.exit(0);
}
if (args[0] !== 'api') process.exit(2);
const [endpoint, query = ''] = args[args.length - 1].split('?');
const [, owner, name, kind, ...rest] = endpoint.split('/');
const git = (...a) =>
  execFileSync(${JSON.stringify(gitExecutable())}, ['--git-dir', path.join(process.env.FAKE_GH_ROOT, owner, name + '.git'), ...a], {
    encoding: 'utf8',
  });
const commits = (...a) => git('rev-list', '--format=%H%x00%an%x00%cI%x00%P%x00%s', ...a)
  .split('\\n').filter((l) => l.includes('\\0')).map((l) => {
    const [sha, author, date, parents, message] = l.split('\\0');
    return { sha, author, date, message, parents: parents.split(' ').filter(Boolean) };
  });
if (endpoint === 'user') out('alice\\n');
else if (kind === undefined) out(args.includes('.default_branch') ? 'main\\n' : owner + '/' + name + '\\n');
else if (kind === 'branches')
  for (const line of git('for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads').trim().split('\\n')) {
    const [branch, sha] = line.split(' ');
    out({ name: branch, sha });
  }
else if (kind === 'compare') {
  const [from, to] = rest.join('/').split('...');
  const list = commits(to, '^' + from);
  out({ total: list.length, commits: list });
} else if (kind === 'commits') out(commits('-1', rest.join('/'))[0]);
else if (kind === 'contents') {
  try { out(git('show', new URLSearchParams(query).get('ref') + ':' + rest.join('/'))); } catch { notFound(); }
} else process.exit(2);
`;

// A bare repository with main and dev; `ahead` adds one dev-only commit.
function bare(root: string, name: string, files: Record<string, string>, ahead: boolean): void {
  const repo = path.join(root, 'octo', `${name}.git`);
  const author = path.join(root, `author-${name}`);
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: author, env: identity });
  };
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', repo]);
  execFileSync('git', ['clone', '-q', repo, author]);
  git('checkout', '-q', '-b', 'main');
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(author, file), text);
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('checkout', '-q', '-b', 'dev');
  if (ahead) {
    writeFileSync(path.join(author, 'NOTE'), 'more\n');
    git('add', '.');
    git('commit', '-q', '-m', 'feat: more');
  }
  git('push', '-q', 'origin', 'main', 'dev');
}

function stage(): { ws: string; env: Record<string, string>; log: string } {
  const base = tempDir('fx-release-github-e2e-');
  const root = path.join(base, 'github');
  bare(root, 'a', { 'package.json': '{"dependencies":{"x":"1.0.0-dev"}}\n' }, true);
  bare(root, 'b', { 'requirements.txt': 'httpx==0.27\n' }, false);
  const manifestDir = path.join(base, 'src', 'manifest');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, 'workspace.yaml'),
    [
      'schema_version: 2',
      'providers:',
      // Clones come from the bare repositories; every query goes through gh.
      `  code-host: { provider: github, vars: { host: ${JSON.stringify(root)} } }`,
      'defaults: { upstream_project: octo, branch: main }',
      'repos:',
      '  - { name: a, desc: Broken, tags: [backend] }',
      '  - { name: b, desc: Fine, tags: [backend] }',
      'release:',
      '  source: dev',
      '  ci: { source_env: dev, target_env: prod }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(manifestDir, 'environments.yaml'),
    [
      'schema_version: 2',
      'platforms:',
      "  actions: { provider: github-actions, capability: ci, vars: { repository: 'octo/{repo}' } }",
      'envs:',
      '  dev:',
      '    label: Development',
      '    platforms: { actions: { vars: { workflow: ci.yml, branch: dev } } }',
      '  prod:',
      '    label: Production',
      '    platforms: { actions: { vars: { workflow: ci.yml, branch: main, event: push } } }',
      '',
    ].join('\n'),
  );
  const shims = path.join(base, 'shims');
  writeNodeShim(shims, 'gh', FAKE_GH);
  const tools = path.join(base, 'tools');
  mkdirSync(tools);
  runtimeTools(tools);
  const log = path.join(base, 'gh.log');
  writeFileSync(log, '');
  const ws = path.join(base, 'ws');
  const env = {
    FX_HOME: freshHome(),
    PATH: [shims, tools, ...systemPath()].join(path.delimiter),
    FAKE_GH_ROOT: root,
    FAKE_GH_LOG: log,
  };
  const boot = fx(
    ['init', '--details', ws, '--from', path.dirname(manifestDir), '--format', 'json'],
    env,
  );
  expect(boot.status, boot.stderr).toBe(0);
  expect(boot.json()).toMatchObject({ preparation: { state: 'ready' }, registered: true });
  return { ws, env, log };
}

describe('release on GitHub', () => {
  it('answers every check from gh alone, with the same verdicts as any other host', () => {
    const s = stage();
    const run = fx(['release', 'check', '--details', '--format', 'json'], s.env, s.ws);
    expect(run.status, run.stderr).toBe(0);
    const findings = (run.json() as { findings: Finding[] }).findings;
    const level = Object.fromEntries(findings.map((f) => [`${f.group}:${f.id}`, f.level]));
    expect(level).toEqual({
      'deps:a': 'fail',
      'deps:b': 'ok',
      'merge:a': 'fail',
      'merge:b': 'ok',
      'ci:a': 'fail',
      'ci:b': 'ok',
      'errors:a': 'ok',
      'errors:b': 'ok',
    });
    expect(findings.find((f) => f.group === 'merge' && f.id === 'a')?.evidence).toMatchObject({
      ahead: [{ message: 'feat: more' }],
      behind: [],
    });
    expect(findings.find((f) => f.group === 'ci' && f.id === 'b')?.evidence).toMatchObject({
      builds: [
        { side: 'source', branch: 'dev', number: 9, status: 'success', current: true },
        { side: 'target', branch: 'main', number: 9, url: 'https://github.example/actions/runs/9' },
      ],
    });
    // Each side asked for its own branch, and production for pushes only.
    const runs = readFileSync(s.log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
      .filter((args) => args[0] === 'run' && args.includes('github.com/octo/b'));
    expect(runs.map((args) => args.slice(6, 10))).toEqual(
      expect.arrayContaining([
        ['--branch', 'dev', '--limit', '1'],
        ['--branch', 'main', '--event', 'push'],
      ]),
    );
  });
});
