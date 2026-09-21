import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { freshHome, fx } from './harness.js';

function setup() {
  const home = freshHome();
  const root = realpathSync(freshHome());
  writeFileSync(
    path.join(home, 'config.yaml'),
    `agents: [claude-code, codex, grok, pi]\nworkspaces:\n  test: { root: ${root} }\n`,
  );
  return { home, root, env: { FX_HOME: home } };
}

describe('workspace hooks', () => {
  it('reports corrupted optional hook metadata alongside required preparation blockers', () => {
    const s = setup();
    const source = path.join(s.home, 'workspaces/test/source/manifest');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, 'workspace.yaml'),
      'schema_version: 2\ndefaults: { upstream_project: team, branch: main }\nrepos: [{name: example, project: team, upstream: https://git.example.com/team/example.git}]\n',
    );
    writeFileSync(path.join(s.home, 'workspaces/test/hooks.json'), '{');
    const result = fx(['doctor', '--format', 'json'], { ...s.env, PATH: '' }, s.root);
    expect(result.status).toBe(12);
    expect(result.json()).toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ group: 'hooks', id: 'metadata', level: 'warn' }),
      ]),
    });
  });
  it('removes an unpicked agent from every registered workspace', () => {
    const s = setup();
    const other = realpathSync(freshHome());
    writeFileSync(
      path.join(s.home, 'config.yaml'),
      `agents: [codex]\nworkspaces:\n  test: { root: ${s.root} }\n  other: { root: ${other} }\n`,
    );
    expect(fx(['hook', 'inject'], s.env, s.root).status).toBe(0);
    expect(fx(['hook', 'inject'], s.env, other).status).toBe(0);
    expect(fx(['agent', 'unpick', 'codex'], s.env, s.root).status).toBe(0);
    expect(existsSync(path.join(s.root, '.codex/hooks.json'))).toBe(false);
    expect(existsSync(path.join(other, '.codex/hooks.json'))).toBe(false);
  });
  it('registers the hook sync stage without running repository operations', () => {
    const s = setup();
    const source = path.join(s.home, 'workspaces/test/source/manifest');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, 'workspace.yaml'),
      'schema_version: 2\ndefaults: { upstream_project: team, branch: main }\nrepos: [{name: example, project: team, upstream: https://git.example.com/team/example.git}]\n',
    );
    const result = fx(
      ['sync', '--only', 'hooks', '--no-refresh-manifest', '--format', 'json'],
      s.env,
      s.root,
    );
    expect(result.status).toBe(0);
    expect(result.json()).toMatchObject({ items: [], stages: { hooks: { create: 4 } } });
    expect(existsSync(path.join(s.root, 'example'))).toBe(false);
  });
  it('returns before background work and derives only workspace documents and Skills', async () => {
    const s = setup();
    const source = path.join(s.home, 'workspaces/test/source');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(source, 'manifest/workspace.yaml'),
      'schema_version: 2\ndefaults: { upstream_project: team, branch: main }\nrepos: [{ name: example, project: team, upstream: https://git.example.com/team/example.git }]\n',
    );
    writeFileSync(path.join(source, 'AGENTS.md'), 'Team guidance.\n');
    const installed = fx(['hook', 'inject', '--format', 'json'], s.env, s.root);
    expect(installed.status).toBe(0);
    expect(installed.json()).toMatchObject({
      workspace: 'test',
      root: s.root,
      items: expect.arrayContaining([
        expect.objectContaining({
          agent: 'codex',
          activation: 'unverified',
          handoff: expect.any(Object),
        }),
      ]),
    });
    const stateFile = path.join(s.home, 'workspaces/test/hooks.json');
    const owner = JSON.parse(readFileSync(stateFile, 'utf8')).receipts.find(
      (r: { agent: string }) => r.agent === 'codex',
    ).owner;
    const args = [
      'hook',
      'dispatch',
      'session-start',
      '--workspace',
      'test',
      '--root',
      s.root,
      '--fx-home',
      s.home,
      '--agent',
      'codex',
      '--owner',
      owner,
    ];
    const started = Date.now();
    const result = fx(args, { ...s.env, PATH: '' }, s.root, JSON.stringify({ cwd: s.root }));
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(result.stderr).toBe('');
    expect(result.json()).toHaveProperty('hookSpecificOutput.additionalContext');
    for (let i = 0; i < 100 && !existsSync(path.join(s.root, 'AGENTS.md')); i++) await delay(50);
    expect(readFileSync(path.join(s.root, 'AGENTS.md'), 'utf8')).toContain('Team guidance.');
    const wrong = fx(args, { ...s.env, PATH: '' }, s.root, JSON.stringify({ cwd: freshHome() }));
    expect(wrong.stdout).toBe('');
  });
  it('records how a background run ended, which no stream of its own could report', () => {
    const s = setup();
    expect(fx(['hook', 'inject'], s.env, s.root).status).toBe(0);
    const stateFile = path.join(s.home, 'workspaces/test/hooks.json');
    const owner = JSON.parse(readFileSync(stateFile, 'utf8')).receipts.find(
      (r: { agent: string }) => r.agent === 'codex',
    ).owner;
    writeFileSync(path.join(s.home, 'config.yaml'), 'agents: [\n');
    const result = fx(
      [
        '__hook-background',
        'session-start',
        '--workspace',
        'test',
        '--root',
        s.root,
        '--fx-home',
        s.home,
        '--agent',
        'codex',
        '--owner',
        owner,
      ],
      { ...s.env, PATH: '' },
      s.root,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).observations).toEqual([
      {
        checkedAt: expect.any(Number),
        phase: 'run',
        code: 'HOOK_WORKER_FAILED',
        command: 'fx sync',
      },
    ]);
  });
  it('previews without writing, injects selected hosts, and keeps removal disabled', () => {
    const s = setup();
    const preview = fx(['hook', 'inject', '--dry-run', '--format', 'json'], s.env, s.root);
    expect(preview.status).toBe(0);
    expect(existsSync(path.join(s.root, '.codex'))).toBe(false);
    const installed = fx(['hook', 'inject', '--format', 'json'], s.env, s.root);
    expect(installed.status).toBe(0);
    expect(existsSync(path.join(s.root, '.pi/extensions/fx.ts'))).toBe(true);
    expect(fx(['hook', 'remove', '--format', 'json'], s.env, s.root).status).toBe(0);
    expect(readFileSync(path.join(s.home, 'workspaces/test/local.yaml'), 'utf8')).toContain(
      'enabled: false',
    );
    expect(fx(['hook', 'list', '--format', 'json'], s.env, s.root).json()).toMatchObject({
      enabled: false,
    });
  });

  it('does not override the read-only posture or a global disable', () => {
    const s = setup();
    expect(fx(['hook', 'inject'], { ...s.env, FX_READ_ONLY: '1' }, s.root).error().code).toBe(
      'READONLY_BLOCKED',
    );
    expect(fx(['hook', 'inject'], { ...s.env, FX_HOOKS: '0' }, s.root).error().code).toBe(
      'HOOKS_DISABLED',
    );
    expect(existsSync(path.join(s.root, '.claude'))).toBe(false);
  });
});
