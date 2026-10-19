// A newcomer can prepare locally, hand off personal input once, and resume without redoing work.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, it } from 'vitest';

import { writeNodeShim } from '../platform.js';

import { freshHome, fx, manifestDirOf, repository, searchPath, tempDir } from './harness.js';

it('completes authorized local preparation, preserves guides, and resumes after all human prerequisites', () => {
  const base = tempDir('fx-onboarding-');
  const root = path.join(base, 'workspace 新同学');
  const source = path.join(base, 'source');
  const host = path.join(base, 'host/team');
  const bin = path.join(base, 'bin');
  for (const dir of [path.join(source, 'manifest'), host, bin]) mkdirSync(dir, { recursive: true });
  repository(host, 'api', { 'README.md': 'API fixture' });
  const prose = '# Team rules\n\nPreserve this author paragraph.\n';
  writeFileSync(path.join(source, 'AGENTS.md'), prose);
  const local = path.join(root, 'local.ready');
  const auth = path.join(root, 'auth.ready');
  const access = path.join(root, 'access.ready');
  const count = path.join(base, 'prepare.count');
  const forbidden = path.join(base, 'automatic-auth');
  writeNodeShim(
    bin,
    'fixture-ready',
    `const fs=require('node:fs');
    const command=process.argv[2];
    if(command==='--version') console.log('1.2.3');
    else if(command==='prepare') { fs.appendFileSync(${JSON.stringify(count)},'run\\n'); fs.writeFileSync(${JSON.stringify(local)},'ready'); }
    else if(command==='authenticate') { fs.writeFileSync(${JSON.stringify(forbidden)},'must not run during init'); }
    else process.exitCode=2;`,
  );
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    `schema_version: 2
providers: {code-host: {provider: local-git, vars: {host: ${path.dirname(host)}}}}
defaults: {upstream_project: team, branch: main}
repos: [{name: api}]
`,
  );
  writeFileSync(
    path.join(source, 'manifest/tools.yaml'),
    `schema_version: 3
tools:
  - name: fixture-ready
    required: true
    install: [{via: manual}]
    auth: {command: []}
    skill: {command: []}
    setup:
      - {id: local, kind: run, phase: prepare, title: Prepare local files, run: [prepare], verify: {file: local.ready}}
      - {id: login, kind: run, phase: authenticate, title: Personal sign-in, run: [authenticate], requires: [local], verify: {file: auth.ready}}
      - {id: access, kind: file, title: Operator access file, expects: {path: ${access}}, requires: [local], verify: {file: access.ready}}
`,
  );
  const home = freshHome();
  const env = {
    FX_HOME: home,
    FX_AGENTS: 'codex',
    PATH: searchPath(bin),
  };
  const args = ['init', root, '--from', source, '--format', 'json'];
  const preview = fx([...args, '--dry-run'], env);
  expect(preview.status, preview.stderr).toBe(0);
  expect(preview.json()).toMatchObject({ preparation: { state: 'planned' }, registered: false });
  expect(preview.json()).toMatchObject({
    plan: {
      resources: {
        setup: expect.arrayContaining([
          expect.objectContaining({
            id: 'fixture-ready.local',
            action: 'prepare_if_needed',
            command: ['fixture-ready', 'prepare'],
          }),
          expect.objectContaining({
            id: 'fixture-ready.login',
            action: 'verify_only',
            command: null,
          }),
        ]),
      },
    },
  });
  expect(existsSync(count)).toBe(false);
  const humanPreview = fx(['init', root, '--from', source, '--dry-run'], env);
  expect(humanPreview.status, humanPreview.stderr).toBe(0);
  expect(humanPreview.stdout).toContain(root);
  expect(humanPreview.stdout).toContain('fixture-ready prepare');
  expect(humanPreview.stdout).toContain('1 selected');
  const applied = fx([...args, '--yes'], env);
  expect(applied.status, applied.stderr).toBe(12);
  const name = (applied.json() as { name: string }).name;
  expect(name).toMatch(/^workspace-[a-f0-9]{8}$/);
  expect(applied.json()).toMatchObject({
    registered: true,
    preparation: {
      state: 'incomplete',
      next: { kind: 'handoff' },
      next_actions: [],
      blockers: expect.arrayContaining([
        expect.objectContaining({ resource: 'fixture-ready.login', owner: 'user' }),
        expect.objectContaining({ resource: 'fixture-ready.access', owner: 'user' }),
      ]),
      resume: {
        argv: expect.arrayContaining(['init', '--resume', '--workspace', name]),
        env: expect.objectContaining({ FX_HOME: home, FX_AGENTS: 'codex' }),
      },
    },
  });
  expect(existsSync(forbidden)).toBe(false);
  expect(readFileSync(count, 'utf8')).toBe('run\n');
  expect(readFileSync(path.join(source, 'AGENTS.md'), 'utf8')).toBe(prose);
  expect(readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toContain('fx:begin team-skills');
  const humanPending = fx(['init', '--resume', '--workspace', name, '--details'], env);
  expect(humanPending.status, humanPending.stderr).toBe(12);
  expect(humanPending.stdout.split('\n')[0]).toContain(root);
  expect(humanPending.stdout).toContain('Setup already verified: Prepare local files');
  expect(humanPending.stdout.indexOf('Setup already verified:')).toBeLessThan(
    humanPending.stdout.indexOf('operation'),
  );
  expect(readFileSync(count, 'utf8')).toBe('run\n');
  writeFileSync(path.join(root, 'notes.txt'), 'Keep my note');
  writeFileSync(auth, 'Signed in by the operator');
  writeFileSync(access, 'Granted by the operator');
  for (let attempt = 0; attempt < 2; attempt++) {
    const resume = [
      'init',
      '--resume',
      '--workspace',
      attempt === 0 ? root : name,
      '--format',
      'json',
    ];
    const result = fx(resume, env);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      manifest: 'kept',
      preparation: { state: 'ready', blockers: [] },
    });
  }
  expect(readFileSync(count, 'utf8')).toBe('run\n');
  expect(existsSync(forbidden)).toBe(false);
  expect(readFileSync(path.join(root, 'notes.txt'), 'utf8')).toBe('Keep my note');
  expect(readFileSync(path.join(manifestDirOf(home, name), 'AGENTS.md'), 'utf8')).toBe(prose);
  const diagnostic = fx(['doctor', '--workspace', root, '--format', 'json'], env);
  expect(diagnostic.status, diagnostic.stderr).toBe(0);
  expect(diagnostic.json()).toMatchObject({ preparation: { state: 'ready', blockers: [] } });
  const query = ['repo', 'list', '--workspace', root, '--format', 'json'];
  const details = fx([...query, '--details'], env);
  expect(details.status, details.stderr).toBe(0);
  expect(details.json()).toEqual(fx(query, env).json());
});
