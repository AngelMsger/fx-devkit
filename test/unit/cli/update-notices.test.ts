import { describe, expect, it, vi } from 'vitest';

import { CachedProbe } from '../../../src/application/update/check.js';
import { FxUpdateCheck } from '../../../src/application/update/fx.js';
import { ManifestUpdateCheck } from '../../../src/application/update/manifest.js';
import { PROBE_TIMEOUT_MS } from '../../../src/application/update/policy.js';
import { shouldCheckUpdates, updateNotices } from '../../../src/cli/update-notices.js';
import { FakeCache } from '../../fakes/fake-cache.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeGit } from '../../fakes/fake-git.js';
import { FakeRegistry } from '../../fakes/fake-registry.js';
import { HeldWork } from '../../held-work.js';

const DIR = '/fx/workspaces/ws/source';

function checks(latest: string | Error, upstreamSha: string | undefined) {
  const probe = new CachedProbe(new FakeCache(), new FakeClock());
  const git = new FakeGit().add(DIR, {
    remotes: { upstream: 'ssh://git.example.com/fx/fx-workspace.git' },
    remoteHeads: { upstream: 'main' },
    liveHeads: {
      upstream: upstreamSha === undefined ? undefined : { sha: upstreamSha, branch: 'main' },
    },
    shas: { 'upstream/main': 'a'.repeat(40) },
  });
  return {
    fx: new FxUpdateCheck(probe, () => new FakeRegistry(latest)),
    manifest: new ManifestUpdateCheck(probe, git),
  };
}

const FX = { current: '0.1.0', packageName: '@fx/devkit', registry: 'https://npm.example.com' };

describe('shouldCheckUpdates', () => {
  it('checks for an ordinary command, and not when disabled, quiet, or for the remedies themselves', () => {
    expect(shouldCheckUpdates({ id: 'status', quiet: false, enabled: true })).toBe(true);
    expect(shouldCheckUpdates({ id: 'status', quiet: false, enabled: false })).toBe(false);
    expect(shouldCheckUpdates({ id: 'status', quiet: true, enabled: true })).toBe(false);
    expect(shouldCheckUpdates({ id: 'self:update', quiet: false, enabled: true })).toBe(false);
    expect(shouldCheckUpdates({ id: 'completion', quiet: false, enabled: true })).toBe(false);
    for (const id of [
      'skill:install',
      'skill:uninstall',
      'skill:update',
      'skill:status',
      'skill:path',
      'skill:show',
      'skill:list',
    ])
      expect(shouldCheckUpdates({ id, quiet: false, enabled: true })).toBe(false);
    expect(shouldCheckUpdates({ id: undefined, quiet: false, enabled: true })).toBe(false);
  });
});

describe('updateNotices', () => {
  it('says manifest first, then fx, and only what is behind', async () => {
    const both = await updateNotices(checks('0.2.0', 'b'.repeat(40)), FX, {
      workspace: 'ws',
      sourceDir: DIR,
    });
    expect(both.map((n) => n.code)).toEqual(['MANIFEST_OUTDATED', 'FX_OUTDATED']);
    const fxOnly = await updateNotices(checks('0.2.0', 'a'.repeat(40)), FX, undefined);
    expect(fxOnly.map((n) => n.code)).toEqual(['FX_OUTDATED']);
    expect(
      await updateNotices(checks('0.1.0', 'a'.repeat(40)), FX, { workspace: 'ws', sourceDir: DIR }),
    ).toEqual([]);
  });

  it('is silent when a check fails, and one throwing does not silence the other', async () => {
    const both = { workspace: 'ws', sourceDir: DIR };
    expect(await updateNotices(checks(new Error('503'), undefined), FX, both)).toEqual([]);
    const broken = checks('0.2.0', 'b'.repeat(40));
    broken.manifest.execute = () => Promise.reject(new Error('boom'));
    expect((await updateNotices(broken, FX, both)).map((n) => n.code)).toEqual(['FX_OUTDATED']);
  });

  it('runs the two checks side by side', async () => {
    const both = { workspace: 'ws', sourceDir: DIR };
    const held = checks('0.2.0', 'b'.repeat(40));
    const running = new HeldWork<string>();
    const fxExecute = held.fx.execute.bind(held.fx);
    const manifestExecute = held.manifest.execute.bind(held.manifest);
    held.fx.execute = async (input) => {
      await running.hold('fx');
      return fxExecute(input);
    };
    held.manifest.execute = async (input) => {
      await running.hold('manifest');
      return manifestExecute(input);
    };
    const notices = updateNotices(held, FX, both);
    await running.reached(1);
    expect([...running.started].sort(), 'neither waits for the other to finish').toEqual([
      'fx',
      'manifest',
    ]);
    running.releaseAll();
    expect(await notices).toHaveLength(2);
  });

  it("does not put a check's local work under the upstream deadline", async () => {
    vi.useFakeTimers();
    try {
      const slow = checks('0.2.0', 'b'.repeat(40));
      let release = (): void => undefined;
      slow.fx.execute = () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              current: '0.1.0',
              latest: '0.2.0',
              behind: true,
              registry: FX.registry,
              source: 'live',
            });
        });
      let settled = false;
      const pending = updateNotices(slow, FX, undefined).then((notices) => {
        settled = true;
        return notices;
      });

      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
      expect(settled).toBe(false);
      release();
      expect((await pending).map((notice) => notice.code)).toEqual(['FX_OUTDATED']);
    } finally {
      vi.useRealTimers();
    }
  });
});
