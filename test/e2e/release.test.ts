// fx release end to end: a local-git host holding two repositories, one
// with everything wrong and one with nothing wrong, shims standing in for
// jenkins-cli and sentry, and a temporary FX_HOME.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim, runtimeTools, systemPath } from '../platform.js';

import { freshHome, fx, tempDir } from './harness.js';

interface Stage {
  readonly ws: string;
  readonly env: Record<string, string>;
}

interface Finding {
  readonly group: string;
  readonly id: string;
  readonly level: string;
  readonly message: string;
  readonly fix?: string;
  readonly handoff?: { command: string } | null;
  readonly evidence?: Record<string, unknown>;
}
interface Report {
  readonly ok: boolean;
  readonly summary: { ok: number; warn: number; fail: number };
  readonly findings: Finding[];
}

const identity = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

// A bare repository with main and dev; `ahead` adds one dev-only commit.
function bare(
  host: string,
  base: string,
  name: string,
  files: Record<string, string>,
  ahead: boolean,
): void {
  const repo = path.join(host, `${name}.git`);
  const author = path.join(base, `author-${name}`);
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
    git('commit', '-q', '-m', 'feat: m-1 more');
  }
  git('push', '-q', 'origin', 'main', 'dev');
}

function shim(dir: string, name: string, body: string): void {
  writeNodeShim(dir, name, body);
}

function stage(): Stage {
  const base = tempDir('fx-release-e2e-');
  const host = path.join(base, 'host', 'fx');
  mkdirSync(host, { recursive: true });
  bare(host, base, 'a', { 'package.json': '{"dependencies":{"x":"1.0.0-dev"}}\n' }, true);
  bare(host, base, 'b', { VERSION: '1.0.0\n', 'requirements.txt': 'httpx==0.27\n' }, false);
  const manifestDir = path.join(base, 'src', 'manifest');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, 'workspace.yaml'),
    [
      'schema_version: 2',
      'providers:',
      `  code-host: { provider: local-git, vars: { host: ${path.dirname(host)}, user: alice } }`,
      'defaults: { upstream_project: fx, branch: main }',
      'repos:',
      '  - { name: a, desc: Broken, tags: [backend], obs: { svc: alpha } }',
      '  - { name: b, desc: Fine, tags: [backend], obs: { svc: beta } }',
      'release:',
      '  source: dev',
      '  env: dev',
      '  ci: { source_env: dev, target_env: prod }',
      '  bots: [ci]',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(manifestDir, 'tools.yaml'),
    "schema_version: 3\ntools: [{name: sentry, min_version: '0.42.2'}, {name: jenkins-cli, min_version: '1.0.0'}]\n",
  );
  writeFileSync(
    path.join(manifestDir, 'environments.yaml'),
    [
      'schema_version: 2',
      'platforms:',
      '  sentry: { provider: sentry, capability: error-tracker, vars: { host: sentry.example.com, org: fx } }',
      '  jenkins: { provider: jenkins-cli, capability: ci, vars: { host: jenkins.example.com } }',
      'envs:',
      '  dev:',
      '    label: Development',
      '    platforms:',
      '      sentry: { vars: { team: fx-dev, slug: "fx-{svc}-dev" } }',
      '      jenkins: { vars: { path: "services/{repo}/dev" } }',
      '  prod:',
      '    label: Production',
      '    platforms:',
      '      sentry: { vars: { team: fx, slug: "fx-{svc}" } }',
      '      jenkins: { vars: { path: "services/{repo}/main" } }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(manifestDir, 'members.yaml'),
    [
      'schema_version: 1',
      'sensitive: true',
      'people:',
      '  - { id: alice, display: Alice, email: alice@example.com, git_names: [T] }',
      '',
    ].join('\n'),
  );
  const shims = path.join(base, 'shims');
  mkdirSync(shims);
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  shim(
    shims,
    'jenkins-cli',
    `
const a=process.argv.slice(2).join(' ');
if(a==='--version') console.log('jenkins-cli 1.0.0');
else if(a==='auth status') process.exit(0);
else if(a.includes('build get ')) console.log(JSON.stringify({building:false,number:a.includes('build get services/a/dev')?4:9,status:a.includes('build get services/a/dev')?'failure':'success',started_at:'2999-01-01T00:00:00Z',url:null}));
else process.exit(2);
`,
  );
  shim(
    shims,
    'sentry',
    `
const a=process.argv.slice(2).join(' ');
if(a==='--version') console.log('sentry 0.42.2');
else if(a==='auth status') process.exit(Number(process.env.FAKE_SENTRY_OK??0));
else if(a.includes('issue list ')) console.log(JSON.stringify({data:a.includes('issue list fx/fx-alpha-dev')?[{id:'1',shortId:'FX-ALPHA-DEV-1',title:'boom',level:'error',firstSeen:'${recent}',lastSeen:'${recent}',count:'3',permalink:null,culprit:null}]:[],hasMore:false}));
else process.exit(2);
`,
  );
  const tools = path.join(base, 'tools');
  mkdirSync(tools);
  runtimeTools(tools);
  const ws = path.join(base, 'ws');
  const env = {
    FX_HOME: freshHome(),
    PATH: [shims, tools, ...systemPath()].join(path.delimiter),
  };
  const boot = fx(
    ['init', '--details', ws, '--from', path.dirname(manifestDir), '--format', 'json'],
    env,
  );
  expect(boot.status, boot.stderr).toBe(0);
  expect(boot.json()).toMatchObject({ preparation: { state: 'ready' }, registered: true });
  return { ws, env };
}

describe('release', () => {
  it('reports every check of every repository with the evidence, and never fails the command', () => {
    const s = stage();
    const run = fx(['release', '--details', '--format', 'json'], s.env, s.ws);
    expect(run.status, run.stderr).toBe(0);
    const report = run.json() as Report;
    const level = Object.fromEntries(report.findings.map((f) => [`${f.group}:${f.id}`, f.level]));
    expect(level).toEqual({
      'deps:a': 'fail',
      'deps:b': 'ok',
      'merge:a': 'fail',
      'merge:b': 'ok',
      'ci:a': 'fail',
      'ci:b': 'ok',
      'errors:a': 'fail',
      'errors:b': 'ok',
    });
    expect(report.ok).toBe(false);
    const merge = report.findings.find((f) => f.group === 'merge' && f.id === 'a');
    expect(merge?.message).toBe('1 commit on dev not on main');
    expect(merge?.evidence).toMatchObject({
      ahead: [{ author: { id: 'alice', name: 'Alice' }, message: 'feat: m-1 more' }],
      behind: [],
    });
    expect(report.findings.find((f) => f.group === 'deps' && f.id === 'a')?.message).toBe(
      'package.json: x 1.0.0-dev (dependencies)',
    );
    expect(report.findings.find((f) => f.group === 'ci' && f.id === 'a')?.message).toContain(
      'dev #4 failure',
    );
    expect(run.stderr).toContain('RELEASE_FAILURES');
  });

  it('narrows to one repository and one check, and refuses a name it does not know', () => {
    const s = stage();
    const one = fx(
      ['release', '--details', 'b', '--only', 'merge', '--format', 'json'],
      s.env,
      s.ws,
    );
    expect(one.status, one.stderr).toBe(0);
    const report = one.json() as Report;
    expect(report.findings.map((f) => `${f.group}:${f.id}:${f.level}`)).toEqual(['merge:b:ok']);
    expect(report.ok).toBe(true);
    const nope = fx(['release', '--details', 'nope', '--format', 'json'], s.env, s.ws);
    expect(nope.status).toBe(6);
    expect(nope.error().code).toBe('REPO_NOT_FOUND');
  });

  it('turns an error tracker a person has not logged in to into warnings with a handoff, nothing else changes', () => {
    const s = stage();
    const run = fx(
      ['release', '--details', '--format', 'json'],
      { ...s.env, FAKE_SENTRY_OK: '1' },
      s.ws,
    );
    expect(run.status, run.stderr).toBe(0);
    const report = run.json() as Report;
    const errors = report.findings.filter((f) => f.group === 'errors');
    expect(errors.map((f) => f.level)).toEqual(['warn', 'warn']);
    expect(errors[0]?.handoff).toMatchObject({ command: 'fx login sentry --workspace ws' });
    expect(errors[0]?.fix).toBe('fx login sentry --workspace ws');
    expect(report.findings.filter((f) => f.group !== 'errors').map((f) => f.level)).toEqual([
      'fail',
      'ok',
      'fail',
      'ok',
      'fail',
      'ok',
    ]);
  });

  it('prints the same columns as doctor for a person', () => {
    const s = stage();
    const run = fx(['release', '--details', 'b'], s.env, s.ws);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/^group\s+level\s+id\s+message\s+fix/m);
    expect(run.stdout).toMatch(/^merge\s+ok\s+b\s+dev and main agree/m);
    expect(run.stdout.split('\n').filter((l) => l !== '')).toHaveLength(6);
  });
});
