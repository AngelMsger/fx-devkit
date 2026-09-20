import { describe, expect, it } from 'vitest';

import { JenkinsCi } from '../../../src/adapters/ci/jenkins-cli/ci.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const GET = ['jenkins-cli', '--format', 'json', 'build', 'get', 'services/a/dev'];
const ok = (data: unknown) => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });
const vars = { path: 'services/a/dev' };

describe('JenkinsCi', () => {
  it('still locates and probes like the template platform', () => {
    const ci = new JenkinsCi(new FakeProcess());
    expect(ci.locate(vars).command).toEqual(['jenkins-cli', 'build', 'list', 'services/a/dev']);
    expect(ci.probe(vars)?.command).toEqual(['jenkins-cli', 'job', 'get', '--', 'services/a/dev']);
  });

  it('reads the last build: its number, status, start and page', async () => {
    const proc = new FakeProcess().on(
      GET,
      ok({
        building: false,
        number: 12,
        result: 'FAILURE',
        status: 'failure',
        started_at: '2026-09-03T04:11:13Z',
        url: 'https://jenkins.example.com/job/services/job/a/job/dev/12/',
      }),
    );
    expect(await new JenkinsCi(proc).lastBuild(vars)).toEqual({
      number: 12,
      status: 'failure',
      startedAt: '2026-09-03T04:11:13Z',
      url: 'https://jenkins.example.com/job/services/job/a/job/dev/12/',
    });
    expect(proc.soleCallTo(GET).options.timeoutMs).toBe(15_000);
  });

  it('calls a build that is still running "building", whatever its result says', async () => {
    const proc = new FakeProcess().on(GET, ok({ building: true, number: 13, status: 'success' }));
    expect((await new JenkinsCi(proc).lastBuild(vars))?.status).toBe('building');
  });

  it('asks the server the coordinate names', async () => {
    const proc = new FakeProcess().on(
      [
        'jenkins-cli',
        '--format',
        'json',
        '--use-context',
        'other',
        'build',
        'get',
        'services/a/dev',
      ],
      ok({ number: 4, status: 'success' }),
    );
    expect((await new JenkinsCi(proc).lastBuild({ ...vars, context: 'other' }))?.number).toBe(4);
  });

  it('refuses a build it cannot number, however green it looks', async () => {
    const proc = new FakeProcess().on(
      GET,
      ok({ status: 'success', started_at: '2026-09-03T04:11:13Z' }),
    );
    await expect(new JenkinsCi(proc).lastBuild(vars)).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
    });
  });

  it('answers undefined for a job that does not exist, and throws for anything else', async () => {
    const missing = new FakeProcess().on(GET, { code: 6, stdout: '', stderr: 'no such job' });
    expect(await new JenkinsCi(missing).lastBuild(vars)).toBeUndefined();
    const refused = new FakeProcess().on(GET, { code: 4, stdout: '', stderr: 'login' });
    await expect(new JenkinsCi(refused).lastBuild(vars)).rejects.toMatchObject({
      code: 'PLATFORM_AUTH',
    });
  });
});

describe('probe context provenance', () => {
  it('uses the selected context and keeps an unexpanded template for recording', () => {
    const ci = new JenkinsCi(new FakeProcess());
    expect(ci.probe({ path: 'services/a/dev', context: 'selected' })).toMatchObject({
      command: ['jenkins-cli', 'job', 'get', '--use-context', 'selected', '--', 'services/a/dev'],
      template: ['jenkins-cli', 'job', 'get', '--use-context', '{context}', '--', '{path}'],
    });
  });
});
