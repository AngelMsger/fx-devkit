import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { Status } from '../../../../src/application/workspace/status.js';
import { FakeGit } from '../../../fakes/fake-git.js';
import { harness, ROOT } from '../../../fakes/workspace.js';
import { HeldWork } from '../../../held-work.js';

const upstream = (name: string): string => `ssh://git@git.example.com:12345/fx/${name}.git`;
const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };

describe('Status', () => {
  it('inspects no more than --jobs repositories at once', async () => {
    const h = await harness();
    const inspecting = new HeldWork<string>();
    const git = new (class extends FakeGit {
      override async status(dir: string) {
        await inspecting.hold(dir);
        return super.status(dir);
      }
    })();
    for (const name of ['fx-example-api', 'fx-example-auth', 'fx-example-docs']) {
      const dir = path.join(ROOT, name);
      h.git.add(dir, { remotes: { upstream: upstream(name) } });
      git.add(dir, { remotes: { upstream: upstream(name) } });
    }

    const rows = new Status({ ...h.deps, git }).execute({
      fetch: false,
      dirtyOnly: false,
      jobs: 2,
    });
    await inspecting.reached(2);
    expect(inspecting.started).toHaveLength(2);
    inspecting.releaseAll();
    expect(await rows).toHaveLength(3);
  });

  it('reports every tracked repository without fetching by default', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    h.git.add(path.join(ROOT, 'fx-example-auth'), {
      remotes: { upstream: upstream('fx-example-auth') },
      state: { branch: 'feature/x', dirty: true, untracked: 0, ahead: 0, behind: 0 },
    });
    const rows = await new Status(h.deps).execute({
      fetch: false,
      dirtyOnly: false,
    });
    expect(rows.map((r) => [r.name, r.exists, r.note])).toEqual([
      ['fx-example-api', true, null],
      ['fx-example-auth', true, 'on feature/x'],
      ['fx-example-docs', false, 'not cloned'],
    ]);
    expect(h.git.calls.filter((c) => c.startsWith('fetch'))).toEqual([]);
  });

  it('fetches every checkout under --fetch and lists only dirty ones under --dirty', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    h.git.add(path.join(ROOT, 'fx-example-auth'), {
      remotes: { upstream: upstream('fx-example-auth') },
      state: { branch: 'main', dirty: true, untracked: 0, ahead: 0, behind: 0 },
    });
    const rows = await new Status(h.deps).execute({
      fetch: true,
      dirtyOnly: true,
      dryRun: false,
      posture: writable,
    });
    expect(rows.map((r) => r.name)).toEqual(['fx-example-auth']);
    expect(rows[0]?.fetch).toBe('completed');
    expect(h.git.calls.filter((c) => c.startsWith('fetch'))).toHaveLength(2);
    // A watcher counts every repository inspected, then each checkout fetched.
    expect(h.activity.of('repos').at(-1)).toMatchObject({ total: 3, completed: 3 });
    expect(h.activity.of('fetch').at(-1)).toMatchObject({ total: 2, completed: 2 });
  });

  it('includes untracked-only work in --dirty without changing tracked dirtiness', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      state: { branch: 'dev', dirty: false, untracked: 2, ahead: 0, behind: 0 },
    });
    const rows = await new Status(h.deps).execute({ fetch: false, dirtyOnly: true });
    expect(rows).toMatchObject([
      { name: 'fx-example-api', dirty: false, untracked: 2, uncommitted: true },
    ]);
    const empty = await harness({ local: { scope: { repos: [] } } });
    expect(await new Status(empty.deps).execute({ fetch: false, dirtyOnly: true })).toEqual([]);
  });

  it('previews every fetch before the write gate and applies none of them', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    h.git.add(path.join(ROOT, 'fx-example-auth'), {
      remotes: { upstream: upstream('fx-example-auth') },
    });

    const preview = await new Status(h.deps).execute({
      fetch: true,
      dirtyOnly: false,
      dryRun: true,
      posture: locked,
    });
    expect(preview.map((row) => [row.name, row.fetch])).toEqual([
      ['fx-example-api', 'planned'],
      ['fx-example-auth', 'planned'],
      ['fx-example-docs', 'not_applicable'],
    ]);
    expect(h.git.calls.filter((call) => call.startsWith('fetch'))).toEqual([]);

    await expect(
      new Status(h.deps).execute({
        fetch: true,
        dirtyOnly: false,
        dryRun: false,
        posture: locked,
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(h.git.calls.filter((call) => call.startsWith('fetch'))).toEqual([]);
  });

  it('flags a checkout whose upstream remote differs from the manifest', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: 'ssh://git@elsewhere.example.com/x.git' },
    });
    const rows = await new Status(h.deps).execute({
      fetch: false,
      dirtyOnly: false,
    });
    expect(rows[0]).toMatchObject({
      remotes_ok: false,
      note: expect.stringContaining('elsewhere'),
    });
  });
});
