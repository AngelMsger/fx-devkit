import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshHome, fx, manifestDirOf, tempDir } from './harness.js';

const fixtures = path.resolve('test/fixtures/manifest');

function workspaceFrom(kind: string): string {
  const root = tempDir('fx-ws-');
  cpSync(path.join(fixtures, kind), path.join(root, 'manifest'), { recursive: true });
  mkdirSync(path.join(root, 'fx-example-api', 'src'), { recursive: true });
  return root;
}

describe('fx manifest', () => {
  it('validates a clean workspace from a nested directory', () => {
    const root = workspaceFrom('v2-full');
    const run = fx(
      ['manifest', 'validate', '--strict', '--format', 'json'],
      {},
      path.join(root, 'fx-example-api', 'src'),
    );
    expect(run.status).toBe(0);
    expect(run.json()).toMatchObject({ ok: true, dir: realpathSync(root) });
  });

  it('reports problems on stdout and exits 3', () => {
    const root = tempDir('fx-ws-');
    mkdirSync(path.join(root, 'manifest'));
    writeFileSync(
      path.join(root, 'manifest', 'workspace.yaml'),
      readFileSync(path.join(fixtures, 'broken', 'entry.yaml')),
    );
    const run = fx(['manifest', 'validate', '--format', 'json'], {}, root);
    expect(run.status).toBe(3);
    expect(run.error().code).toBe('MANIFEST_INVALID');
    const report = run.json() as {
      ok: boolean;
      documents: { kind: string; problems: { path: string }[] }[];
    };
    expect(report.ok).toBe(false);
    expect(report.documents[0]?.problems.map((p) => p.path)).toEqual([
      'repos[1].name',
      'repos[2].path',
    ]);
  });

  it('turns unknown keys into failures only under --strict', () => {
    const root = tempDir('fx-ws-');
    mkdirSync(path.join(root, 'manifest'));
    writeFileSync(
      path.join(root, 'manifest', 'workspace.yaml'),
      readFileSync(path.join(fixtures, 'broken', 'unknown-keys.yaml')),
    );
    expect(fx(['manifest', 'validate'], {}, root).status).toBe(0);
    expect(fx(['manifest', 'validate', '--strict'], {}, root).status).toBe(3);
  });

  it('validates the source of the registered workspace whose root holds cwd', () => {
    const home = freshHome();
    const root = tempDir('fx-root-');
    const source = manifestDirOf(home, 'w');
    cpSync(path.join(fixtures, 'v1-minimal'), path.join(source, 'manifest'), { recursive: true });
    writeFileSync(path.join(home, 'config.yaml'), `workspaces:\n  w: { root: ${root} }\n`);
    mkdirSync(path.join(root, 'fx-example-api', 'src'), { recursive: true });
    const run = fx(
      ['manifest', 'validate', '--format', 'json'],
      { FX_HOME: home },
      path.join(root, 'fx-example-api', 'src'),
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.json()).toMatchObject({ ok: true, dir: source });
  });

  it('fails with a not_found error outside any workspace', () => {
    const run = fx(['manifest', 'validate'], {}, tempDir('fx-none-'));
    expect(run.status).toBe(6);
    expect(run.error().code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('lints the documents and the team Skills without ever failing', () => {
    const root = workspaceFrom('v1-minimal');
    mkdirSync(path.join(root, 'skills', 'triage'), { recursive: true });
    writeFileSync(path.join(root, 'skills', 'triage', 'SKILL.md'), '---\nname: sort\n---\n');
    const run = fx(['manifest', 'lint', '--format', 'json'], {}, root);
    expect(run.status).toBe(0);
    expect((run.json() as { items: { code: string }[] }).items.map((i) => i.code)).toEqual([
      'PROVIDERS_MISSING',
      'SKILL_NAME_MISMATCH',
      'SKILL_WITHOUT_DESCRIPTION',
    ]);
  });

  it('prints the JSON Schema even in human format', () => {
    const run = fx(['manifest', 'schema', '--kind', 'tools']);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ title: 'fx manifest: tools' });
  });

  it('explains a field and rejects an unknown one', () => {
    expect(fx(['manifest', 'explain', 'repos[].branch', '--format', 'json']).json()).toMatchObject({
      path: 'repos[].branch',
      type: 'string',
    });
    const bad = fx(['manifest', 'explain', 'repos[].brnch']);
    expect(bad.status).toBe(2);
    expect(bad.error().code).toBe('UNKNOWN_MANIFEST_FIELD');
  });

  it('sets a field: dry-run leaves the file alone, read-only blocks, a real run changes one line', () => {
    const root = workspaceFrom('v2-full');
    const file = path.join(root, 'manifest', 'workspace.yaml');
    const original = readFileSync(file, 'utf8');

    const preview = fx(
      ['manifest', 'set', 'fx-example-auth', 'branch', 'release', '--dry-run', '--format', 'json'],
      {},
      root,
    );
    expect(preview.status).toBe(0);
    expect(preview.json()).toMatchObject({ written: false, before: 'main', after: 'release' });
    expect(readFileSync(file, 'utf8')).toBe(original);

    expect(
      fx(['manifest', 'set', 'fx-example-auth', 'branch', 'release'], { FX_READ_ONLY: '1' }, root)
        .status,
    ).toBe(5);
    expect(readFileSync(file, 'utf8')).toBe(original);

    const applied = fx(
      ['manifest', 'set', 'fx-example-auth', 'branch', 'release', '--format', 'json'],
      {},
      root,
    );
    expect(applied.status).toBe(0);
    expect(applied.json()).toMatchObject({ written: true });
    const edited = readFileSync(file, 'utf8');
    const changed = edited.split('\n').filter((line, i) => line !== original.split('\n')[i]);
    expect(changed).toEqual(['    branch: release']);
  });

  it('lists provider bindings', () => {
    const root = workspaceFrom('v2-full');
    const run = fx(['manifest', 'providers', '--format', 'json'], {}, root);
    expect(run.status).toBe(0);
    expect(
      (run.json() as { items: { capability: string; source: string }[] }).items,
    ).toContainEqual(
      expect.objectContaining({ capability: 'im', provider: 'lark-cli', source: 'explicit' }),
    );
  });
});

it.each(['flag', 'environment'])(
  'selects manifest writes by %s before the checkout around cwd',
  (selector) => {
    const home = freshHome();
    const local = workspaceFrom('v2-full');
    const source = manifestDirOf(home, 'selected');
    cpSync(path.join(fixtures, 'v2-full'), path.join(source, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(home, 'config.yaml'),
      JSON.stringify({ workspaces: { selected: { root: freshHome() } } }),
    );
    const localFile = path.join(local, 'manifest/workspace.yaml');
    const selectedFile = path.join(source, 'manifest/workspace.yaml');
    const original = readFileSync(localFile, 'utf8');
    const selectors = selector === 'flag' ? ['--workspace', 'selected'] : [];
    const env = { FX_HOME: home, FX_WORKSPACE: selector === 'flag' ? 'missing' : 'selected' };
    const result = fx(
      [
        'manifest',
        'repo-set',
        'fx-example-auth',
        'branch',
        'release',
        ...selectors,
        '--format',
        'json',
      ],
      env,
      local,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ written: true, before: 'main', after: 'release' });
    expect(readFileSync(localFile, 'utf8')).toBe(original);
    expect(readFileSync(selectedFile, 'utf8')).toContain('release');
    const unknown = fx(
      [
        'manifest',
        'repo-set',
        'fx-example-auth',
        'branch',
        'wrong',
        '--workspace',
        'missing',
        '--format',
        'json',
      ],
      env,
      local,
    );
    expect(unknown.error().code).toBe('WORKSPACE_UNKNOWN');
    expect(readFileSync(localFile, 'utf8')).toBe(original);
  },
);
