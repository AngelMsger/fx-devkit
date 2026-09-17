// Import and adopt ordinary clones through the public CLI without remotes or workspace-file workarounds.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { freshHome, fx, git, repository } from './harness.js';

function stage(project = 'team', repositoryName = 'api', fileUrl = false) {
  const base = freshHome();
  const host = path.join(base, 'host');
  mkdirSync(path.join(host, project), { recursive: true });
  const remote = repository(path.join(host, project), repositoryName, { README: 'initial\n' });
  const root = path.join(base, 'workspace');
  mkdirSync(root);
  const checkout = path.join(root, 'api');
  const transport = fileUrl ? pathToFileURL(remote.bare).href : remote.bare;
  git(['clone', '-q', transport, checkout], base);
  const source = path.join(base, 'source');
  const file = path.join(source, 'manifest/workspace.yaml');
  const env = { FX_HOME: freshHome(), FX_AGENTS: '' };
  const run = (args: string[]) => fx([...args, '--format', 'json'], env, root);
  return { base, host, remote, root, checkout, source, file, env, run };
}

function importSource(s: ReturnType<typeof stage>, disableTools = true) {
  const imported = s.run(['manifest', 'import', s.root, '-o', s.file]);
  expect(imported.status, imported.stderr).toBe(0);
  const baseline = parse(readFileSync('defaults/tools.yaml', 'utf8')) as {
    tools: { name: string }[];
  };
  if (disableTools)
    writeFileSync(
      path.join(s.source, 'manifest/tools.yaml'),
      'schema_version: 2\ntools:\n' +
        baseline.tools.map((tool) => `  - {name: ${tool.name}, enabled: false}`).join('\n'),
    );
  return imported.json() as { manifest: string; report: { review: { note: string }[] } };
}

const initialArgs = (s: ReturnType<typeof stage>) => [
  'init',
  s.root,
  '--name',
  'adopted',
  '--from',
  s.source,
  '--details',
];

describe('ordinary clone import and adoption', () => {
  it('completes local import and adoption with the untouched bundled tool catalog', () => {
    const s = stage();
    importSource(s, false);
    const result = fx(
      [...initialArgs(s), '--format', 'json'],
      { ...s.env, PATH: process.platform === 'win32' ? process.env.PATH : '/usr/bin:/bin' },
      s.root,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      preparation_complete: true,
      sync: {
        items: [expect.objectContaining({ name: 'api', upstream_added: true })],
        stage_details: { tools: { items: [] } },
      },
    });
    expect(git(['remote', 'get-url', 'origin'], s.checkout)).toBe(s.remote.bare);
  });

  it.each([
    { project: 'team space', repo: 'api space', fileUrl: true },
    { project: 'team%20space', repo: 'api%25', fileUrl: true },
    { project: 'team%20space', repo: 'api%25', fileUrl: false },
  ])(
    'keeps decoded local provider coordinates for $project / $repo, fileUrl=$fileUrl',
    ({ project, repo, fileUrl }) => {
      const s = stage(project, repo, fileUrl);
      const imported = importSource(s, false);
      const manifest = parse(imported.manifest);
      expect(manifest.defaults.upstream_project).toBe(project);
      expect(manifest.providers['code-host']).toMatchObject({
        provider: 'local-git',
        vars: { host: s.host },
      });
      expect(imported.report.review).toEqual([]);
      const fresh = path.join(s.base, 'fresh-workspace');
      const result = fx(
        ['init', fresh, '--name', 'fresh', '--from', s.source, '--details', '--format', 'json'],
        s.env,
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.json()).toMatchObject({
        preparation_complete: true,
        sync: {
          items: [expect.objectContaining({ name: 'api', action: 'clone', result: 'done' })],
        },
      });
      expect(readFileSync(path.join(fresh, 'api/README'), 'utf8')).toBe('initial\n');
      const resync = fx(
        ['sync', '--workspace', 'fresh', '--only', 'repos', '--details', '--format', 'json'],
        s.env,
      );
      expect(resync.status, resync.stderr).toBe(0);
      expect(resync.json()).toMatchObject({ preparation_complete: true });
    },
  );

  it.each([
    { required: true, installOnInit: false },
    { required: false, installOnInit: false },
    { required: true, installOnInit: true },
    { required: false, installOnInit: true },
  ])(
    'keeps required=$required installOnInit=$installOnInit disabled-tool reports consistent',
    ({ required, installOnInit }) => {
      const s = stage();
      importSource(s, false);
      writeFileSync(
        path.join(s.source, 'manifest/tools.yaml'),
        `schema_version: 2\ntools: [{name: optional-review-tool, required: ${required}, enabled: false, install_on_init: ${installOnInit}, skill: {command: []}, auth: {command: []}}]\n`,
      );
      const initialized = s.run(initialArgs(s));
      expect(initialized.status, initialized.stderr).toBe(0);
      expect(initialized.json()).toMatchObject({ preparation_complete: !required });
      const sync = s.run(['sync', '--only', 'tools', '--details']);
      expect(sync.status, sync.stderr).toBe(0);
      expect(sync.json()).toMatchObject({ preparation_complete: !required });
      const doctor = s.run(['doctor', '--details']);
      expect(doctor.status, doctor.stderr).toBe(0);
      expect(doctor.json()).toMatchObject({
        ok: !required,
        complete: !required,
        findings: expect.arrayContaining([
          expect.objectContaining({
            id: 'optional-review-tool',
            level: required ? 'fail' : 'ok',
            coverage: required ? 'incomplete' : 'not_applicable',
          }),
        ]),
      });
    },
  );

  it.each(['untracked', 'dirty', 'task'])(
    'adds only an exact-match upstream while preserving %s work',
    (work) => {
      const s = stage();
      if (work === 'task') git(['checkout', '-qb', 'task/work'], s.checkout);
      if (work !== 'untracked') writeFileSync(path.join(s.checkout, 'README'), 'personal edit\n');
      writeFileSync(path.join(s.checkout, 'personal.txt'), 'personal file\n');
      const head = git(['rev-parse', 'HEAD'], s.checkout);
      const branch = git(['branch', '--show-current'], s.checkout);
      const status = git(['status', '--porcelain'], s.checkout);
      const imported = importSource(s);
      expect(parse(imported.manifest)).toMatchObject({
        providers: { 'code-host': { provider: 'local-git', vars: { host: s.host } } },
      });
      expect(imported.report.review).toEqual([]);
      const preview = s.run([...initialArgs(s), '--dry-run']);
      expect(preview.status, preview.stderr).toBe(0);
      expect(preview.json()).toMatchObject({
        plan: {
          repositories: [expect.objectContaining({ name: 'api', upstream_to_add: s.remote.bare })],
        },
      });
      expect(git(['remote'], s.checkout)).toBe('origin');
      const locked = fx(
        [...initialArgs(s), '--format', 'json'],
        { ...s.env, FX_READ_ONLY: '1' },
        s.root,
      );
      expect(locked.error().code).toBe('READONLY_BLOCKED');
      expect(git(['remote'], s.checkout)).toBe('origin');
      const applied = s.run(initialArgs(s));
      expect(applied.status, applied.stderr).toBe(0);
      expect(applied.json()).toMatchObject({
        sync: {
          items: [
            expect.objectContaining({
              name: 'api',
              upstream_added: true,
              action: work === 'dirty' ? 'skip_dirty' : 'fast_forward',
            }),
          ],
        },
      });
      expect((applied.json() as { preparation_complete: boolean }).preparation_complete).toBe(
        work !== 'dirty',
      );
      expect(git(['remote', 'get-url', 'origin'], s.checkout)).toBe(s.remote.bare);
      expect(git(['remote', 'get-url', 'upstream'], s.checkout)).toBe(s.remote.bare);
      expect(git(['rev-parse', 'HEAD'], s.checkout)).toBe(head);
      expect(git(['branch', '--show-current'], s.checkout)).toBe(branch);
      expect(git(['status', '--porcelain'], s.checkout)).toBe(status);
      expect(readFileSync(path.join(s.checkout, 'personal.txt'), 'utf8')).toBe('personal file\n');
    },
  );

  it('preserves a conflicting upstream and records the declaration mismatch', () => {
    const s = stage();
    importSource(s);
    const conflict = path.join(s.base, 'other.git');
    git(['remote', 'add', 'upstream', conflict], s.checkout);
    const result = s.run(initialArgs(s));
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      preparation_complete: false,
      sync: { items: [expect.objectContaining({ action: 'skip_remote_mismatch' })] },
    });
    expect(git(['remote', 'get-url', 'upstream'], s.checkout)).toBe(conflict);
    expect(git(['remote', 'get-url', 'origin'], s.checkout)).toBe(s.remote.bare);
  });

  it('keeps arbitrary hosted URLs explicit and marks provider inference unresolved', () => {
    const s = stage();
    const remote = 'https://git.example.com/team/api.git';
    git(['remote', 'set-url', 'origin', remote], s.checkout);
    const imported = s.run(['manifest', 'import', s.root]);
    expect(imported.status, imported.stderr).toBe(0);
    const value = imported.json() as { manifest: string; report: { review: { note: string }[] } };
    expect(parse(value.manifest)).toMatchObject({
      providers: {},
      repos: [{ name: 'api', upstream: remote }],
    });
    expect(parse(value.manifest).defaults).not.toHaveProperty('host');
    expect(value.report.review).toContainEqual(
      expect.objectContaining({ note: expect.stringContaining('provider could not be verified') }),
    );
    expect(value.manifest).not.toContain('bitbucket-cli');
    expect(git(['remote'], s.checkout)).toBe('origin');
  });

  it.each([
    'https://private-token@git.example.com/team/api.git',
    'https://git.example.com/team/api.git?token=private-token',
  ])('does not export credentials from an HTTP remote', (remote) => {
    const s = stage();
    git(['remote', 'set-url', 'origin', remote], s.checkout);
    const result = s.run(['manifest', 'import', s.root]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('private-token');
    expect(result.json()).toMatchObject({
      report: {
        repos: 0,
        skipped: [{ path: 'api', reason: expect.stringContaining('embedded credentials') }],
      },
    });
  });
});
