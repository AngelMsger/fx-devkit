import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/check-distributable.mjs');
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function check(...targets: string[]): { status: number; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...targets], { encoding: 'utf8' });
  return { status: result.status ?? -1, stderr: result.stderr };
}

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dist-'));
  roots.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return dir;
}

describe('check-distributable', () => {
  it('passes a clean tree, example.com addresses included', () => {
    const dir = tree({
      'a.js': 'export const x = 1;',
      'b.yaml': 'contact: alice@example.com\nhost: ssh://git@git.example.com:12345\n',
    });
    expect(check(dir).status).toBe(0);
  });

  it('fails on a real-looking email address and names the file', () => {
    const dir = tree({ 'a.yaml': ['contact: someone@corp', 'internal\n'].join('.') });
    const result = check(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a.yaml');
  });

  it('fails on a members document by its own markers', () => {
    const dir = tree({ 'p.yaml': 'sensitive: true\npeople: []\n' });
    expect(check(dir).status).toBe(1);
  });

  it('refuses to report success when a target does not exist', () => {
    const result = check(path.join(tmpdir(), 'definitely-missing-dir'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('nothing was checked');
  });

  it('refuses to run with no targets at all', () => {
    expect(check().status).toBe(1);
  });
});
