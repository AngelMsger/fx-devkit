import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CachedProbe } from '../../../../src/application/update/check.js';
import { ManifestUpdateCheck } from '../../../../src/application/update/manifest.js';
import { manifestOutdated } from '../../../../src/application/update/notices.js';
import { FakeCache } from '../../../fakes/fake-cache.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeGit } from '../../../fakes/fake-git.js';

const DIR = path.resolve('/fx/workspaces/ws/source');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function stage(checkout: Parameters<FakeGit['add']>[1]) {
  const git = new FakeGit().add(DIR, {
    remotes: { upstream: 'ssh://git.example.com/fx/fx-workspace.git' },
    remoteHeads: { upstream: 'main' },
    ...checkout,
  });
  const cache = new FakeCache();
  const check = new ManifestUpdateCheck(new CachedProbe(cache, new FakeClock()), git);
  return { git, cache, check, input: { workspace: 'ws', sourceDir: DIR } };
}

describe('ManifestUpdateCheck', () => {
  it('is behind when the remote HEAD is not what sync last fetched, even from another branch', async () => {
    const s = stage({
      liveHeads: { upstream: { sha: B, branch: 'main' } },
      shas: { 'upstream/main': A },
      state: { branch: 'skill-x', dirty: true, untracked: 0, ahead: 0, behind: 0 },
    });
    const verdict = await s.check.execute(s.input);
    expect(verdict).toMatchObject({
      workspace: 'ws',
      upstream: B,
      fetched: A,
      behind: true,
      source: 'live',
    });
    expect(manifestOutdated(verdict)).toMatchObject({
      code: 'MANIFEST_OUTDATED',
      nextSteps: ['fx sync'],
    });
    expect(s.git.calls).toEqual([`ls-remote ${DIR} upstream`]);
  });

  it('is current when they agree, and asks the remote once per window', async () => {
    const s = stage({
      liveHeads: { upstream: { sha: A, branch: 'main' } },
      shas: { 'upstream/main': A },
    });
    expect((await s.check.execute(s.input)).behind).toBe(false);
    expect((await s.check.execute(s.input)).source).toBe('cache');
    expect(s.git.calls).toHaveLength(1);
    expect(manifestOutdated(await s.check.execute(s.input))).toBeUndefined();
  });

  it('skips a source that is not a clone with an upstream, without asking anyone', async () => {
    const s = stage({ remotes: {}, liveHeads: { upstream: { sha: B, branch: 'main' } } });
    expect(await s.check.execute(s.input)).toMatchObject({ source: 'skipped', behind: false });
    expect(s.git.calls).toEqual([]);
    expect(s.cache.entries.size).toBe(0);
  });

  it('stays silent when the remote does not answer, and remembers that', async () => {
    const s = stage({ liveHeads: { upstream: undefined }, shas: { 'upstream/main': A } });
    const verdict = await s.check.execute(s.input);
    expect(verdict).toMatchObject({
      behind: false,
      upstream: null,
      error: 'upstream did not answer',
    });
    expect((await s.check.execute(s.input)).source).toBe('cache');
    expect(s.git.calls).toHaveLength(1);
  });

  it('takes the default branch from the remote, else from the clone, and never guesses', async () => {
    const trunk = stage({
      remoteHeads: {},
      liveHeads: { upstream: { sha: B, branch: 'trunk' } },
      shas: { 'upstream/trunk': A, 'upstream/main': B },
    });
    expect(await trunk.check.execute(trunk.input)).toMatchObject({ behind: true, fetched: A });
    const recorded = stage({
      remoteHeads: { upstream: 'trunk' },
      liveHeads: { upstream: { sha: B, branch: undefined } },
      shas: { 'upstream/trunk': B },
    });
    expect(await recorded.check.execute(recorded.input)).toMatchObject({
      behind: false,
      fetched: B,
    });
    const unknown = stage({
      remoteHeads: {},
      liveHeads: { upstream: { sha: B, branch: undefined } },
    });
    expect(await unknown.check.execute(unknown.input)).toMatchObject({
      behind: false,
      upstream: null,
      error: 'the default branch of upstream is not known here',
    });
    await unknown.check.markCurrent('ws', DIR);
    expect(unknown.cache.entries.size).toBe(1);
  });

  it('does not trust a cached comparison that is not two commit ids', async () => {
    const s = stage({
      liveHeads: { upstream: { sha: A, branch: 'main' } },
      shas: { 'upstream/main': A },
    });
    await s.cache.set('update/manifest/ws', {
      checked_at: new FakeClock().now().getTime(),
      value: { upstream: 'not-a-sha', fetched: 'also-not' },
    });
    expect(await s.check.execute(s.input)).toMatchObject({ behind: false, source: 'live' });
  });

  it('markCurrent settles the window on what was just fetched', async () => {
    const s = stage({
      liveHeads: { upstream: { sha: B, branch: 'main' } },
      shas: { 'upstream/main': B },
    });
    await s.check.markCurrent('ws', DIR);
    expect(await s.check.execute(s.input)).toMatchObject({
      behind: false,
      upstream: B,
      source: 'cache',
    });
    expect(s.git.calls).toEqual([]);
  });
});
