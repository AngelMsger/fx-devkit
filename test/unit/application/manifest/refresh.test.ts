import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RefreshManifest,
  refreshWorkspaceManifest,
} from '../../../../src/application/manifest/refresh.js';
import type { ManifestSource, RefreshOutcome } from '../../../../src/ports/manifest-source.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';
import { MANIFEST_DIR, manifestDirFor, ROOT } from '../../../fakes/workspace.js';

function repoSource(outcome: RefreshOutcome = { result: 'updated' }): {
  source: ManifestSource;
  refreshed: string[];
} {
  const refreshed: string[] = [];
  return {
    refreshed,
    source: {
      kind: 'repo',
      description: 'ssh://git@git.example.com:12345/fx/fx-workspace.git',
      materialize: async () => undefined,
      refresh: async (dir) => {
        refreshed.push(dir);
        return outcome;
      },
    },
  };
}

const fileSource: ManifestSource = {
  kind: 'file',
  description: path.resolve('/src/manifest'),
  materialize: async () => undefined,
};

const writable = { readOnly: false, source: 'default' as const };

describe('RefreshManifest', () => {
  it('pulls the source directory only when allowed to write: a dry run plans, read-only is refused', async () => {
    const reporter = new FakeReporter();
    const { source, refreshed } = repoSource();
    const refresh = new RefreshManifest(reporter);
    const base = { manifestDir: MANIFEST_DIR, source, posture: writable };

    const dry = await refresh.execute({ ...base, dryRun: true });
    expect(dry).toEqual({ result: 'planned', source: source.description });
    expect(refreshed).toEqual([]);
    expect(reporter.codes()).toEqual(['MANIFEST_REFRESH_PLANNED']);

    await expect(
      refresh.execute({ ...base, dryRun: false, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(refreshed).toEqual([]);

    const done = await refresh.execute({ ...base, dryRun: false });
    expect(done).toEqual({ result: 'updated', source: source.description });
    expect(refreshed).toEqual([MANIFEST_DIR]);
    expect(reporter.codes()).toEqual(['MANIFEST_REFRESH_PLANNED', 'MANIFEST_REFRESHED']);
  });

  it('tells the person when the checkout was left alone, and why', async () => {
    const reporter = new FakeReporter();
    const { source } = repoSource({ result: 'kept', reason: 'on skill-x, not main' });
    const out = await new RefreshManifest(reporter).execute({
      manifestDir: MANIFEST_DIR,
      source,
      dryRun: false,
      posture: writable,
    });
    expect(out).toEqual({
      result: 'kept',
      reason: 'on skill-x, not main',
      source: source.description,
    });
    expect(reporter.codes()).toEqual(['MANIFEST_REFRESH_KEPT']);
    expect(reporter.notices[0]?.message).toContain('on skill-x, not main');
    const quiet = new FakeReporter();
    const same = repoSource({ result: 'up_to_date' });
    await new RefreshManifest(quiet).execute({
      manifestDir: MANIFEST_DIR,
      source: same.source,
      dryRun: false,
      posture: writable,
    });
    expect(quiet.codes()).toEqual([]);
  });

  it('settles the update check after every fetch, the checkout kept or not', async () => {
    const settled: string[] = [];
    const settle = async (): Promise<void> => {
      settled.push('settled');
    };
    const run = (source: ManifestSource): Promise<unknown> =>
      new RefreshManifest(new FakeReporter()).execute({
        manifestDir: MANIFEST_DIR,
        source,
        dryRun: false,
        posture: writable,
        settle,
      });
    await run(repoSource({ result: 'kept', reason: 'dirty' }).source);
    await run(repoSource({ result: 'updated' }).source);
    await run(repoSource({ result: 'up_to_date' }).source);
    expect(settled).toEqual(['settled', 'settled', 'settled']);
  });

  it('says nothing for a source that cannot refresh, and speaks up when none is recorded', async () => {
    const reporter = new FakeReporter();
    const refresh = new RefreshManifest(reporter);
    const base = { manifestDir: MANIFEST_DIR, dryRun: false, posture: writable };
    expect(await refresh.execute({ ...base, source: fileSource })).toEqual({
      result: 'static',
      source: path.resolve('/src/manifest'),
    });
    expect(reporter.codes()).toEqual([]);
    expect(await refresh.execute({ ...base, source: undefined })).toEqual({
      result: 'unavailable',
      source: null,
    });
    expect(reporter.codes()).toEqual(['MANIFEST_REFRESH_UNAVAILABLE']);
  });
});

function registeredRefresh(options: { busy?: boolean; fail?: 'refresh' | 'settle' } = {}) {
  const { source, refreshed } = repoSource();
  const lock = new FakeLock();
  if (options.busy) lock.busy();
  const events: string[] = [];
  const resolve = {
    cwd: ROOT,
    config: new FakeConfigStore({ workspaces: { fx: { root: ROOT, source: source.description } } }),
    fs: FakeFs.from({}),
    reporter: new FakeReporter(),
    manifestDirFor,
  };
  const deps = {
    lock,
    sourceFor: async (spec: string): Promise<ManifestSource> => {
      expect(spec).toBe(source.description);
      return {
        ...source,
        refresh: async (dir) => {
          expect(lock.unreleased()).toEqual(['workspace:fx']);
          events.push('refresh');
          if (options.fail === 'refresh') throw new Error('refresh failed');
          return source.refresh!(dir);
        },
      };
    },
    settle: async (name: string, dir: string) => {
      expect([name, dir]).toEqual(['fx', MANIFEST_DIR]);
      expect(lock.unreleased()).toEqual(['workspace:fx']);
      events.push('settle');
      if (options.fail === 'settle') throw new Error('settle failed');
    },
  };
  return { deps, resolve, lock, events, refreshed };
}

describe('registered workspace refresh', () => {
  it('refreshes a registered source before an absent manifest can block workspace loading', async () => {
    const s = registeredRefresh();
    await refreshWorkspaceManifest(s.deps, s.resolve, { dryRun: false, posture: writable });
    expect(s.refreshed).toEqual([MANIFEST_DIR]);
    expect(s.lock.requests).toEqual([{ key: 'workspace:fx', waitMs: 2000 }]);
    expect(s.events).toEqual(['refresh', 'settle']);
    expect(s.lock.unreleased()).toEqual([]);
  });

  it('refuses a busy workspace without refreshing or settling it', async () => {
    const s = registeredRefresh({ busy: true });
    await expect(
      refreshWorkspaceManifest(s.deps, s.resolve, { dryRun: false, posture: writable }),
    ).rejects.toMatchObject({ code: 'LOCK_BUSY', nextSteps: ['Retry fx sync shortly.'] });
    expect(s.events).toEqual([]);
  });

  it.each([
    { fail: 'refresh', reached: ['refresh'] },
    { fail: 'settle', reached: ['refresh', 'settle'] },
  ] as const)('releases the workspace when $fail fails', async ({ fail, reached }) => {
    const s = registeredRefresh({ fail });
    await expect(
      refreshWorkspaceManifest(s.deps, s.resolve, { dryRun: false, posture: writable }),
    ).rejects.toThrow(`${fail} failed`);
    expect(s.events).toEqual(reached);
    expect(s.lock.unreleased()).toEqual([]);
  });

  it('creates no lease for a preview or refused read-only refresh', async () => {
    const s = registeredRefresh();
    await refreshWorkspaceManifest(s.deps, s.resolve, { dryRun: true, posture: writable });
    await expect(
      refreshWorkspaceManifest(s.deps, s.resolve, {
        dryRun: false,
        posture: { readOnly: true, source: 'env' },
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(s.lock.requests).toEqual([]);
    expect(s.events).toEqual([]);
  });
});
