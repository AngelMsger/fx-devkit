// Updating companions outside a workspace drives a fake npm and fake companions; no real
// packages are installed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim } from '../platform.js';

import { freshHome, fx, searchPath, tempDir } from './harness.js';

// A companion that reports its version and records where it installs its Skill.
function companion(dir: string, name: string, version: string): void {
  const receipt = path.join(dir, '..', `${name}.skill`);
  writeNodeShim(
    dir,
    name,
    `const a=process.argv.slice(2);
if(a[0]==='--version') console.log('${name} ${version}');
else if(a[0]==='skill') require('node:fs').writeFileSync(${JSON.stringify(receipt)}, a[a.indexOf('--dir')+1]);`,
  );
}

describe('tool update without a workspace', () => {
  it('updates only the companions already installed and has each install its Skill again', () => {
    const root = tempDir('fx-tool-update-');
    const shims = path.join(root, 'bin');
    companion(shims, 'bitbucket-cli', '0.26.0');
    const receipt = path.join(root, 'npm-calls.json');
    writeNodeShim(
      shims,
      'npm',
      `const fs=require('node:fs'); const target=${JSON.stringify(receipt)};
const calls=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):[]; calls.push(process.argv.slice(2)); fs.writeFileSync(target,JSON.stringify(calls));`,
    );
    const home = freshHome();
    writeFileSync(path.join(home, 'config.yaml'), 'agents: [claude-code]\n');
    const userHome = path.join(root, 'home');
    mkdirSync(userHome);
    const run = (args: readonly string[]) =>
      fx(
        ['tool', 'update', ...args, '--format', 'json'],
        { FX_HOME: home, PATH: searchPath(shims) },
        root,
        undefined,
        userHome,
      );

    const preview = run(['--all', '--dry-run']);
    expect(preview.status, preview.stderr).toBe(0);
    const planned = (preview.json() as { items: { name: string; skill: string }[] }).items;
    expect(planned).toContainEqual(
      expect.objectContaining({ name: 'bitbucket-cli', skill: 'planned' }),
    );
    expect(planned.map((row) => row.name)).not.toContain('jira-cli');
    expect(existsSync(receipt)).toBe(false);

    const applied = run(['--all']);
    expect(applied.status, applied.stderr).toBe(0);
    expect((applied.json() as { items: unknown[] }).items).toContainEqual(
      expect.objectContaining({ name: 'bitbucket-cli', status: 'done', skill: 'installed' }),
    );
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual([
      ['install', '-g', '@angelmsger/bitbucket-cli@latest'],
    ]);
    expect(readFileSync(path.join(root, 'bitbucket-cli.skill'), 'utf8')).toBe(
      path.join(userHome, '.claude', 'skills'),
    );
  });
});
