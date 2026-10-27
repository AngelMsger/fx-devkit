// Init without a manifest drives a fake npm and fake companions; no real packages are installed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim } from '../platform.js';

import { freshHome, fx, searchPath, tempDir } from './harness.js';

// A companion that reports its version, records where it installs its Skill and says
// whether someone is signed in.
function companion(dir: string, name: string, version: string, signedIn: boolean): void {
  const receipt = path.join(dir, '..', `${name}.skill`);
  writeNodeShim(
    dir,
    name,
    `const a=process.argv.slice(2);
if(a[0]==='--version') console.log('${name} ${version}');
else if(a[0]==='skill') require('node:fs').writeFileSync(${JSON.stringify(receipt)}, a[a.indexOf('--dir')+1]);
else if(a[0]==='auth') console.log(JSON.stringify({configured:${signedIn}}));`,
  );
}

function fixture() {
  const root = tempDir('fx-init-standalone-');
  const shims = path.join(root, 'bin');
  const template = path.join(root, 'template');
  companion(shims, 'bitbucket-cli', '0.26.0', true);
  companion(template, 'jira-cli', '0.9.1', false);
  const receipt = path.join(root, 'npm-calls.json');
  writeNodeShim(
    shims,
    'npm',
    `const fs=require('node:fs'), path=require('node:path'); const target=${JSON.stringify(receipt)};
const calls=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):[]; calls.push(process.argv.slice(2)); fs.writeFileSync(target,JSON.stringify(calls));
for(const file of fs.readdirSync(${JSON.stringify(template)})) fs.copyFileSync(path.join(${JSON.stringify(template)},file),path.join(${JSON.stringify(shims)},file));`,
  );
  const home = freshHome();
  writeFileSync(path.join(home, 'config.yaml'), 'agents: [claude-code]\n');
  const userHome = path.join(root, 'home');
  mkdirSync(userHome);
  const env = { FX_HOME: home, PATH: searchPath(shims) };
  return {
    root,
    receipt,
    userHome,
    run: (args: readonly string[]) =>
      fx(['init', ...args, '--format', 'json'], env, root, undefined, userHome),
  };
}

describe('init without a manifest', () => {
  it('needs tool names from an agent, previews without effects, then installs, adds Skills and hands over sign-in', () => {
    const f = fixture();
    const unnamed = f.run(['--no-input']);
    expect(unnamed.status, unnamed.stderr).toBe(2);
    expect(unnamed.error()).toMatchObject({ code: 'INIT_INPUT_REQUIRED' });
    expect(f.run(['./ws', '--tools', 'jira-cli']).error().code).toBe('INIT_INPUT_REQUIRED');

    const preview = f.run(['--tools', 'bitbucket-cli,jira-cli', '--dry-run', '--details']);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json()).toMatchObject({
      operation: 'preview',
      preparation: { state: 'planned', scope: { workspace: null } },
      tool_install: [
        { name: 'jira-cli', vector: ['npm', 'install', '-g', '@angelmsger/jira-cli@latest'] },
      ],
    });
    expect(existsSync(f.receipt)).toBe(false);

    const applied = f.run(['--tools', 'bitbucket-cli,jira-cli', '--no-input', '--details']);
    expect(applied.status, applied.stderr).toBe(12);
    expect(applied.json()).toMatchObject({
      tools: [
        { name: 'bitbucket-cli', install: 'present', installed: '0.26.0', sign_in: 'ready' },
        { name: 'jira-cli', install: 'installed', installed: '0.9.1', sign_in: 'pending' },
      ],
      preparation: {
        state: 'incomplete',
        blockers: [
          {
            id: 'login:jira-cli.auth',
            actions: [{ actor: 'user', argv: ['jira-cli', 'config', 'init'] }],
          },
        ],
      },
    });
    expect(JSON.parse(readFileSync(f.receipt, 'utf8'))).toEqual([
      ['install', '-g', '@angelmsger/jira-cli@latest'],
    ]);
    const skills = path.join(f.userHome, '.claude', 'skills');
    for (const tool of ['bitbucket-cli', 'jira-cli'])
      expect(readFileSync(path.join(f.root, `${tool}.skill`), 'utf8')).toBe(skills);
    expect(readdirSync(skills)).toContain('fx-workspace');
  });
});
