import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { shellLine } from '../../src/domain/shell.js';
import { FileLock } from '../../src/infra/lock.js';

import { freshHome, fx, git, manifestDirOf, repository } from './harness.js';

function setup() {
  const home = realpathSync(freshHome());
  const base = realpathSync(freshHome());
  const root = path.join(base, 'workspace with spaces');
  mkdirSync(root);
  const source = path.join(base, 'source');
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    readFileSync(path.resolve('test/fixtures/manifest/v1-minimal/workspace.yaml'), 'utf8'),
  );
  const env = { FX_HOME: home };
  cpSync(source, manifestDirOf(home, 'alpha'), { recursive: true });
  writeFileSync(
    path.join(home, 'config.yaml'),
    stringify({
      default_workspace: 'alpha',
      agents: [],
      hooks: false,
      workspaces: { alpha: { root, source } },
    }),
  );
  const init = fx(
    ['sync', '--workspace', 'alpha', '--only', 'docs', '--format', 'json'],
    env,
    base,
  );
  expect(init.status, init.stderr).toBe(0);
  return {
    home,
    base,
    root,
    source,
    env,
    run: (args: string[]) => fx([...args, '--format', 'json'], env, base),
  };
}

describe('workspace discovery and lifecycle', () => {
  it('discovers degraded registrations and returns global self facts with selected identity', () => {
    const s = setup();
    expect(s.run(['workspace', 'list']).json()).toMatchObject({
      items: [{ name: 'alpha', registration_status: 'available', selection: 'default' }],
    });
    rmSync(path.join(manifestDirOf(s.home, 'alpha'), 'manifest/workspace.yaml'));
    expect(s.run(['workspace', 'show', 'alpha']).json()).toMatchObject({
      registration_status: 'missing',
      source: s.source,
    });
    expect(s.run(['self', 'info']).json()).toMatchObject({
      version: expect.any(String),
      workspace: { name: 'alpha', registration_status: 'missing' },
    });
    const failure = s.run(['status', '--workspace', 'alpha']);
    expect(failure.error()).toMatchObject({
      code: 'MANIFEST_MISSING',
      next_steps: expect.arrayContaining([
        shellLine(['fx', 'init', s.root, '--name', 'alpha', '--from', s.source]),
      ]),
    });
    rmSync(manifestDirOf(s.home, 'alpha'), { recursive: true });
    expect(s.run(['workspace', 'show', 'alpha']).json()).toMatchObject({
      registration_status: 'unprepared',
    });
    rmSync(s.root, { recursive: true });
    expect(s.run(['workspace', 'show', 'alpha']).json()).toMatchObject({
      registration_status: 'root_missing',
    });
    expect(s.run(['status', '--workspace', 'alpha']).error()).toMatchObject({
      code: 'WORKSPACE_ROOT_MISSING',
    });
  });

  it('relocates a moved directory without changing its identity or local choices', () => {
    const s = setup();
    const local = path.join(s.home, 'workspaces/alpha/local.yaml');
    writeFileSync(local, 'scope:\n  repos: []\n');
    writeFileSync(path.join(s.root, 'personal.txt'), 'keep');
    const moved = path.join(s.base, 'moved');
    renameSync(s.root, moved);
    expect(s.run(['workspace', 'relocate', 'alpha', moved, '--dry-run']).json()).toMatchObject({
      written: false,
      after: { root: moved },
    });
    expect(s.run(['workspace', 'show', 'alpha']).json()).toMatchObject({ root: s.root });
    expect(s.run(['workspace', 'relocate', 'alpha', moved]).json()).toMatchObject({
      written: true,
      after: { root: moved },
    });
    expect(readFileSync(local, 'utf8')).toBe('scope:\n  repos: []\n');
    expect(readFileSync(path.join(moved, 'personal.txt'), 'utf8')).toBe('keep');
    expect(existsSync(path.join(moved, 'AGENTS.md'))).toBe(false);
    expect(s.run(['sync', '--workspace', 'alpha', '--only', 'docs']).status).toBe(0);
    expect(existsSync(path.join(moved, 'AGENTS.md'))).toBe(true);
    expect(s.run(['workspace', 'relocate', 'alpha', moved]).json()).toMatchObject({
      written: false,
    });
    expect(existsSync(path.join(moved, 'AGENTS.md'))).toBe(true);
  });

  it('stages rebind and retains the old source and local scope', () => {
    const s = setup();
    const oldSource = manifestDirOf(s.home, 'alpha');
    writeFileSync(path.join(oldSource, 'uncommitted.txt'), 'source edits');
    const next = path.join(s.base, 'next-source');
    mkdirSync(path.join(next, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(next, 'manifest/workspace.yaml'),
      readFileSync(path.resolve('test/fixtures/manifest/v1-minimal/workspace.yaml'), 'utf8'),
    );
    const preview = s.run(['workspace', 'rebind', 'alpha', '--from', next, '--dry-run']);
    expect(preview.json()).toMatchObject({ written: false, source_validation: 'validated' });
    expect(readFileSync(path.join(oldSource, 'uncommitted.txt'), 'utf8')).toBe('source edits');
    const rebound = s.run(['workspace', 'rebind', 'alpha', '--from', next]);
    expect(rebound.status, rebound.stderr).toBe(0);
    const out = rebound.json() as { backup: string };
    expect(readFileSync(path.join(out.backup, 'uncommitted.txt'), 'utf8')).toBe('source edits');
    expect(s.run(['workspace', 'show', 'alpha']).json()).toMatchObject({ source: next });
    expect(s.run(['workspace', 'list']).json()).toMatchObject({ items: [{ name: 'alpha' }] });
  });

  it('unregisters owned project files while preserving foreign files and business work', () => {
    const s = setup();
    const managed = path.join(s.root, 'AGENTS.md');
    expect(existsSync(managed)).toBe(true);
    writeFileSync(path.join(s.root, 'CLAUDE.md'), 'personal instructions');
    writeFileSync(path.join(s.root, 'personal.txt'), 'business edits');
    const readOnly = fx(
      ['workspace', 'unregister', 'alpha', '--format', 'json'],
      { ...s.env, FX_READ_ONLY: '1' },
      s.base,
    );
    expect(readOnly.error()).toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(existsSync(managed)).toBe(true);
    expect(s.run(['workspace', 'unregister', 'alpha', '--dry-run']).json()).toMatchObject({
      written: false,
    });
    const removed = s.run(['workspace', 'unregister', 'alpha']);
    expect(removed.status, removed.stderr).toBe(0);
    const out = removed.json() as { backup: string };
    expect(existsSync(path.join(out.backup, 'source/manifest/workspace.yaml'))).toBe(true);
    expect(existsSync(managed)).toBe(false);
    expect(readFileSync(path.join(s.root, 'CLAUDE.md'), 'utf8')).toBe('personal instructions');
    expect(readFileSync(path.join(s.root, 'personal.txt'), 'utf8')).toBe('business edits');
    expect(s.run(['workspace', 'list']).json()).toMatchObject({
      items: [],
      default_workspace: null,
    });
  });

  it('keeps discovery available with a bad default and legacy duplicate physical roots', () => {
    const s = setup();
    writeFileSync(
      path.join(s.home, 'config.yaml'),
      stringify({
        default_workspace: 'typo',
        workspaces: { alpha: { root: s.root, source: s.source } },
      }),
    );
    expect(s.run(['workspace', 'list']).json()).toMatchObject({
      items: [{ name: 'alpha' }],
      selection_error: { code: 'WORKSPACE_DEFAULT_INVALID' },
    });
    expect(s.run(['self', 'info']).json()).toMatchObject({
      version: expect.any(String),
      workspace_error: { code: 'WORKSPACE_DEFAULT_INVALID' },
    });
    expect(s.run(['config', 'set', 'default_workspace', 'missing']).error()).toMatchObject({
      code: 'WORKSPACE_DEFAULT_INVALID',
    });
    const alias = path.join(s.base, 'alias');
    symlinkSync(s.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(
      path.join(s.home, 'config.yaml'),
      stringify({
        workspaces: {
          alpha: { root: s.root, source: s.source },
          beta: { root: alias, source: s.source },
        },
      }),
    );
    const listed = fx(['workspace', 'list', '--format', 'json'], s.env, s.root);
    expect(listed.json()).toMatchObject({
      items: [{ name: 'alpha' }, { name: 'beta' }],
      selection_error: { code: 'WORKSPACE_ROOT_AMBIGUOUS' },
    });
    expect(s.run(['workspace', 'show', 'alpha']).status).toBe(0);
  });
});

describe('workspace resource ownership', () => {
  it('retires old hook owner IDs after a physical move and re-enables them only at the new root', () => {
    const s = setup();
    const env = { ...s.env, FX_AGENTS: 'codex', FX_HOOKS: '1' };
    const enabled = fx(['hook', 'enable', '--workspace', 'alpha'], env, s.base);
    expect(enabled.status, enabled.stderr).toBe(0);
    const moved = path.join(s.base, 'moved-hooks');
    renameSync(s.root, moved);
    const relocated = fx(['workspace', 'relocate', 'alpha', moved], env, s.base);
    expect(relocated.status, relocated.stderr).toBe(0);
    expect(existsSync(path.join(moved, '.codex/hooks.json'))).toBe(false);
    expect(fx(['sync', '--only', 'hooks', '--workspace', 'alpha'], env, s.base).status).toBe(0);
    // A Windows hook carries its command as an encoded PowerShell script.
    const hook = readFileSync(path.join(moved, '.codex/hooks.json'), 'utf8').replace(
      /-EncodedCommand ([A-Za-z0-9+/]+=*)/g,
      (_, script: string) => Buffer.from(script, 'base64').toString('utf16le'),
    );
    expect(hook).toContain(moved);
    expect(hook).not.toContain(s.root);
  });

  it('removes only owned MCP entries and keeps legacy shared ownership alive', () => {
    const s = setup();
    const source = manifestDirOf(s.home, 'alpha');
    writeFileSync(
      path.join(source, 'manifest/harness.yaml'),
      stringify({
        schema_version: 2,
        mcp: [{ name: 'knowledge', transport: 'stdio', command: ['fixture-server'] }],
      }),
    );
    const env = { ...s.env, FX_AGENTS: 'claude-code' };
    const sync = fx(['sync', '--only', 'mcp', '--workspace', 'alpha', '--yes'], env, s.base);
    expect(sync.status, sync.stderr).toBe(0);
    const file = path.join(s.root, '.mcp.json');
    const contents = JSON.parse(readFileSync(file, 'utf8'));
    contents.mcpServers.personal = { command: 'personal-server' };
    writeFileSync(file, JSON.stringify(contents));
    const beta = manifestDirOf(s.home, 'beta');
    cpSync(path.dirname(source), path.dirname(beta), { recursive: true });
    writeFileSync(
      path.join(source, 'manifest/harness.yaml'),
      stringify({
        schema_version: 2,
        mcp: [
          { name: 'knowledge', transport: 'stdio', command: ['fixture-server'] },
          { name: 'exclusive', transport: 'stdio', command: ['fixture-exclusive-server'] },
        ],
      }),
    );
    const additional = fx(['sync', '--only', 'mcp', '--workspace', 'alpha', '--yes'], env, s.base);
    expect(additional.status, additional.stderr).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers).toHaveProperty('fx-exclusive');
    writeFileSync(
      path.join(s.home, 'config.yaml'),
      stringify({
        workspaces: {
          alpha: { root: s.root, source: s.source },
          beta: { root: s.root, source: s.source },
        },
      }),
    );
    const first = s.run(['workspace', 'unregister', 'alpha']);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers).toHaveProperty('fx-knowledge');
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers).toHaveProperty('personal');
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers).not.toHaveProperty('fx-exclusive');
    expect(existsSync(source)).toBe(true);
    expect(s.run(['workspace', 'show', 'beta']).json()).toMatchObject({
      registration_status: 'available',
    });
    const second = s.run(['workspace', 'unregister', 'beta']);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers).toEqual({
      personal: { command: 'personal-server' },
    });
  });
});

describe('workspace public mutation serialization', () => {
  it('blocks init, local selection and lifecycle mutation on the same identity lease without partial writes', async () => {
    const s = setup();
    const lease = await new FileLock(s.home).acquire({
      key: 'workspace-operation:alpha',
      waitMs: 0,
    });
    expect(lease).not.toBeNull();
    const local = path.join(s.home, 'workspaces/alpha/local.yaml');
    const before = existsSync(local) ? readFileSync(local, 'utf8') : null;
    try {
      for (const args of [
        ['repo', 'unpick', 'fx-example-api', '--workspace', 'alpha'],
        ['workspace', 'unregister', 'alpha'],
        ['init', s.root, '--name', 'alpha', '--from', s.source],
      ])
        expect(s.run(args).error()).toMatchObject({ code: 'LOCK_BUSY' });
      expect(existsSync(local) ? readFileSync(local, 'utf8') : null).toBe(before);
      expect(s.run(['workspace', 'show', 'alpha']).json()).toMatchObject({
        registration_status: 'available',
      });
      expect(
        s.run(['repo', 'unpick', 'fx-example-api', '--workspace', 'alpha', '--dry-run']).status,
      ).toBe(0);
    } finally {
      await lease?.release();
    }
    expect(s.run(['repo', 'unpick', 'fx-example-api', '--workspace', 'alpha']).status).toBe(0);
  });
});

describe('workspace cleanup and read-only requests', () => {
  it('refuses cleanup through symlinked agent directories without touching the outside link or registration', () => {
    const s = setup();
    const outside = path.join(s.base, 'outside');
    const skills = path.join(manifestDirOf(s.home, 'alpha'), 'skills');
    mkdirSync(outside);
    mkdirSync(skills);
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(skills, path.join(outside, 'skills'), kind);
    symlinkSync(outside, path.join(s.root, '.agents'), kind);
    const preview = s.run(['workspace', 'unregister', 'alpha', '--dry-run']);
    expect(preview.error()).toMatchObject({ code: 'WORKSPACE_CLEANUP_BLOCKED' });
    const applied = s.run(['workspace', 'unregister', 'alpha']);
    expect(applied.error()).toMatchObject({ code: 'WORKSPACE_CLEANUP_BLOCKED' });
    expect(existsSync(path.join(outside, 'skills'))).toBe(true);
    expect(existsSync(skills)).toBe(true);
    expect(existsSync(path.join(s.root, 'AGENTS.md'))).toBe(true);
    expect(s.run(['workspace', 'show', 'alpha']).json()).toMatchObject({
      registration_status: 'available',
    });
  });

  it('creates no state or lock directories for read-only initialization and lifecycle requests', () => {
    const base = realpathSync(freshHome());
    const home = path.join(base, 'uncreated-state');
    const root = path.join(base, 'uncreated-workspace');
    const source = path.resolve('test/fixtures/manifest/v1-minimal');
    const env = { FX_HOME: home, FX_READ_ONLY: '1' };
    const init = fx(
      ['init', root, '--name', 'readonly', '--from', source, '--format', 'json'],
      env,
      base,
    );
    expect(init.error()).toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(existsSync(home)).toBe(false);
    expect(existsSync(root)).toBe(false);
    const preview = fx(
      ['init', root, '--name', 'readonly', '--from', source, '--format', 'json', '--dry-run'],
      env,
      base,
    );
    expect(preview.status, preview.stderr).toBe(0);
    expect(existsSync(home)).toBe(false);
    const s = setup();
    rmSync(path.join(s.home, 'locks'), { recursive: true, force: true });
    const readonly = { ...s.env, FX_READ_ONLY: '1' };
    expect(
      fx(['workspace', 'unregister', 'alpha', '--format', 'json'], readonly, s.base).error(),
    ).toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(existsSync(path.join(s.home, 'locks'))).toBe(false);
    expect(
      fx(['workspace', 'relocate', 'alpha', s.root, '--format', 'json'], readonly, s.base).json(),
    ).toMatchObject({ written: false });
    expect(existsSync(path.join(s.home, 'locks'))).toBe(false);
  });
});

describe('conditional writer serialization', () => {
  it('never fetches checkout refs when the identity lease is held, while ordinary status and previews remain available', async () => {
    const s = setup();
    const upstream = repository(s.base, 'fetch-target', { 'README.md': 'first' });
    const checkout = path.join(s.root, 'api');
    git(['clone', '--quiet', upstream.bare, checkout], s.root);
    git(['remote', 'add', 'upstream', upstream.bare], checkout);
    git(['fetch', '--quiet', 'upstream'], checkout);
    writeFileSync(
      path.join(manifestDirOf(s.home, 'alpha'), 'manifest/workspace.yaml'),
      stringify({
        schema_version: 2,
        providers: { 'code-host': { provider: 'local-git', vars: { host: s.base } } },
        defaults: { branch: 'main' },
        repos: [{ name: 'api', path: 'api', upstream: upstream.bare }],
      }),
    );
    const before = git(['rev-parse', 'refs/remotes/upstream/main'], checkout);
    upstream.commit({ 'README.md': 'second' }, 'advance upstream');
    const expected = git(['rev-parse', 'HEAD'], upstream.author);
    expect(before).not.toBe(expected);
    const lease = await new FileLock(s.home).acquire({
      key: 'workspace-operation:alpha',
      waitMs: 0,
    });
    expect(lease).not.toBeNull();
    try {
      expect(s.run(['status', '--fetch', '--workspace', 'alpha']).error()).toMatchObject({
        code: 'LOCK_BUSY',
      });
      expect(git(['rev-parse', 'refs/remotes/upstream/main'], checkout)).toBe(before);
      expect(s.run(['status', '--workspace', 'alpha']).status).toBe(0);
      expect(s.run(['status', '--fetch', '--dry-run', '--workspace', 'alpha']).status).toBe(0);
      expect(git(['rev-parse', 'refs/remotes/upstream/main'], checkout)).toBe(before);
      expect(
        s
          .run([
            'where',
            'api',
            '--env',
            'test',
            '--platform',
            'jenkins',
            '--probe',
            '--record',
            '--workspace',
            'alpha',
          ])
          .error(),
      ).toMatchObject({ code: 'LOCK_BUSY' });
    } finally {
      await lease?.release();
    }
    const fetched = s.run(['status', '--fetch', '--workspace', 'alpha']);
    expect(fetched.status, fetched.stderr).toBe(0);
    expect(git(['rev-parse', 'refs/remotes/upstream/main'], checkout)).toBe(expected);
  });
});
