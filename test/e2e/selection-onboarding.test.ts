// Exercise selective first clone, reversible scope modes and readonly previews through the public CLI.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { freshHome, fx, git, manifestDirOf, repository, tempDir } from './harness.js';

function fixture() {
  const base = tempDir('fx-selection-');
  const source = path.join(base, 'source');
  const root = path.join(base, 'workspace');
  const home = freshHome();
  const repos = ['api', 'web'].map((name) => ({
    name,
    ...repository(base, name, { README: name }),
  }));
  const manifest = `schema_version: 2\ndefaults: {branch: main}\nrepos:\n${repos.map((repo) => `  - {name: ${repo.name}, upstream: '${repo.bare}'}`).join('\n')}\n`;
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(path.join(source, 'manifest/workspace.yaml'), manifest);
  writeFileSync(
    path.join(source, 'manifest/environments.yaml'),
    'schema_version: 2\nplatforms: {docs: {command: "echo documentation"}}\nenvs: {dev: {}, prod: {}}\n',
  );
  const baseline = parse(readFileSync('defaults/tools.yaml', 'utf8')) as {
    tools: { name: string }[];
  };
  writeFileSync(
    path.join(source, 'manifest/tools.yaml'),
    `schema_version: 3\ntools:\n${baseline.tools.map((tool) => `  - {name: ${tool.name}, enabled: false}`).join('\n')}\n`,
  );
  const env = { FX_HOME: home, FX_AGENTS: '' };
  const init = ['init', root, '--from', source, '--details', '--format', 'json'];
  const run = (args: string[]) =>
    fx([...args, '--format', 'json'], env, existsSync(root) ? root : base);
  return { base, source, root, home, env, init, run, manifest };
}

describe('selection and first initialization', () => {
  it('previews concrete clones without writes, clones only selected repos, and preserves selection on retry', () => {
    const f = fixture();
    const before = readdirSync(f.home);
    const preview = fx([...f.init, '--repos', 'api', '--dry-run'], { ...f.env, FX_READ_ONLY: '1' });
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json()).toMatchObject({
      manifest: 'not_written',
      registered: false,
      written: false,
      preparation: { state: 'planned' },
      plan: {
        source_inspected: true,
        selection: { mode: 'explicit', repos: ['api'], validated: true },
        repositories: [
          { name: 'api', action: 'clone' },
          { name: 'web', action: 'skip_unpicked' },
        ],
      },
    });
    expect(readdirSync(f.home)).toEqual(before);
    expect(existsSync(f.root)).toBe(false);
    const applied = fx([...f.init, '--repos', 'api'], f.env);
    expect(applied.status, applied.stderr).toBe(0);
    expect(existsSync(path.join(f.root, 'api/.git'))).toBe(true);
    expect(existsSync(path.join(f.root, 'web'))).toBe(false);
    writeFileSync(path.join(f.root, 'api/personal.txt'), 'preserve');
    const repeat = fx(f.init, f.env);
    expect(repeat.status, repeat.stderr).toBe(0);
    expect(existsSync(path.join(f.root, 'web'))).toBe(false);
    expect(readFileSync(path.join(f.root, 'api/personal.txt'), 'utf8')).toBe('preserve');
  });

  it('replaces, adds, removes, empties and restores dynamic all including future declarations', () => {
    const f = fixture();
    expect(fx([...f.init, '--no-repos'], f.env).status).toBe(0);
    const select = f.run(['repo', 'select', 'api']);
    expect(select.json()).toMatchObject({
      before_mode: 'none',
      mode: 'explicit',
      after: ['api'],
      next_steps: ['fx sync --workspace workspace'],
    });
    expect(existsSync(path.join(f.root, 'api'))).toBe(false);
    expect(f.run(['repo', 'pick', 'web', 'web']).json()).toMatchObject({ after: ['api', 'web'] });
    expect(f.run(['repo', 'unpick', 'web']).json()).toMatchObject({ after: ['api'] });
    const preview = f.run(['repo', 'select', '--all', '--dry-run']);
    expect(preview.json()).toMatchObject({ mode: 'all', after: null, written: false });
    expect(f.run(['repo', 'list', '--picked']).json()).toMatchObject({
      items: [{ name: 'api', selection_mode: 'explicit' }],
    });
    expect(f.run(['repo', 'select', '--all']).json()).toMatchObject({ mode: 'all', after: null });
    const sourceCopy = path.join(manifestDirOf(f.home, 'workspace'), 'manifest/workspace.yaml');
    writeFileSync(
      sourceCopy,
      f.manifest + '  - {name: future, upstream: "https://git.example.com/team/future.git"}\n',
    );
    expect(f.run(['repo', 'list']).json()).toMatchObject({
      items: [
        { name: 'api', picked: true, selection_mode: 'all' },
        { name: 'web', picked: true, selection_mode: 'all' },
        { name: 'future', picked: true, selection_mode: 'all' },
      ],
    });
    expect(f.run(['env', 'select', 'dev']).json()).toMatchObject({
      mode: 'explicit',
      after: ['dev'],
    });
    expect(f.run(['env', 'select', '--none']).json()).toMatchObject({ mode: 'none', after: [] });
    expect(f.run(['env', 'select', '--all']).json()).toMatchObject({ mode: 'all', after: null });
    expect(f.run(['repo', 'select']).error().code).toBe('INPUT_REQUIRED');
    expect(f.run(['repo', 'select', '--all', 'api']).error().code).toBe('INPUT_INVALID');
  });

  it('rejects nonexistent/invalid local sources and unknown selections without registration or clones', () => {
    const f = fixture();
    const missing = fx(
      ['init', f.root, '--from', path.join(f.base, 'missing'), '--dry-run', '--format', 'json'],
      f.env,
    );
    expect(missing.error().code).toBe('MANIFEST_SOURCE_INVALID');
    const unknown = fx([...f.init, '--repos', 'ap'], f.env);
    expect(unknown.error().code).toBe('REPO_NOT_FOUND');
    expect(existsSync(path.join(f.home, 'config.yaml'))).toBe(false);
    expect(existsSync(f.root)).toBe(false);
    writeFileSync(
      path.join(f.source, 'manifest/workspace.yaml'),
      'schema_version: 2\nrepos: nope\n',
    );
    const invalid = fx([...f.init, '--dry-run'], f.env);
    expect(invalid.error().code).toBe('MANIFEST_INVALID');
  });

  it('rejects overlapping selection before writing and keeps recovery commands usable', () => {
    const f = fixture();
    const manifest = f.manifest.replace(
      '{name: api, upstream:',
      '{name: api, path: group/api, upstream:',
    );
    writeFileSync(path.join(f.source, 'manifest/workspace.yaml'), manifest);
    expect(fx([...f.init, '--no-repos'], f.env).status).toBe(0);
    const group = path.join(realpathSync(f.root), 'group');
    mkdirSync(group);
    expect(f.run(['repo', 'add', group]).status).toBe(0);
    for (const flags of [[], ['--dry-run']]) {
      const selected = f.run(['repo', 'select', '--all', ...flags]);
      expect(selected.error().code).toBe('LOCAL_INVALID');
    }
    const retried = fx([...f.init, '--repos', 'api'], f.env);
    expect(retried.error().code).toBe('LOCAL_INVALID');
    expect(f.run(['status']).status).toBe(0);
    expect(f.run(['repo', 'select', '--none']).json()).toMatchObject({
      mode: 'none',
      changed: false,
    });
    const alias = path.join(f.root, 'alias');
    symlinkSync(group, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(f.run(['repo', 'add', alias]).error().code).toBe('REPO_EXISTS');
    expect(f.run(['status']).status).toBe(0);
  });

  it.each(['dirty', 'task-branch'])(
    'previews the managed manifest retained on %s during repeated init',
    (retention) => {
      const f = fixture();
      git(['init', '-q', '-b', 'main'], f.source);
      git(['add', '.'], f.source);
      git(['commit', '-qm', 'initial source'], f.source);
      expect(fx([...f.init, '--no-repos'], f.env).status).toBe(0);
      const managed = manifestDirOf(f.home, 'workspace');
      if (retention === 'dirty')
        writeFileSync(
          path.join(managed, 'manifest/workspace.yaml'),
          f.manifest + '# personal edit\n',
        );
      else git(['checkout', '-qb', 'task'], managed);
      writeFileSync(
        path.join(f.source, 'manifest/workspace.yaml'),
        f.manifest + '  - {name: future, upstream: "https://git.example.com/team/future.git"}\n',
      );
      git(['add', '.'], f.source);
      git(['commit', '-qm', 'new shared repository'], f.source);
      const preview = fx([...f.init, '--repos', 'future', '--dry-run'], f.env);
      expect(preview.error().code).toBe('REPO_NOT_FOUND');
      const valid = fx([...f.init, '--repos', 'api', '--dry-run'], f.env);
      expect(valid.status, valid.stderr).toBe(0);
      expect(valid.json()).toMatchObject({
        plan: {
          source_inspected: true,
          inspected_source: managed,
          selection: { repos: ['api'], validated: true },
        },
      });
      const applied = fx([...f.init, '--repos', 'future'], f.env);
      expect(applied.error().code).toBe('REPO_NOT_FOUND');
      expect(readFileSync(path.join(managed, 'manifest/workspace.yaml'), 'utf8')).not.toContain(
        'name: future',
      );
    },
  );

  it.each(['untracked-invalid', 'untracked-valid', 'ignored-valid'])(
    'keeps preview and apply consistent with %s source payload plus upstream changes',
    (variant) => {
      const f = fixture();
      rmSync(path.join(f.source, 'manifest/environments.yaml'));
      git(['init', '-q', '-b', 'main'], f.source);
      git(['add', '.'], f.source);
      git(['commit', '-qm', 'initial source'], f.source);
      expect(fx([...f.init, '--no-repos'], f.env).status).toBe(0);
      const managed = manifestDirOf(f.home, 'workspace');
      const before = git(['rev-parse', 'HEAD'], managed);
      const document =
        variant === 'untracked-invalid'
          ? 'schema_version: 2\nplatforms: {}\nenvs: broken\n'
          : 'schema_version: 2\nplatforms: {docs: {command: "echo documentation"}}\nenvs: {personal: {label: Personal}}\n';
      if (variant === 'ignored-valid')
        writeFileSync(path.join(managed, '.git/info/exclude'), 'manifest/environments.yaml\n');
      else git(['config', 'status.showUntrackedFiles', 'no'], managed);
      writeFileSync(path.join(managed, 'manifest/environments.yaml'), document);
      writeFileSync(
        path.join(f.source, 'manifest/workspace.yaml'),
        f.manifest + '  - {name: future, upstream: "https://git.example.com/team/future.git"}\n',
      );
      git(['add', '.'], f.source);
      git(['commit', '-qm', 'upstream changes'], f.source);
      const preview = fx([...f.init, '--no-repos', '--dry-run'], f.env);
      if (variant === 'untracked-invalid') expect(preview.error().code).toBe('MANIFEST_INVALID');
      else {
        expect(preview.status, preview.stderr).toBe(0);
        expect(preview.json()).toMatchObject({
          plan: { source_inspected: true, inspected_source: managed },
        });
        const future = fx([...f.init, '--repos', 'future', '--dry-run'], f.env);
        expect(future.error().code).toBe('REPO_NOT_FOUND');
      }
      const applied = fx([...f.init, '--no-repos'], f.env);
      if (variant === 'untracked-invalid') expect(applied.error().code).toBe('MANIFEST_INVALID');
      else {
        expect(applied.status, applied.stderr).toBe(0);
        expect(f.run(['env', 'list']).json()).toMatchObject({ items: [{ name: 'personal' }] });
      }
      expect(git(['rev-parse', 'HEAD'], managed)).toBe(before);
      expect(readFileSync(path.join(managed, 'manifest/workspace.yaml'), 'utf8')).not.toContain(
        'name: future',
      );
      expect(readFileSync(path.join(managed, 'manifest/environments.yaml'), 'utf8')).toBe(document);
    },
  );

  it('distinguishes uninspected remote content and inspects committed local Git content', () => {
    const f = fixture();
    const remote = fx(
      [
        'init',
        f.root,
        '--from',
        'https://git.example.com/team/source.git',
        '--repos',
        'api',
        '--dry-run',
        '--format',
        'json',
      ],
      f.env,
    );
    expect(remote.status, remote.stderr).toBe(0);
    expect(remote.json()).toMatchObject({
      manifest: 'not_written',
      registered: false,
      plan: { source_inspected: false, repositories: null, selection: { validated: false } },
    });
    git(['init', '-q', '-b', 'main'], f.source);
    git(['add', '.'], f.source);
    git(['commit', '-qm', 'fixture'], f.source);
    writeFileSync(path.join(f.source, 'manifest/workspace.yaml'), 'invalid dirty working tree');
    const localGit = fx([...f.init, '--repos', 'api', '--dry-run'], f.env);
    expect(localGit.status, localGit.stderr).toBe(0);
    expect(localGit.json()).toMatchObject({
      plan: {
        source_inspected: true,
        selection: { validated: true },
        repositories: [
          { name: 'api', action: 'clone' },
          { name: 'web', action: 'skip_unpicked' },
        ],
      },
    });
    expect(git(['status', '--porcelain'], f.source)).toContain('M manifest/workspace.yaml');
  });
});
