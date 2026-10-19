import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { writeNodeShim, gitExecutable } from '../platform.js';
import { until } from '../waiting.js';

import { freshHome, fx, git, repository, searchPath } from './harness.js';

describe('session-start network isolation', () => {
  it('fetches only the manifest and reuses its network window across sessions', async () => {
    const base = realpathSync(freshHome());
    const home = path.join(base, 'home');
    const root = path.join(base, 'root');
    mkdirSync(home);
    mkdirSync(root);
    const business = repository(base, 'business', { 'README.md': 'business' });
    const manifest = repository(base, 'manifest', {
      'manifest/workspace.yaml': `schema_version: 2\ndefaults: { upstream_project: team, branch: main }\nrepos: [{name: example, project: team, upstream: '${pathToFileURL(business.bare).href}'}]\n`,
      'AGENTS.md': 'old guidance\n',
    });
    const source = path.join(home, 'workspaces/test/source');
    mkdirSync(path.dirname(source), { recursive: true });
    git(['clone', '--quiet', '--origin', 'upstream', manifest.bare, source], base);
    writeFileSync(
      path.join(home, 'config.yaml'),
      `agents: [codex]\nworkspaces:\n  test: { root: ${root}, source: ${manifest.author} }\n`,
    );
    manifest.commit({ 'AGENTS.md': 'new guidance\n' }, 'update');
    const wrapper = path.join(base, 'bin');
    mkdirSync(wrapper);
    const log = path.join(base, 'git.jsonl');
    const realGit = gitExecutable();
    writeNodeShim(
      wrapper,
      'git',
      `#!${process.execPath}\nconst fs=require('node:fs');const cp=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');try{process.stdout.write(cp.execFileSync(${JSON.stringify(realGit)},args));}catch(e){process.stderr.write(e.stderr??'');process.exit(e.status??1);}`,
    );
    const env = { FX_HOME: home, FX_UPDATE_CHECK: '1', PATH: searchPath(wrapper) };
    expect(
      fx(['hook', 'inject', '--workspace', 'test'], { ...env, FX_UPDATE_CHECK: '0' }, root).status,
    ).toBe(0);
    const stateFile = path.join(home, 'workspaces/test/hooks.json');
    const owner = JSON.parse(readFileSync(stateFile, 'utf8')).receipts[0].owner;
    const args = [
      'hook',
      'dispatch',
      'session-start',
      '--workspace',
      'test',
      '--root',
      root,
      '--fx-home',
      home,
      '--agent',
      'codex',
      '--owner',
      owner,
    ];
    expect(fx(args, env, root, JSON.stringify({ cwd: root })).status).toBe(0);
    const guide = path.join(root, 'AGENTS.md');
    await until(
      () => existsSync(guide) && readFileSync(guide, 'utf8').includes('new guidance'),
      8000,
    );
    expect(readFileSync(guide, 'utf8')).toContain('new guidance');
    const network = (): string[][] =>
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
        .filter((args) => args.some((arg) => ['fetch', 'ls-remote', 'clone'].includes(arg)));
    const before = network();
    expect(before.some((args) => args.includes('fetch'))).toBe(true);
    expect(before.every((args) => args.includes(source))).toBe(true);
    expect(existsSync(path.join(root, 'example'))).toBe(false);
    expect(fx(args, env, root, JSON.stringify({ cwd: root })).status).toBe(0);
    await delay(150);
    expect(network()).toEqual(before);
  });
});
