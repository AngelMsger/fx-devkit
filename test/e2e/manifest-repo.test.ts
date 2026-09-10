// A manifest repository end to end: initialised from a bare git repository,
// materialized under FX_HOME as the checkout a person edits, linked into the
// root for agents, refreshed by sync, and never confused with another source.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { begin, end } from '../../src/domain/docs/regions.js';
import { pathKey } from '../../src/domain/path.js';

import { freshHome, fx, git, manifestDirOf, repository, type Repository } from './harness.js';

interface Items<T> {
  items: T[];
}

interface Stage {
  readonly host: string;
  readonly manifest: Repository;
  readonly ws: string;
  readonly env: { readonly FX_HOME: string };
}

const workspaceYaml = (host: string, repos: readonly string[]): string =>
  [
    'schema_version: 2',
    'providers:',
    `  code-host: { provider: local-git, vars: { host: ${host}, user: alice } }`,
    'defaults: { upstream_project: fx, branch: main }',
    'projects:',
    '  fx: { label: Local, contact: "#local" }',
    'repos:',
    ...repos.map((name) => `  - { name: ${name}, desc: ${name.toUpperCase()}, tags: [one] }`),
    '',
  ].join('\n');

const agentsMd = [
  '# The team workspace',
  '',
  'Routing rules people wrote.',
  '',
  ...['project-index', 'capabilities', 'environments', 'rules', 'ask-fx'].flatMap((name) => [
    begin(name),
    name === 'rules' ? 'stale' : '',
    end(name),
    '',
  ]),
].join('\n');

function stage(): Stage {
  const base = mkdtempSync(path.join(tmpdir(), 'fx-manifest-e2e-'));
  const host = path.join(base, 'host');
  mkdirSync(path.join(host, 'fx'), { recursive: true });
  for (const name of ['a', 'b', 'c'])
    repository(path.join(host, 'fx'), name, { README: `${name}\n` });
  const manifest = repository(base, 'fx-workspace', {
    'manifest/workspace.yaml': workspaceYaml(host, ['a', 'b']),
    'AGENTS.md': agentsMd,
    'skills/review/SKILL.md': '---\nname: review\ndescription: Review\n---\n',
  });
  const home = freshHome();
  writeFileSync(path.join(home, 'config.yaml'), 'agents: [claude-code]\n');
  return { host, manifest, ws: path.join(base, 'ws'), env: { FX_HOME: home } };
}

const names = (run: ReturnType<typeof fx>): string[] =>
  (run.json() as Items<{ name: string }>).items.map((i) => i.name).sort();

describe('a manifest repository', () => {
  it('is cloned under FX_HOME, derives the root documents, and is refreshed by sync unless told not to', () => {
    const s = stage();
    const sourceDir = manifestDirOf(s.env.FX_HOME, 'ws');

    const boot = fx(['init', s.ws, '--from', s.manifest.bare, '--format', 'json'], s.env);
    expect(boot.status, boot.stderr).toBe(0);
    expect(boot.json()).toMatchObject({ manifest: 'materialized', manifest_dir: sourceDir });
    expect(readFileSync(path.join(s.env.FX_HOME, 'config.yaml'), 'utf8')).toContain(
      `source: ${s.manifest.bare}`,
    );
    expect(git(['remote', 'get-url', 'upstream'], sourceDir)).toBe(s.manifest.bare);
    expect(existsSync(path.join(s.ws, '.git'))).toBe(false);
    expect(existsSync(path.join(s.ws, 'manifest'))).toBe(false);
    const agents = readFileSync(path.join(s.ws, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith(`<!-- fx:derived from ${path.join(sourceDir, 'AGENTS.md')}`)).toBe(
      true,
    );
    expect(agents).toContain('Routing rules people wrote.');
    expect(agents).toContain('| `a` |');
    expect(agents).not.toContain('stale');
    expect(readFileSync(path.join(s.ws, 'CLAUDE.md'), 'utf8').startsWith('<!-- fx:derived')).toBe(
      true,
    );
    const stages = (boot.json() as { sync: { stages: Record<string, unknown> } }).sync.stages;
    expect(stages['docs']).toMatchObject({ created: 2 });
    expect(stages['skills']).toMatchObject({ create: 1 });
    expect(pathKey(readlinkSync(path.join(s.ws, '.claude', 'skills')))).toBe(
      pathKey(path.join(sourceDir, 'skills')),
    );

    const repos = fx(['repo', 'list', '--format', 'json'], s.env, s.ws);
    expect(repos.status, repos.stderr).toBe(0);
    expect((repos.json() as Items<{ name: string; origin: string; path: string }>).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'fx-workspace', origin: 'manifest', path: sourceDir }),
      ]),
    );
    expect(git(['remote', 'get-url', 'origin'], sourceDir)).toContain('~alice/fx-workspace');
    const status = fx(['status', '--format', 'json'], s.env, s.ws);
    expect(status.status, status.stderr).toBe(0);
    expect(names(status)).toEqual(['a', 'b', 'fx-workspace']);
    const pick = fx(['repo', 'pick', 'fx-workspace', '--format', 'json'], s.env, s.ws);
    expect(pick.status).toBe(6);

    s.manifest.commit(
      { 'manifest/workspace.yaml': workspaceYaml(s.host, ['a', 'b', 'c']) },
      'add c',
    );

    const dry = fx(['sync', '--dry-run', '--format', 'json'], s.env, s.ws);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stderr).toContain('MANIFEST_REFRESH_PLANNED');
    expect(names(dry)).toEqual(['a', 'b', 'fx-workspace']);

    const kept = fx(['sync', '--no-refresh-manifest', '--format', 'json'], s.env, s.ws);
    expect(kept.status, kept.stderr).toBe(0);
    expect(kept.stderr).not.toContain('MANIFEST_REFRESHED');
    expect(names(kept)).toEqual(['a', 'b', 'fx-workspace']);

    const refreshed = fx(['sync', '--format', 'json'], s.env, s.ws);
    expect(refreshed.status, refreshed.stderr).toBe(0);
    expect(refreshed.stderr).toContain('MANIFEST_REFRESHED');
    expect(names(refreshed)).toEqual(['a', 'b', 'c', 'fx-workspace']);
    expect(existsSync(path.join(s.ws, 'c', 'README'))).toBe(true);
    expect(readFileSync(path.join(s.ws, 'AGENTS.md'), 'utf8')).toContain('| `c` |');

    // A Skill written through the root link lands in the checkout; work on a
    // branch there keeps sync from touching the tree until the person is done.
    mkdirSync(path.join(s.ws, '.claude', 'skills', 'triage'));
    writeFileSync(
      path.join(s.ws, '.claude', 'skills', 'triage', 'SKILL.md'),
      '---\nname: triage\ndescription: Triage\n---\n',
    );
    expect(existsSync(path.join(sourceDir, 'skills', 'triage', 'SKILL.md'))).toBe(true);
    const lint = fx(['manifest', 'lint', '--format', 'json'], s.env, sourceDir);
    expect(lint.status, lint.stderr).toBe(0);
    expect(
      (lint.json() as Items<{ code: string }>).items.filter((i) => i.code.startsWith('SKILL')),
    ).toEqual([]);
    git(['checkout', '-q', '-b', 'skill-triage'], sourceDir);
    git(['add', '.'], sourceDir);
    git(['commit', '-q', '-m', 'feat: triage'], sourceDir);
    s.manifest.commit(
      { 'skills/review/SKILL.md': '---\nname: review\ndescription: Review changes\n---\n' },
      'reword',
    );
    const busy = fx(['sync', '--format', 'json'], s.env, s.ws);
    expect(busy.status, busy.stderr).toBe(0);
    expect(busy.stderr).toContain('MANIFEST_REFRESH_KEPT');
    expect(busy.stderr).toContain('on skill-triage, not main');
    expect(readFileSync(path.join(sourceDir, 'skills', 'review', 'SKILL.md'), 'utf8')).toContain(
      'description: Review\n',
    );
    git(['checkout', '-q', 'main'], sourceDir);
    expect(readFileSync(path.join(sourceDir, 'skills', 'review', 'SKILL.md'), 'utf8')).toContain(
      'Review changes',
    );
    const back = fx(['sync', '--format', 'json'], s.env, s.ws);
    expect(back.status, back.stderr).toBe(0);
    expect(back.stderr).not.toContain('MANIFEST_REFRESH_KEPT');

    const other = repository(path.dirname(s.ws), 'other', {
      'manifest/workspace.yaml': workspaceYaml(s.host, ['a']),
    });
    const swapped = fx(['init', s.ws, '--from', other.bare, '--format', 'json'], s.env);
    expect(swapped.status).toBe(11);
    expect(swapped.error().code).toBe('SOURCE_MISMATCH');
    const again = fx(['init', s.ws, '--from', s.manifest.bare, '--format', 'json'], s.env);
    expect(again.status, again.stderr).toBe(0);
    expect(again.json()).toMatchObject({ manifest: 'refreshed', registered: false });

    const ws2 = path.join(path.dirname(s.ws), 'ws2');
    mkdirSync(ws2);
    git(['init', '-q', ws2], ws2);
    writeFileSync(path.join(ws2, 'notes.txt'), 'x');
    const adopt = fx(
      ['init', ws2, '--from', s.manifest.bare, '--adopt', '--dry-run', '--format', 'json'],
      s.env,
    );
    expect(adopt.status, adopt.stderr).toBe(0);
    expect(adopt.json()).toMatchObject({ adopted: true, written: false });
    expect(adopt.stderr).toContain('ROOT_IS_GIT');
  });
});
