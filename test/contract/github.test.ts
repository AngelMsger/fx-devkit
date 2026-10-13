// Runs the GitHub code host and the GitHub Actions adapter against a real, signed-in
// gh. Gated by FX_TEST_LIVE=1; a readable repository and one of its workflows come
// from the environment, e.g. FX_TEST_GITHUB_REPO=AngelMsger/fx-devkit and
// FX_TEST_GITHUB_WORKFLOW=ci.yml.

import { describe, expect, it } from 'vitest';

import { GitHubActionsCi } from '../../src/adapters/ci/github-actions/ci.js';
import { SystemClock } from '../../src/adapters/clock/system-clock.js';
import { GitHubCodeHost } from '../../src/adapters/code-host/github/provider.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { NodeProcess } from '../../src/adapters/process/node-process.js';

const live = process.env['FX_TEST_LIVE'] === '1';
const repository = process.env['FX_TEST_GITHUB_REPO'];
const workflow = process.env['FX_TEST_GITHUB_WORKFLOW'];

describe.skipIf(!live || repository === undefined)('gh code host (live)', () => {
  const host = new GitHubCodeHost(
    { process: new NodeProcess(), fs: new NodeFs(), clock: new SystemClock() },
    { host: 'https://github.com' },
  );
  const [project = '', name = ''] = (repository ?? '').split('/');
  const ref = { project, name };

  it('reads branches, a commit, a range and a file through the real API', async () => {
    const branches = await host.branches(ref);
    const main = branches.find((b) => b.default);
    expect(main?.sha).toMatch(/^[0-9a-f]{40}$/);
    const head = await host.commit(ref, main?.sha ?? '');
    expect(head).toMatchObject({ sha: main?.sha, date: expect.stringMatching(/^\d{4}-/) });
    const parent = head.parents[0] ?? '';
    const range = await host.compare(ref, { from: parent, to: head.sha });
    expect(range.map((c) => c.sha)).toContain(head.sha);
    expect(await host.compare(ref, { from: head.sha, to: parent })).toEqual([]);
    expect(await host.readFile(ref, 'README.md', head.sha)).toContain('#');
    expect(await host.readFile(ref, 'definitely-not-here.txt', head.sha)).toBeUndefined();
  });

  it('reads a repository it can see', async () => {
    expect(await host.canRead(ref)).toBe('readable');
  });
});

describe.skipIf(!live || repository === undefined || workflow === undefined)(
  'gh Actions (live)',
  () => {
    const ci = new GitHubActionsCi(new NodeProcess());
    const vars = { repository: repository ?? '', workflow: workflow ?? '' };

    it('reads the last run of a workflow on a branch, and none of one that does not exist', async () => {
      const build = await ci.lastBuild(vars, { branch: 'main' });
      expect(build).toEqual(
        expect.objectContaining({
          number: expect.any(Number),
          status: expect.stringMatching(
            /^(success|failure|unstable|aborted|building|not_built|unknown)$/,
          ),
          url: expect.stringContaining('/actions/runs/'),
          commit: expect.stringMatching(/^[0-9a-f]{40}$/),
        }),
      );
      expect(
        await ci.lastBuild({ ...vars, workflow: 'definitely-not-here.yml' }, { branch: 'main' }),
      ).toBeUndefined();
    });
  },
);
