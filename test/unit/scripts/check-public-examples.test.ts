// Public examples omit service-specific ports; custom-port fixtures remain synthetic.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { git } from '../../git.js';
import { tempDir } from '../../temp.js';

function check(file: string, text: string) {
  const root = tempDir('fx-public-examples-');
  const script = path.join(root, 'check.mjs');
  writeFileSync(script, readFileSync('scripts/check-public-examples.mjs'));
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  git(['init', '-q'], root);
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
}
const synthetic = 'ssh://git@git.example.com:12345/team/repo.git';
describe('public SSH examples', () => {
  it('accepts standard URLs in documentation', () => {
    expect(check('README.md', 'ssh://git@git.example.com/team/repo.git').status).toBe(0);
  });
  it('allows custom ports only in explicit synthetic tests', () => {
    expect(check('test/fixtures/workspace.yaml', synthetic).status).toBe(0);
    const rejected = check('docs/README.md', synthetic);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('docs/README.md:1');
    expect(rejected.stderr).not.toContain('12345');
  });
  it('rejects arbitrary custom-port fixtures without exposing the value', () => {
    const port = String(49152);
    const rejected = check('test/fixture.ts', ['ssh://git@git.example.com', port].join(':'));
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).not.toContain(port);
  });
});
