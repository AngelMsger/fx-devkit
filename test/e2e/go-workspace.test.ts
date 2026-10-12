// A manifest that keeps a Go workspace, against real git and the real file
// projection: init writes go.work over the Go modules it cloned, the root counts
// it as fx's own, and unregistering the workspace retires it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { freshHome, fx, repository, tempDir } from './harness.js';

describe('Go workspace', () => {
  it('keeps go.work over the cloned Go modules from init to unregister', () => {
    const base = tempDir('fx-go-');
    const kit = repository(base, 'kit', { 'go.mod': 'module example.com/kit\n\ngo 1.24.0\n' });
    const cli = repository(base, 'cli', { 'go.mod': 'module example.com/cli\n\ngo 1.25.0\n' });
    const site = repository(base, 'site', { 'package.json': '{}\n' });
    const source = path.join(base, 'source');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    const entry = (name: string, bare: string): string =>
      `  - { name: ${name}, path: src/${name}, upstream: '${pathToFileURL(bare).href}' }`;
    writeFileSync(
      path.join(source, 'manifest/workspace.yaml'),
      [
        'schema_version: 2',
        'defaults: { branch: main }',
        'go: { workspace: true }',
        'repos:',
        entry('kit', kit.bare),
        entry('cli', cli.bare),
        entry('site', site.bare),
        '',
      ].join('\n'),
    );
    const env = { FX_HOME: freshHome(), FX_AGENTS: '', FX_HOOKS: '0' };
    const ws = path.join(base, 'ws');
    const run = (args: string[]) => fx([...args, '--format', 'json'], env, base);

    const init = run(['init', ws, '--from', source, '--name', 'family']);
    expect(init.status, init.stderr).toBe(0);
    const goWork = path.join(ws, 'go.work');
    expect(readFileSync(goWork, 'utf8')).toMatch(
      /^\/\/ fx:derived .*\n\ngo 1\.25\.0\n\nuse \(\n\t\.\/src\/cli\n\t\.\/src\/kit\n\)\n$/,
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
});
