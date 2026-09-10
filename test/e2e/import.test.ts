// Adopting a hand-built directory end to end: real git checkouts of every
// shape the design names, a .gitmodules recording one intent, and the
// manifest that comes out feeding an init of its own.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshHome, fx } from './harness.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

function bare(host: string, project: string, name: string, branch: string): string {
  const dir = path.join(host, project, `${name}.git`);
  mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '-b', branch, dir]);
  const seed = mkdtempSync(path.join(tmpdir(), 'seed-'));
  git(seed, 'clone', '-q', dir, 'w');
  const w = path.join(seed, 'w');
  git(w, 'checkout', '-q', '-b', branch);
  writeFileSync(path.join(w, 'README'), `${name}\n`);
  git(w, 'add', '.');
  git(w, 'commit', '-q', '-m', 'one');
  git(w, 'push', '-q', '-u', 'origin', branch);
  return dir;
}

interface Stage {
  readonly root: string;
  readonly host: string;
  readonly env: Record<string, string>;
}

function stage(): Stage {
  const base = mkdtempSync(path.join(tmpdir(), 'fx-import-e2e-'));
  const host = path.join(base, 'host');
  const root = path.join(base, 'ws');
  mkdirSync(root);
  const clone = (bareDir: string, into: string, remote: string): void => {
    git(root, 'clone', '-q', '-o', remote, bareDir, into);
    git(path.join(root, into), 'remote', 'set-head', remote, '--auto');
  };
  // 1: upstream remote, on a task branch, with .gitmodules saying dev
  clone(bare(host, 'fx', 'fx-example-api', 'dev'), 'fx-example-api', 'upstream');
  git(path.join(root, 'fx-example-api'), 'checkout', '-q', '-b', 'feature/x');
  // 2: origin only, in a project namespace: origin is the upstream
  clone(bare(host, 'fx', 'direct', 'main'), 'direct', 'origin');
  // 3: origin only, personal namespace; the search covers projects already seen, so ai needs one member
  clone(bare(host, 'ai', 'agent-app', 'main'), 'agent-app', 'upstream');
  bare(host, 'ai', 'agent-runtime', 'integration');
  clone(bare(host, '~alice', 'agent-runtime', 'integration'), 'agent-runtime', 'origin');
  // 4: no remote at all
  const local = path.join(root, 'scratch-repo');
  mkdirSync(local);
  git(local, 'init', '-q', '-b', 'main');
  // container with one repository inside, and a plain directory
  clone(bare(host, 'fx', 'runtime', 'dev'), path.join('runtimes', 'runtime'), 'upstream');
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs', 'notes.md'), 'prose\n');
  writeFileSync(
    path.join(root, '.gitmodules'),
    '[submodule "fx-example-api"]\n\tpath = fx-example-api\n\turl = x\n\tbranch = dev\n',
  );
  return { root, host, env: { FX_HOME: freshHome() } };
}

interface Report {
  readonly repos: number;
  readonly skipped: { path: string; reason: string }[];
  readonly review: { name: string; note: string }[];
  readonly branch_from: { gitmodules: number; remote_head: number; checkout: number };
}

describe('import', () => {
  it('describes the directory, marks its doubt, and yields a manifest an init can use', () => {
    const s = stage();
    const dry = fx(['manifest', 'import', s.root, '--format', 'json'], s.env, s.root);
    expect(dry.status, dry.stderr).toBe(0);
    const out = dry.json() as { written: boolean; manifest: string; report: Report };
    expect(out.written).toBe(false);
    expect(existsSync(path.join(s.root, 'manifest')), 'import writes nothing unasked').toBe(false);
    expect(out.report.repos).toBe(5);
    expect(out.report.skipped.map((x) => x.path).sort()).toEqual(['docs', 'scratch-repo']);
    expect(out.report.review.map((r) => r.name)).toEqual(['agent-runtime']);
    expect(out.report.branch_from).toEqual({ gitmodules: 1, remote_head: 4, checkout: 0 });
    expect(out.manifest).toContain('# review: upstream inferred');
    expect(out.manifest).toMatch(/- name: agent-runtime\n\s+project: ai\n\s+branch: integration/);
    expect(out.manifest).toContain('path: runtimes/runtime');
    expect(
      fx(['manifest', 'import', s.root], s.env, s.root).stdout.trimEnd(),
      'human output is the yaml',
    ).toBe(out.manifest.trimEnd());

    const src = path.join(path.dirname(s.root), 'src');
    const manifest = path.join(src, 'manifest', 'workspace.yaml');
    const real = fx(
      ['manifest', 'import', s.root, '-o', manifest, '--format', 'json'],
      s.env,
      s.root,
    );
    expect(real.status, real.stderr).toBe(0);
    expect(readFileSync(manifest, 'utf8')).toBe(out.manifest);
    expect(
      git(path.join(s.root, 'fx-example-api'), 'branch', '--show-current'),
      'checkouts untouched',
    ).toBe('feature/x');

    const valid = fx(['manifest', 'validate', '--strict', '--format', 'json'], s.env, src);
    expect(valid.status, valid.stderr).toBe(0);

    // The generated manifest names bitbucket-cli; a local-git binding lets init clone from the same bare host.
    writeFileSync(
      manifest,
      readFileSync(manifest, 'utf8').replace(
        /providers:\n  code-host:[^\n]*\n(?:\s+[^\n]*\n)*?defaults:/,
        `providers:\n  code-host: { provider: local-git, vars: { host: ${s.host}, user: alice } }\ndefaults:`,
      ),
    );
    const target = path.join(path.dirname(s.root), 'ws2');
    const boot = fx(['init', target, '--from', src, '--format', 'json'], s.env);
    expect(boot.status, boot.stderr).toBe(0);
    expect((boot.json() as { sync: { summary: { done: number } } }).sync.summary.done).toBe(5);
    expect(git(path.join(target, 'agent-runtime'), 'branch', '--show-current')).toBe('integration');
  });
});
