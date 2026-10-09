import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RepoAdd } from '../../../../src/application/repo/add.js';
import { RepoFork } from '../../../../src/application/repo/fork.js';
import { RepoList } from '../../../../src/application/repo/list.js';
import { RepoRemove } from '../../../../src/application/repo/remove.js';
import { editRepoScope } from '../../../../src/application/repo/scope.js';
import { RepoShow } from '../../../../src/application/repo/show.js';
import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { harness, MANIFEST_DIR, ROOT } from '../../../fakes/workspace.js';

const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };
const write = { dryRun: false, posture: writable };

describe('RepoList', () => {
  it('lists picked and unpicked repositories with their disk state and filters by tag', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    h.git.add(path.join(ROOT, 'fx-example-api'), {});
    const all = await new RepoList(h.deps).execute({});
    expect(all.map((r) => [r.name, r.picked, r.exists])).toEqual([
      ['fx-example-api', true, true],
      ['fx-example-auth', false, false],
      ['fx-example-docs', false, false],
    ]);
    expect((await new RepoList(h.deps).execute({ tag: 'docs' })).map((r) => r.name)).toEqual([
      'fx-example-docs',
    ]);
    expect((await new RepoList(h.deps).execute({ picked: 'unpicked' })).map((r) => r.name)).toEqual(
      ['fx-example-auth', 'fx-example-docs'],
    );
  });

  it('rechecks readability on every request so access recovery is visible', async () => {
    const h = await harness();
    h.codeHost.readability.set('fx/fx-example-auth', 'forbidden');
    const first = await new RepoList(h.deps).execute({ unreadable: true });
    expect(first.map((r) => [r.name, r.readability, r.contact])).toEqual([
      ['fx-example-auth', 'forbidden', '#platform'],
    ]);
    h.codeHost.readability.set('fx/fx-example-auth', 'readable');
    expect(await new RepoList(h.deps).execute({ unreadable: true })).toEqual([]);
    expect(h.codeHost.probes.filter((p) => p === 'fx/fx-example-auth')).toHaveLength(2);
  });
});

describe('RepoShow', () => {
  it('resolves aliases of unpicked shared and local repositories to canonical names', async () => {
    const h = await harness({
      workspace:
        'schema_version: 2\ndefaults: {host: "https://git.example.com", upstream_project: fx, branch: dev}\nrepos:\n  - name: backend\n    aka: [platform, 平台]\n    links: {design: "docs/design.md", guide: "https://docs.example.com/guide"}\n',
      local: {
        scope: { repos: [] },
        overrides: { backend: { path: 'custom/backend', branch: 'release' } },
        repos: [{ name: 'scratch', aka: ['notes'], links: { guide: 'README.md' } }],
      },
    });
    expect(await new RepoShow(h.deps).execute({ name: '平台' })).toMatchObject({
      name: 'backend',
      path: 'custom/backend',
      tracked_branch: 'release',
      picked: false,
      aka: ['platform', '平台'],
      links: { design: 'docs/design.md', guide: 'https://docs.example.com/guide' },
    });
    expect(await new RepoShow(h.deps).execute({ name: 'notes' })).toMatchObject({
      name: 'scratch',
      origin: 'local',
      aka: ['notes'],
      links: { guide: 'README.md' },
    });
    await expect(new RepoFork(h.deps).execute({ name: 'notes', ...write })).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
    });
    expect(h.localStore.writes).toEqual([]);
  });

  it('suggests mistyped aliases of picked, unpicked and local repositories without acting on them', async () => {
    const h = await harness({
      workspace:
        'schema_version: 2\ndefaults: {host: "https://git.example.com", upstream_project: fx, branch: dev}\nrepos:\n  - {name: first, aka: [backend]}\n  - {name: second, aka: [platform]}\n',
      local: {
        scope: { repos: ['first'] },
        repos: [{ name: 'scratch', aka: ['notebook'] }],
      },
    });
    for (const [name, suggestion] of [
      ['bakend', 'backend'],
      ['platfrm', 'platform'],
      ['notebok', 'notebook'],
    ] as const) {
      await expect(new RepoShow(h.deps).execute({ name })).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        hint: `Did you mean "${suggestion}"?`,
      });
    }
    await expect(new RepoFork(h.deps).execute({ name: 'platfrm', ...write })).rejects.toMatchObject(
      {
        code: 'REPO_NOT_FOUND',
        hint: 'Known: first, scratch, second.',
      },
    );
    expect(h.localStore.writes).toEqual([]);
  });

  it('prefers canonical names and refuses ambiguous aliases', async () => {
    const h = await harness({
      workspace:
        'schema_version: 2\ndefaults: {host: "https://git.example.com", upstream_project: fx, branch: dev}\nrepos:\n  - {name: first, aka: [shared, second]}\n  - {name: second, aka: [shared]}\n',
      local: { scope: { repos: [] } },
    });
    expect(await new RepoShow(h.deps).execute({ name: 'second' })).toMatchObject({
      name: 'second',
    });
    await expect(new RepoShow(h.deps).execute({ name: 'shared' })).rejects.toMatchObject({
      category: 'conflict',
      code: 'REPO_ALIAS_AMBIGUOUS',
      nextSteps: ['fx repo show first --workspace fx', 'fx repo show second --workspace fx'],
    });
  });

  it('inspects a known unpicked repository without changing selection', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-auth'] } } });
    expect(await new RepoShow(h.deps).execute({ name: 'fx-example-api' })).toMatchObject({
      name: 'fx-example-api',
      path: 'fx-example-api',
      tracked_branch: 'dev',
      project: 'fx',
      desc: 'Backend monolith',
      tags: ['backend'],
      origin: 'shared',
      picked: false,
      exists: false,
      upstream_url: 'ssh://git@git.example.com:12345/fx/fx-example-api.git',
      next_steps: [
        'fx repo pick fx-example-api --workspace fx',
        'fx sync --only repos --no-refresh-manifest --workspace fx',
      ],
    });
    expect(h.ctx.workspace.repos.map((repo) => repo.name)).toEqual(['fx-example-auth']);
    expect(h.localStore.writes).toEqual([]);
    await expect(
      new RepoFork(h.deps).execute({ name: 'fx-example-api', ...write }),
    ).rejects.toMatchObject({ category: 'not_found', code: 'REPO_NOT_FOUND' });
    expect(h.codeHost.forks).toEqual([]);
  });

  it('uses personal checkout overrides for unpicked repository inspection and listing', async () => {
    const h = await harness({
      local: {
        scope: { repos: ['fx-example-auth'] },
        overrides: { 'fx-example-api': { path: 'custom/backend', branch: 'release' } },
      },
    });
    h.git.add(path.join(ROOT, 'custom/backend'), {});
    expect(await new RepoShow(h.deps).execute({ name: 'fx-example-api' })).toMatchObject({
      path: 'custom/backend',
      tracked_branch: 'release',
      branch: 'dev',
      overridden: ['path', 'branch'],
      picked: false,
      exists: true,
      next_steps: ['fx repo pick fx-example-api --workspace fx'],
    });
    expect((await new RepoList(h.deps).execute({ picked: 'unpicked' }))[0]).toMatchObject({
      name: 'fx-example-api',
      path: 'custom/backend',
      branch: 'release',
      picked: false,
      exists: true,
    });
  });

  it('keeps local and manifest repository resolution when the shared selection is empty', async () => {
    const h = await harness({
      source: 'ssh://git@git.example.com:12345/fx/fx-workspace.git',
      files: { [`${MANIFEST_DIR}/.git/HEAD`]: 'ref: x\n' },
      local: { scope: { repos: [] }, repos: [{ name: 'scratch', path: 'personal/scratch' }] },
    });
    expect(await new RepoShow(h.deps).execute({ name: 'scratch' })).toMatchObject({
      origin: 'local',
      path: 'personal/scratch',
      picked: true,
    });
    expect(await new RepoShow(h.deps).execute({ name: 'fx-workspace' })).toMatchObject({
      origin: 'manifest',
      path: MANIFEST_DIR,
      picked: true,
    });
    await expect(new RepoShow(h.deps).execute({ name: 'unknown' })).rejects.toMatchObject({
      category: 'not_found',
      code: 'REPO_NOT_FOUND',
    });
  });

  it('shows the resolved entry with derived URLs and disk state', async () => {
    const h = await harness();
    const shown = await new RepoShow(h.deps).execute({ name: 'fx-example-auth' });
    expect(shown).toMatchObject({
      name: 'fx-example-auth',
      tracked_branch: 'main',
      project: 'fx',
      upstream_url: 'ssh://git@git.example.com:12345/fx/fx-example-auth.git',
      web_url: expect.stringContaining('fx-example-auth'),
      exists: false,
      contact: '#platform',
    });
  });

  it('suggests the nearest name for a typo', async () => {
    const h = await harness();
    await expect(new RepoShow(h.deps).execute({ name: 'fx-example-ap' })).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      hint: expect.stringContaining('fx-example-api'),
    });
  });
});

describe('editRepoScope', () => {
  it('turns "all" into an explicit list on unpick and keeps other keys of the layer', async () => {
    const h = await harness({ local: { overrides: { 'fx-example-api': { branch: 'x' } } } });
    const result = await editRepoScope(h.deps, { names: ['fx-example-docs'], ...write }, 'unpick');
    expect(result).toMatchObject({
      before: null,
      after: ['fx-example-api', 'fx-example-auth'],
      written: true,
    });
    expect(h.localStore.writes[0]?.layer).toEqual({
      overrides: { 'fx-example-api': { branch: 'x' } },
      scope: { repos: ['fx-example-api', 'fx-example-auth'] },
    });
  });

  it('is a no-op when picking while everything is already tracked', async () => {
    const h = await harness();
    const result = await editRepoScope(h.deps, { names: ['fx-example-api'], ...write }, 'pick');
    expect(result).toMatchObject({ changed: false, written: false });
    expect(h.localStore.writes).toEqual([]);
  });

  it('adds to an explicit selection, ignoring duplicates, and previews under dry-run', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    const preview = await editRepoScope(
      h.deps,
      { names: ['fx-example-auth', 'fx-example-api'], dryRun: true, posture: locked },
      'pick',
    );
    expect(preview).toMatchObject({ after: ['fx-example-api', 'fx-example-auth'], written: false });
    expect(h.localStore.writes).toEqual([]);
    await expect(
      editRepoScope(h.deps, { names: ['fx-example-auth'], dryRun: false, posture: locked }, 'pick'),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
  });

  it('rejects a name the manifest does not have', async () => {
    const h = await harness();
    await expect(
      editRepoScope(h.deps, { names: ['ghost'], ...write }, 'pick'),
    ).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
  });
});

describe('RepoAdd / RepoRemove', () => {
  it('registers a local checkout by reference only, taking the upstream from its remotes', async () => {
    const h = await harness();
    const dir = path.join(ROOT, 'scratch');
    h.git.add(dir, { remotes: { upstream: 'ssh://git@git.example.com:12345/lab/scratch.git' } });
    const result = await new RepoAdd(h.deps).execute({ path: dir, ...write });
    expect(result).toMatchObject({
      name: 'scratch',
      repo_path: 'scratch',
      upstream: 'ssh://git@git.example.com:12345/lab/scratch.git',
      written: true,
    });
    expect(h.localStore.writes[0]?.layer).toEqual({
      repos: [
        {
          name: 'scratch',
          path: 'scratch',
          upstream: 'ssh://git@git.example.com:12345/lab/scratch.git',
        },
      ],
    });
  });

  it('refuses a name that collides with a shared repository', async () => {
    const h = await harness();
    await expect(
      new RepoAdd(h.deps).execute({ path: path.join(ROOT, 'fx-example-api'), ...write }),
    ).rejects.toMatchObject({ category: 'conflict', code: 'REPO_EXISTS' });
  });

  it('removes a local entry without touching the directory, and points at unpick for shared ones', async () => {
    const h = await harness({
      local: {
        repos: [{ name: 'scratch', path: 'scratch' }],
        scope: { repos: ['fx-example-api', 'scratch'] },
      },
    });
    h.fs.writeText(path.join(ROOT, 'scratch', 'README'), 'x');
    const result = await new RepoRemove(h.deps).execute({ name: 'scratch', ...write });
    expect(result).toMatchObject({
      removed_from: ['repos', 'scope'],
      directory_kept: true,
      written: true,
    });
    expect(h.localStore.writes[0]?.layer).toEqual({
      repos: [],
      scope: { repos: ['fx-example-api'] },
    });
    expect(await h.fs.exists(path.join(ROOT, 'scratch', 'README'))).toBe(true);
    await expect(
      new RepoRemove(h.deps).execute({ name: 'fx-example-auth', ...write }),
    ).rejects.toMatchObject({
      code: 'REPO_NOT_LOCAL',
      nextSteps: expect.arrayContaining([
        expect.stringContaining('fx repo unpick fx-example-auth'),
      ]),
    });
  });
});

describe('RepoFork', () => {
  it('forks once, adds origin to an existing checkout, and is idempotent', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: 'ssh://git@git.example.com:12345/fx/fx-example-api.git' },
    });
    const first = await new RepoFork(h.deps).execute({ name: 'fx-example-api', ...write });
    expect(first).toMatchObject({
      created: true,
      origin_added: true,
      url: 'ssh://git@git.example.com:12345/~alice/fx-example-api.git',
    });
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-api'))?.remotes['origin']).toBe(
      first.url,
    );
    const second = await new RepoFork(h.deps).execute({ name: 'fx-example-api', ...write });
    expect(second).toMatchObject({ created: false, origin_added: false });
  });

  it('forks the manifest repository and gives its checkout the fork as origin', async () => {
    const source = 'ssh://git@git.example.com:12345/fx/fx-workspace.git';
    const h = await harness({ source, files: { [`${MANIFEST_DIR}/.git/HEAD`]: 'ref: x\n' } });
    h.git.add(MANIFEST_DIR, { remotes: { upstream: source } });
    const rows = await new RepoList(h.deps).execute({});
    expect(rows.at(-1)).toMatchObject({
      name: 'fx-workspace',
      path: MANIFEST_DIR,
      origin: 'manifest',
      picked: true,
      exists: true,
    });
    const forked = await new RepoFork(h.deps).execute({ name: 'fx-workspace', ...write });
    expect(forked).toMatchObject({ created: true, origin_added: true });
    expect(h.codeHost.forks).toEqual(['fx/fx-workspace']);
    expect(h.git.checkouts.get(MANIFEST_DIR)?.remotes['origin']).toBe(forked.url);
  });

  it('explains why a manifest checkout from a directory source cannot be forked', async () => {
    const h = await harness({
      source: path.resolve('/Users/me/fx-workspace'),
      files: { [`${MANIFEST_DIR}/.git/HEAD`]: 'ref: x\n' },
    });
    await expect(
      new RepoFork(h.deps).execute({ name: 'fx-workspace', ...write }),
    ).rejects.toMatchObject({
      code: 'REPO_NOT_FORKABLE',
      nextSteps: [expect.stringContaining('fx init')],
    });
  });

  it('only describes the fork under dry-run', async () => {
    const h = await harness();
    const preview = await new RepoFork(h.deps).execute({
      name: 'fx-example-api',
      dryRun: true,
      posture: locked,
    });
    expect(preview).toMatchObject({ written: false, url: expect.stringContaining('~alice') });
    expect(h.codeHost.forks).toEqual([]);
  });
});
