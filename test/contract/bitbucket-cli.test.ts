// Runs against a real bitbucket-cli that is signed in. Gated by FX_TEST_LIVE=1;
// the host and a readable repository come from the environment so no
// internal address lives in this file.

import { describe, expect, it } from 'vitest';

import { SystemClock } from '../../src/adapters/clock/system-clock.js';
import { BitbucketCodeHost } from '../../src/adapters/code-host/bitbucket-cli/provider.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { NodeProcess } from '../../src/adapters/process/node-process.js';

const live = process.env['FX_TEST_LIVE'] === '1';
const hostVar = process.env['FX_TEST_BITBUCKET_HOST'];
const readable = process.env['FX_TEST_BITBUCKET_REPO'];

describe.skipIf(!live || hostVar === undefined || readable === undefined)(
  'bitbucket-cli (live)',
  () => {
    const host = new BitbucketCodeHost(
      { process: new NodeProcess(), fs: new NodeFs(), clock: new SystemClock() },
      { host: hostVar ?? '' },
    );
    const [project = '', name = ''] = (readable ?? '').split('/');

    it('either knows who I am or says so with the config.user next step', async () => {
      try {
        expect((await host.whoami()).user.length).toBeGreaterThan(0);
      } catch (err) {
        expect(err).toMatchObject({
          code: 'CODE_HOST_AUTH',
          nextSteps: expect.arrayContaining([expect.stringContaining('fx config set user')]),
        });
      }
    });

    it('reads a repository I can see and reports a nonexistent one as missing', async () => {
      expect(await host.canRead({ project, name })).toBe('readable');
      expect(await host.canRead({ project, name: 'definitely-not-a-repo-xyz' })).toBe('missing');
    });
  },
);
