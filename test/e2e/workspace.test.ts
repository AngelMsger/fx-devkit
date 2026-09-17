// The whole workspace story against real git: two bare repositories stand
// in for the code host through the local-git provider, a temporary FX_HOME
// holds the personal state, and nothing leaves the machine.

import {
  existsSync,
  symlinkSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshHome, fx, git, manifestDirOf } from './harness.js';

interface Stage {
  readonly host: string;
  readonly authors: Record<string, string>;
  readonly manifestDir: string;
  readonly ws: string;
  readonly env: Record<string, string>;
}

function stage(): Stage {
  const base = mkdtempSync(path.join(tmpdir(), 'fx-e2e-'));
  const host = path.join(base, 'host');
  mkdirSync(path.join(host, 'fx'), { recursive: true });
  const authors: Record<string, string> = {};
  for (const name of ['a', 'b']) {
    const bare = path.join(host, 'fx', `${name}.git`);
    const author = path.join(base, `author-${name}`);
    git(['init', '--quiet', '--bare', '-b', 'main', bare], base);
    git(['clone', '-q', bare, author], base);
    git(['checkout', '-q', '-b', 'main'], author);
    writeFileSync(path.join(author, 'README'), `${name}\n`);
    git(['add', '.'], author);
    git(['commit', '-q', '-m', 'one'], author);
    git(['push', '-q', '-u', 'origin', 'main'], author);
    authors[name] = author;
  }
  const manifestDir = path.join(base, 'manifest-src', 'manifest');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, 'workspace.yaml'),
    [
      'schema_version: 2',
      'providers:',
      `  code-host: { provider: local-git, vars: { host: ${host}, user: alice } }`,
      'defaults: { upstream_project: fx, branch: main }',
      'projects:',
      '  fx: { label: Local, contact: "#local" }',
      'repos:',
      '  - { name: a, desc: First, tags: [one] }',
      '  - { name: b, desc: Second, tags: [two] }',
      '',
    ].join('\n'),
  );
  return { host, authors, manifestDir, ws: path.join(base, 'ws'), env: { FX_HOME: freshHome() } };
}

function advance(author: string, file: string): void {
  writeFileSync(path.join(author, file), `${file}\n`);
  git(['add', '.'], author);
  git(['commit', '-q', '-m', file], author);
  git(['push', '-q', 'origin', 'main'], author);
}

describe('workspace end to end', () => {
  it('retries the same physical root through a symlink alias but rejects another root', () => {
    const s = stage();
    const source = path.dirname(s.manifestDir);
    const args = ['--from', source, '--name', 'alias-test', '--format', 'json'];
    const first = fx(['init', '--details', s.ws, ...args], s.env);
    expect(first.status, first.stderr).toBe(0);
    const alias = path.join(path.dirname(s.ws), 'alias');
    symlinkSync(realpathSync(s.ws), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const retried = fx(['init', '--details', alias, ...args], s.env);
    expect(retried.status, retried.stderr).toBe(0);
    expect(retried.json()).toMatchObject({ written: true, sync: { summary: { failed: 0 } } });
    const different = fx(
      ['init', '--details', path.join(path.dirname(s.ws), 'other'), ...args],
      s.env,
    );
    expect(different.status).toBe(11);
    expect(different.error().code).toBe('WORKSPACE_NAME_TAKEN');
  });

  it('inits, syncs safely, selects, registers and forks', () => {
    const s = stage();

    const boot = fx(
      ['init', s.ws, '--from', path.dirname(s.manifestDir), '--format', 'json'],
      s.env,
    );
    expect(boot.status, boot.stderr).toBe(0);
    expect(boot.json()).toMatchObject({
      name: 'ws',
      manifest: 'materialized',
      registered: true,
      default_workspace: true,
    });
    expect((boot.json() as { sync: { summary: { done: number } } }).sync.summary.done).toBe(2);
    expect(existsSync(path.join(s.ws, 'manifest')), 'the root holds no manifest').toBe(false);
    expect(
      existsSync(
        path.join(manifestDirOf(s.env['FX_HOME'] ?? '', 'ws'), 'manifest', 'workspace.yaml'),
      ),
    ).toBe(true);
    expect(readFileSync(path.join(s.ws, 'AGENTS.md'), 'utf8').startsWith('<!-- fx:derived')).toBe(
      true,
    );
    expect(readFileSync(path.join(s.env['FX_HOME'] ?? '', 'config.yaml'), 'utf8')).toContain(
      'default_workspace: ws',
    );
    expect(git(['remote'], path.join(s.ws, 'a')).split('\n').sort()).toEqual([
      'origin',
      'upstream',
    ]);

    const status = fx(['status', '--format', 'json'], s.env, s.ws);
    expect(status.status).toBe(0);
    expect((status.json() as { items: { name: string; note: string | null }[] }).items).toEqual([
      expect.objectContaining({ name: 'a', exists: true, note: null }),
      expect.objectContaining({ name: 'b', exists: true, note: null }),
    ]);
    const blockedStatus = fx(['status', '--fetch'], { ...s.env, FX_READ_ONLY: '1' }, s.ws);
    expect(blockedStatus.status).toBe(5);
    expect(blockedStatus.error().code).toBe('READONLY_BLOCKED');
    const statusPlan = fx(
      ['status', '--fetch', '--dry-run', '--format', 'json'],
      { ...s.env, FX_READ_ONLY: '1' },
      s.ws,
    );
    expect(statusPlan.status, statusPlan.stderr).toBe(0);
    expect(
      (statusPlan.json() as { items: { fetch: string }[] }).items.map((item) => item.fetch),
    ).toEqual(['planned', 'planned']);

    writeFileSync(path.join(s.ws, 'a', 'README'), 'edited\n');
    const first = fx(['sync', '--details', '--format', 'json'], s.env, s.ws);
    expect(first.status).toBe(0);
    expect(
      (first.json() as { items: { name: string; action: string; result: string }[] }).items,
    ).toEqual([
      expect.objectContaining({ name: 'a', action: 'skip_dirty', result: 'skipped' }),
      expect.objectContaining({
        name: 'b',
        action: 'fast_forward',
        result: 'done',
        outcome: 'up_to_date',
      }),
    ]);
    expect(readFileSync(path.join(s.ws, 'a', 'README'), 'utf8')).toBe('edited\n');

    git(['checkout', '-q', '-b', 'feature/x'], path.join(s.ws, 'b'));
    advance(s.authors['b'] ?? '', 'two');
    const second = fx(['sync', '--details', '--format', 'json'], s.env, s.ws);
    expect(
      (second.json() as { items: { name: string; outcome?: string; mode?: string }[] }).items[1],
    ).toMatchObject({
      name: 'b',
      mode: 'ref',
      outcome: 'updated',
    });
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(s.ws, 'b'))).toBe('feature/x');
    expect(git(['rev-parse', 'main'], path.join(s.ws, 'b'))).toBe(
      git(['rev-parse', 'upstream/main'], path.join(s.ws, 'b')),
    );

    expect(fx(['repo', 'unpick', 'b'], s.env, s.ws).status).toBe(0);
    const plan = fx(['sync', '--details', '--dry-run', '--format', 'json'], s.env, s.ws);
    expect(
      (plan.json() as { items: { name: string; action: string; result: string }[] }).items.map(
        (i) => [i.name, i.action, i.result],
      ),
    ).toEqual([
      ['a', 'skip_dirty', 'planned'],
      ['b', 'skip_unpicked', 'planned'],
    ]);

    const scratch = path.join(path.dirname(s.ws), 'scratch');
    git(['init', '--quiet', scratch], path.dirname(s.ws));
    expect(fx(['repo', 'add', scratch], s.env, s.ws).status).toBe(0);
    const listed = fx(['repo', 'list', '--format', 'json'], s.env, s.ws);
    expect(
      (listed.json() as { items: { name: string; origin: string; picked: boolean }[] }).items,
    ).toEqual([
      expect.objectContaining({ name: 'a', origin: 'shared', picked: true }),
      expect.objectContaining({ name: 'scratch', origin: 'local', picked: true }),
      expect.objectContaining({ name: 'b', origin: 'shared', picked: false }),
    ]);
    expect(fx(['repo', 'remove', 'scratch'], s.env, s.ws).status).toBe(0);
    expect(existsSync(path.join(scratch, '.git'))).toBe(true);

    const fork = fx(['repo', 'fork', 'a', '--format', 'json'], s.env, s.ws);
    expect(fork.status).toBe(0);
    expect(fork.json()).toMatchObject({ created: true, url: path.join(s.host, '~alice', 'a.git') });
    expect(existsSync(path.join(s.host, '~alice', 'a.git', 'HEAD'))).toBe(true);
    expect(fx(['repo', 'fork', 'a', '--format', 'json'], s.env, s.ws).json()).toMatchObject({
      created: false,
    });
  });

  it('adopts a non-empty directory without touching unrelated files and is idempotent', () => {
    const s = stage();
    mkdirSync(s.ws);
    writeFileSync(path.join(s.ws, 'notes.txt'), 'x');
    const adopted = fx(
      ['init', s.ws, '--from', path.dirname(s.manifestDir), '--format', 'json'],
      s.env,
    );
    expect(adopted.status, adopted.stderr).toBe(0);
    expect(adopted.json()).toMatchObject({ adopted: true, registered: true });
    expect(existsSync(path.join(s.ws, 'notes.txt'))).toBe(true);
    expect(existsSync(path.join(s.ws, 'b', 'README'))).toBe(true);
    expect(existsSync(path.join(s.ws, 'manifest'))).toBe(false);

    const ws2 = `${s.ws}-2`;
    expect(
      fx(['init', '--details', ws2, '--from', path.dirname(s.manifestDir)], s.env).status,
    ).toBe(0);
    const again = fx(
      ['init', ws2, '--from', path.dirname(s.manifestDir), '--format', 'json'],
      s.env,
    );
    expect(again.status).toBe(0);
    expect(again.json()).toMatchObject({ manifest: 'materialized', registered: true });
  });

  it('blocks init under read-only posture and previews under dry-run', () => {
    const s = stage();
    expect(
      fx(['init', '--details', s.ws, '--from', path.dirname(s.manifestDir)], {
        ...s.env,
        FX_READ_ONLY: '1',
      }).status,
    ).toBe(5);
    const preview = fx(
      ['init', s.ws, '--from', path.dirname(s.manifestDir), '--dry-run', '--format', 'json'],
      s.env,
    );
    expect(preview.status).toBe(0);
    expect(preview.json()).toMatchObject({ written: false, sync: null });
    expect(existsSync(s.ws)).toBe(false);
  });
});
