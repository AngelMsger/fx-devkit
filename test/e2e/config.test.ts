import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { shellLine } from '../../src/domain/shell.js';

import { freshHome, fx, packageName } from './harness.js';

// stderr carries one JSON record per notice.
function notices(stderr: string): { code: string; nextSteps?: string[] }[] {
  return stderr
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map(
      (line) => (JSON.parse(line) as { _notice: { code: string; nextSteps?: string[] } })._notice,
    )
    .filter((notice) => notice !== undefined);
}

describe('fx config', () => {
  it.each([
    ['--command-shell', 'cmd', 'config', 'get', 'command_shell'],
    ['config', '--command-shell=cmd', 'get', 'command_shell'],
    ['config', 'get', 'command_shell', '--command-shell', 'cmd'],
  ])('reports the same explicit shell override in every argument position: %j', (...args) => {
    const run = fx([...args, '--format', 'json', '--explain'], { FX_COMMAND_SHELL: 'powershell' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.json()).toMatchObject({ key: 'command_shell', value: 'cmd', source: 'flag' });
    const list = fx(['config', 'list', '--command-shell', 'cmd', '--format', 'json']);
    expect((list.json() as { items: object[] }).items).toContainEqual(
      expect.objectContaining({ key: 'command_shell', value: 'cmd', source: 'flag' }),
    );
  });

  it('distinguishes environment values from flags supplied by the parser', () => {
    const run = fx(['config', 'get', 'command_shell', '--format', 'json'], {
      FX_COMMAND_SHELL: 'powershell',
    });
    expect(run.json()).toMatchObject({ value: 'powershell', source: 'env' });
  });

  it('represents absent explanation values explicitly rather than omitting fields', () => {
    const result = fx(['config', 'get', 'user', '--explain', '--format', 'json'], {
      FX_USER: undefined,
    });
    expect(result.json()).toMatchObject({
      value: null,
      layers: [
        { source: 'env', value: null },
        { source: 'file', value: null },
        { source: 'default', value: null },
      ],
    });
  });

  it('lists every key with its current value and source', () => {
    const run = fx(['config', 'list', '--format', 'json']);
    expect(run.status).toBe(0);
    const { items } = run.json() as { items: { key: string; source: string }[] };
    expect(items.map((i) => i.key)).toEqual([
      'command_shell',
      'hooks',
      'default_workspace',
      'user',
      'format',
      'agents',
      'read_only',
      'update_check',
    ]);
    // The harness fixes command presentation and disables update checks through the environment.
    const sources = items.map((i) => [i.key, i.source]);
    expect(sources.filter(([, s]) => s !== 'default')).toEqual([
      ['command_shell', 'env'],
      ['format', 'flag'],
      ['update_check', 'env'],
    ]);
  });

  it('sets, explains and unsets a key in one home', () => {
    const env = { FX_HOME: freshHome() };
    expect(fx(['config', 'set', 'user', 'alice'], env).status).toBe(0);
    const explained = fx(
      ['config', 'get', 'user', '--explain', '--format', 'json'],
      env,
    ).json() as {
      value: string;
      source: string;
      layers: { source: string }[];
    };
    expect(explained).toMatchObject({ value: 'alice', source: 'file' });
    expect(explained.layers.map((l) => l.source)).toEqual(['env', 'file', 'default']);
    expect(fx(['config', 'unset', 'user'], env).status).toBe(0);
    expect(fx(['config', 'get', 'user', '--format', 'json'], env).json()).toMatchObject({
      value: null,
      source: 'default',
    });
  });

  it('shows the --format flag as the flag layer of the format key', () => {
    const env = { FX_HOME: freshHome() };
    fx(['config', 'set', 'format', 'ndjson'], env);
    const explained = fx(
      ['config', 'get', 'format', '--explain', '--format', 'json'],
      env,
    ).json() as {
      source: string;
      layers: { source: string; value: string | null }[];
    };
    expect(explained.source).toBe('flag');
    expect(explained.layers.find((l) => l.source === 'file')?.value).toBe('ndjson');
  });

  it('applies the stored format to later commands', () => {
    const env = { FX_HOME: freshHome() };
    const stored = fx(['config', 'set', 'format', 'json'], env);
    expect(stored.status, stored.stderr).toBe(0);
    const run = fx(['self', 'info'], env);
    expect(run.status, run.stderr).toBe(0);
    const payload = run.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ name: packageName, version: expect.any(String) });
    expect(payload).not.toHaveProperty('error');
  });

  it('reports an invalid stored format as a configuration error', () => {
    const home = freshHome();
    writeFileSync(path.join(home, 'config.yaml'), 'format: bogus\n');
    const run = fx(['self', 'info'], { FX_HOME: home });
    expect(run.status).toBe(3);
    expect(run.error()).toMatchObject({ category: 'config', code: 'CONFIG_INVALID' });
  });

  it('blocks a write under FX_READ_ONLY but still previews it', () => {
    const blocked = fx(['config', 'set', 'format', 'json'], { FX_READ_ONLY: '1' });
    expect(blocked.status).toBe(5);
    expect(blocked.error()).toMatchObject({ category: 'permission', code: 'READONLY_BLOCKED' });

    const preview = fx(['config', 'set', 'format', 'json', '--dry-run', '--format', 'json'], {
      FX_READ_ONLY: '1',
    });
    expect(preview.status).toBe(0);
    expect(preview.json()).toMatchObject({ after: 'json', written: false });
  });

  it('gates config export files and previews their path without creating them', () => {
    const home = freshHome();
    const out = path.join(home, 'profile.yaml');
    const locked = { FX_HOME: home, FX_READ_ONLY: '1' };
    const blocked = fx(['config', 'export', '-o', out], locked);
    expect(blocked.status).toBe(5);
    expect(blocked.error().code).toBe('READONLY_BLOCKED');
    expect(existsSync(out)).toBe(false);

    const preview = fx(['config', 'export', '-o', out, '--dry-run', '--format', 'json'], locked);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json()).toMatchObject({ path: out, written: false });
    expect(existsSync(out)).toBe(false);
  });

  it('carries a profile to another home, previews it first, and reports a missing file', () => {
    const source = freshHome();
    const target = freshHome();
    const out = path.join(source, 'profile.yaml');
    expect(fx(['config', 'set', 'user', 'alice'], { FX_HOME: source }).status).toBe(0);
    expect(fx(['config', 'export', '-o', out], { FX_HOME: source }).status).toBe(0);

    const missing = fx(['config', 'import', path.join(source, 'absent.yaml'), '--format', 'json'], {
      FX_HOME: target,
    });
    expect(missing.status).toBe(6);
    expect(missing.error()).toMatchObject({
      category: 'not_found',
      code: 'CONFIG_IMPORT_NOT_FOUND',
      next_steps: ['fx config export -o profile.yaml'],
    });

    const preview = fx(['config', 'import', out, '--dry-run', '--format', 'json'], {
      FX_HOME: target,
    });
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json()).toMatchObject({ config: 'changed', written: false });
    expect(
      fx(['config', 'get', 'user', '--format', 'json'], { FX_HOME: target }).json(),
    ).toMatchObject({ value: null, source: 'default' });

    const applied = fx(['config', 'import', out, '--format', 'json'], { FX_HOME: target });
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.json()).toMatchObject({ config: 'changed', written: true });
    expect(
      fx(['config', 'get', 'user', '--format', 'json'], { FX_HOME: target }).json(),
    ).toMatchObject({ value: 'alice', source: 'file' });
  });

  it('notices the preparation a profile with an unprepared workspace still needs', () => {
    const home = freshHome();
    const root = path.join(home, 'ws');
    const profile = path.join(home, 'profile.yaml');
    writeFileSync(
      profile,
      [
        'fx_profile: 1',
        'config:',
        '  workspaces:',
        '    team:',
        `      root: ${root}`,
        '      source: https://git.example.com/team/manifest.git',
        'workspaces: {}',
        '',
      ].join('\n'),
    );
    // A registration is pinned to the root's real path, whatever the profile spells.
    const pinned = path.join(realpathSync(home), 'ws');
    const step = shellLine([
      'fx',
      'init',
      pinned,
      '--name',
      'team',
      '--from',
      'https://git.example.com/team/manifest.git',
    ]);

    const preview = fx(['config', 'import', profile, '--dry-run', '--format', 'json'], {
      FX_HOME: home,
    });
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json()).toMatchObject({
      registrations: [{ name: 'team', action: 'created', preparation: 'manifest_missing' }],
      next_steps: [step],
      written: false,
    });
    expect(notices(preview.stderr)).toContainEqual(
      expect.objectContaining({ code: 'CONFIG_IMPORT_PLANNED', nextSteps: [step] }),
    );

    const applied = fx(['config', 'import', profile, '--format', 'json'], { FX_HOME: home });
    expect(applied.status, applied.stderr).toBe(0);
    expect(notices(applied.stderr)).toContainEqual(
      expect.objectContaining({ code: 'CONFIG_IMPORTED', nextSteps: [step] }),
    );
  });

  it('names the config path in self info', () => {
    const home = freshHome();
    expect(fx(['self', 'info', '--format', 'json'], { FX_HOME: home }).json()).toMatchObject({
      config: path.join(home, 'config.yaml'),
    });
  });
});
