// Runs the Jenkins query adapter against a configured, authenticated CLI;
// the job comes from the environment so no internal coordinate enters source.

import { describe, expect, it } from 'vitest';

import { JenkinsCi } from '../../src/adapters/ci/jenkins-cli/ci.js';
import { NodeProcess } from '../../src/adapters/process/node-process.js';

const live = process.env['FX_TEST_LIVE'] === '1';
const job = process.env['FX_TEST_JENKINS_JOB'];
const context = process.env['FX_TEST_JENKINS_CONTEXT'];

describe.skipIf(!live || job === undefined)('jenkins-cli (live)', () => {
  it('reads a known job through the real build response contract', async () => {
    const ci = new JenkinsCi(new NodeProcess());
    const build = await ci.lastBuild({
      path: job ?? '',
      ...(context === undefined ? {} : { context }),
    });

    expect(build).toEqual(
      expect.objectContaining({
        number: expect.any(Number),
        status: expect.stringMatching(
          /^(success|failure|unstable|aborted|building|not_built|unknown)$/,
        ),
      }),
    );
  });
});
