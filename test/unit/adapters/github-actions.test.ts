import { describe, expect, it } from 'vitest';

import { GitHubActionsCi } from '../../../src/adapters/ci/github-actions/ci.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const RUNS = ['gh', 'run', 'list', '--repo', 'octo/tool', '--workflow', 'ci.yml'];
const vars = { repository: 'octo/tool', workflow: 'ci.yml' };
const runs = (...data: unknown[]) => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });
const run = (fields: Record<string, unknown>) => ({
  number: 97,
  startedAt: '2026-10-12T07:02:49Z',
  createdAt: '2026-10-12T07:02:40Z',
  url: 'https://github.com/octo/tool/actions/runs/1',
  ...fields,
});

describe('GitHubActionsCi', () => {
  it('locates and probes through gh run list, narrowed as the coordinate says', () => {
    const ci = new GitHubActionsCi(new FakeProcess());
    const narrowed = { ...vars, branch: 'main', event: 'push' };
    expect(ci.locate(narrowed)).toMatchObject({
      label: 'GitHub Actions workflow ci.yml in octo/tool',
      command: [...RUNS, '--branch', 'main', '--event', 'push'],
    });
    expect(ci.probe(vars)?.command).toEqual(RUNS);
  });

  it('reads the latest run of the branch and trigger: number, status, start and page', async () => {
    const proc = new FakeProcess().on(
      RUNS,
      runs(run({ status: 'completed', conclusion: 'success' })),
    );
    const build = await new GitHubActionsCi(proc).lastBuild({
      ...vars,
      branch: 'main',
      event: 'push',
    });
    expect(build).toEqual({
      number: 97,
      status: 'success',
      startedAt: '2026-10-12T07:02:49Z',
      url: 'https://github.com/octo/tool/actions/runs/1',
    });
    const call = proc.soleCallTo(RUNS);
    expect(call.vector.slice(RUNS.length)).toEqual([
      '--branch',
      'main',
      '--event',
      'push',
      '--limit',
      '1',
      '--json',
      'number,status,conclusion,startedAt,createdAt,url',
    ]);
    expect(call.options.timeoutMs).toBe(15_000);
  });

  it.each([
    ['in_progress', null, 'building'],
    ['queued', null, 'building'],
    ['completed', 'failure', 'failure'],
    ['completed', 'timed_out', 'failure'],
    ['completed', 'cancelled', 'aborted'],
    ['completed', 'skipped', 'not_built'],
    ['completed', 'action_required', 'unknown'],
  ])('reads a %s run concluded %s as %s', async (status, conclusion, expected) => {
    const proc = new FakeProcess().on(RUNS, runs(run({ status, conclusion })));
    expect((await new GitHubActionsCi(proc).lastBuild(vars))?.status).toBe(expected);
  });

  it('answers undefined for a missing workflow and for a branch it never ran on', async () => {
    const missing = new FakeProcess().on(RUNS, {
      code: 1,
      stdout: '',
      stderr: 'HTTP 404: workflow ci.yml not found on the default branch',
    });
    expect(await new GitHubActionsCi(missing).lastBuild(vars)).toBeUndefined();
    const never = new FakeProcess().on(RUNS, runs());
    expect(await new GitHubActionsCi(never).lastBuild(vars)).toBeUndefined();
  });

  it('throws for a run it cannot number and for a refused sign-in', async () => {
    const unnumbered = new FakeProcess().on(RUNS, runs({ status: 'completed' }));
    await expect(new GitHubActionsCi(unnumbered).lastBuild(vars)).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
    });
    const refused = new FakeProcess().on(RUNS, {
      code: 1,
      stdout: '',
      stderr: 'HTTP 401: Bad credentials (https://api.github.com/repos/octo/tool)',
    });
    await expect(new GitHubActionsCi(refused).lastBuild(vars)).rejects.toMatchObject({
      code: 'PLATFORM_AUTH',
    });
  });
});
