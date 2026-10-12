// A manifest that keeps a Go workspace, against real git and the real file
// projection: init writes go.work over the Go modules it cloned, the root counts
// it as fx's own, unregistering the workspace retires it, and the Go command
// accepts what fx wrote.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { freshHome, fx, repository, tempDir } from './harness.js';

const goAvailable = spawnSync('go', ['version']).status === 0;

// The kit declares the language version and comes first; the CLI declares the
// newer release on an indented line and lives at a path with a space.
function initFamily() {
  const base = tempDir('fx-go-');
  const kit = repository(base, 'kit', { 'go.mod': 'module example.com/kit\n\ngo 1.21\n' });
  const cli = repository(base, 'cli', { 'go.mod': 'module example.com/cli\n\n  go 1.21.0\n' });
  const site = repository(base, 'site', { 'package.json': '{}\n' });
  const source = path.join(base, 'source');
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  const entry = (name: string, at: string, bare: string): string =>
    `  - { name: ${name}, path: '${at}', upstream: '${pathToFileURL(bare).href}' }`;
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    [
      'schema_version: 2',
      'defaults: { branch: main }',
      'go: { workspace: true }',
      'repos:',
      entry('kit', 'src/kit', kit.bare),
      entry('cli', 'src/my cli', cli.bare),
      entry('site', 'src/site', site.bare),
      '',
    ].join('\n'),
  );
  const env = { FX_HOME: freshHome(), FX_AGENTS: '', FX_HOOKS: '0' };
  const ws = path.join(base, 'ws');
  const run = (args: string[]) => fx([...args, '--format', 'json'], env, base);
  const init = run(['init', ws, '--from', source, '--name', 'family']);
  expect(init.status, init.stderr).toBe(0);
  return { ws, run };
}

describe('Go workspace', () => {
  it('keeps go.work over the cloned Go modules from init to unregister', () => {
    const { ws, run } = initFamily();
    const goWork = path.join(ws, 'go.work');
    expect(readFileSync(goWork, 'utf8')).toMatch(
      /^\/\/ fx:derived .*\n\ngo 1\.21\.0\n\nuse \(\n\t\.\/src\/kit\n\t"\.\/src\/my cli"\n\)\n$/,
    );

    writeFileSync(path.join(ws, 'go.work.sum'), '');
    const status = run(['status', '--workspace', 'family']);
    expect(status.status, status.stderr).toBe(0);
    expect(status.json()).toMatchObject({ stray_entries: [] });

    const again = run(['sync', '--workspace', 'family', '--only', 'go']);
    expect(again.status, again.stderr).toBe(0);
    expect(again.json()).toMatchObject({
      stages: { go: { modules: 2, go_work: 'unchanged' } },
    });

    const removed = run(['workspace', 'unregister', 'family']);
    expect(removed.status, removed.stderr).toBe(0);
    expect(existsSync(goWork)).toBe(false);
    expect(existsSync(path.join(ws, 'src/kit/go.mod'))).toBe(true);
  });

  it.runIf(goAvailable)('writes a go.work the Go command loads', () => {
    const { ws } = initFamily();
    const list = spawnSync('go', ['list', '-m'], {
      cwd: ws,
      encoding: 'utf8',
      env: { ...process.env, GOTOOLCHAIN: 'local', GOFLAGS: '', GOWORK: '' },
    });
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout.trim().split(/\r?\n/).sort()).toEqual([
      'example.com/cli',
      'example.com/kit',
    ]);
  });
});
