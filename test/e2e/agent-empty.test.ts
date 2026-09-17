import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshHome, fx } from './harness.js';

describe('explicit empty agent selection through the CLI', () => {
  it('checks the declared Skill version on init without requiring global installation', () => {
    const base = freshHome();
    const env = {
      FX_HOME: freshHome(),
      FX_AGENTS: '',
      FX_SKILL_LOADED: '1',
      FX_SKILL_VERSION: undefined,
    };
    const info = fx(['self', 'info', '--format', 'json'], env).json() as {
      bundled_skill_version: string;
    };
    const source = path.join(base, 'source');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(source, 'manifest/workspace.yaml'),
      'schema_version: 2\nrepos: [{name: sample}]\n',
    );
    const args = [
      'init',
      path.join(base, 'workspace'),
      '--from',
      source,
      '--dry-run',
      '--format',
      'json',
    ];
    const unverified = fx(args, env);
    expect(unverified.status).toBe(0);
    expect(unverified.stderr).toContain('SKILL_VERSION_UNVERIFIED');
    expect(fx(args, { ...env, FX_SKILL_VERSION: '0.0.0' }).stderr).toContain(
      'SKILL_VERSION_MISMATCH',
    );
    expect(fx(args, { ...env, FX_SKILL_VERSION: info.bundled_skill_version }).stderr).not.toContain(
      'SKILL_',
    );
    expect(fx([...args, '--quiet'], env).stderr).toBe('');
    const status = fx(['skill', 'status', '--dir', path.join(base, 'skills'), '--format', 'json'], {
      ...env,
      FX_SKILL_VERSION: info.bundled_skill_version,
    });
    expect(status.json()).toMatchObject({
      loaded: true,
      version_verified: true,
      loaded_version: info.bundled_skill_version,
    });
    expect(existsSync(path.join(base, 'skills'))).toBe(false);
    expect(existsSync(path.join(base, 'workspace'))).toBe(false);
  });
  it('preserves the file value and empty env override; unset restores automatic detection', () => {
    const home = freshHome();
    const env = { FX_HOME: home, FX_AGENTS: undefined };
    writeFileSync(path.join(home, 'config.yaml'), 'agents: []\n');
    const query = () =>
      fx(['agent', 'list', '--format', 'json'], env).json() as {
        items: { selected: boolean; selection: string }[];
      };
    expect(query().items.every((i) => !i.selected && i.selection === 'explicit')).toBe(true);
    writeFileSync(path.join(home, 'config.yaml'), 'agents: [codex]\n');
    const emptyEnv = fx(['agent', 'list', '--format', 'json'], {
      ...env,
      FX_AGENTS: '',
    }).json() as { items: { selected: boolean }[] };
    expect(emptyEnv.items.every((i) => !i.selected)).toBe(true);
    expect(fx(['config', 'unset', 'agents'], env).status).toBe(0);
    expect(query().items.every((i) => i.selection === 'automatic')).toBe(true);
  });

  it('initializes without projecting any agent resources and exposes explicit preparation status', () => {
    const base = freshHome();
    const source = path.join(base, 'source');
    const root = path.join(base, 'workspace');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(source, 'manifest/workspace.yaml'),
      'schema_version: 2\ndefaults: {branch: main}\nrepos: [{name: sample, upstream: /tmp/example/sample.git}]\n',
    );
    const env = { FX_HOME: freshHome(), FX_AGENTS: '' };
    mkdirSync(path.join(env.FX_HOME, 'workspaces/empty'), { recursive: true });
    writeFileSync(path.join(env.FX_HOME, 'workspaces/empty/local.yaml'), 'scope: {repos: []}\n');
    const init = fx(
      ['init', root, '--from', source, '--name', 'empty', '--no-input', '--format', 'json'],
      env,
    );
    expect(init.status, init.stderr).toBe(0);
    expect(init.json()).toMatchObject({
      output_mode: 'summary',
      operation: 'apply',
      registered: true,
      written: true,
      preparation_complete: expect.any(Boolean),
    });
    for (const agent of ['.agents', '.codex', '.claude', '.grok'])
      expect(existsSync(path.join(root, agent))).toBe(false);
    const docs = fx(
      ['sync', '--only', 'docs', '--no-refresh-manifest', '--format', 'json'],
      env,
      root,
    );
    expect(docs.status, docs.stderr).toBe(0);
    expect(docs.json()).toMatchObject({
      operation: 'apply',
      preparation_complete: true,
      output_mode: 'summary',
    });
    const preview = fx(['sync', '--only', 'docs', '--dry-run', '--format', 'json'], env, root);
    expect(preview.json()).toMatchObject({ operation: 'preview', preparation_complete: null });
  });
});
