// What the background checks phase records when the worker lends each companion command
// a share of its own deadline: a reuse check it could not ask, or a check that did not
// answer, leaves the logins unchecked, and a check that found a login missing asks for one.

import { expect, it } from 'vitest';

import { DeadlineProcess } from '../../../../src/adapters/process/deadline-process.js';
import { backgroundPhases, type BackgroundDeps } from '../../../../src/application/hook/observe.js';
import { describeProvider } from '../../../../src/composition/registry.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import type { ProcessResult } from '../../../../src/ports/process.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness, MANIFEST_DIR } from '../../../fakes/workspace.js';

const ENVIRONMENTS = `schema_version: 2
platforms:
  logs: {provider: openobserve-cli, capability: log-store, service: {org: default, auth_scheme: session}}
envs:
  dev: {platforms: {logs: {service: {base_url: 'https://logs.example.com', context: dev}}}}
  test: {platforms: {logs: {service: {base_url: 'https://logs.test.example.com', context: test}}}}
`;

const answer = (body: object): ProcessResult => ({
  code: 0,
  stdout: JSON.stringify(body),
  stderr: '',
});

// How each context's sign-in check answers; every other command finds nothing to do.
type Status = 'authenticated' | 'signed-out' | 'hangs';

async function checksPhase(totalMs: number, status: Readonly<Record<string, Status>>) {
  const h = await harness({
    workspace:
      'schema_version: 2\ndefaults: {branch: main}\nrepos: [{name: app, upstream: "https://git.example.com/fx/app.git"}]\n',
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: ENVIRONMENTS,
      [`${MANIFEST_DIR}/manifest/tools.yaml`]:
        'schema_version: 3\ntools: [{name: openobserve-cli}]\n',
    },
  });
  h.process.binaries.add('openobserve-cli');
  h.process.always((vector) => {
    if (vector.includes('--version')) return { code: 0, stdout: '0.14.0', stderr: '' };
    if (!vector.includes('status')) return answer({ changed: false });
    const context = vector[vector.indexOf('--use-context') + 1] ?? '';
    if (status[context] === 'hangs')
      throw new DevkitError('internal', 'PROCESS_TIMEOUT', 'openobserve-cli did not finish');
    return answer({ authenticated: status[context] === 'authenticated' });
  });
  const process = new DeadlineProcess(h.process, { totalMs, commandMs: 15_000 });
  const deps = {
    clock: new FakeClock(),
    context: () => Promise.resolve({ ...h.deps, process }),
    login: fakeLoginDeps({ 'openobserve-cli': describeProvider('openobserve-cli')! }),
  };
  const [observation] = await backgroundPhases(deps as unknown as BackgroundDeps).checks();
  const reuses = h.process.calls.filter((call) => call.vector.includes('reuse'));
  return { code: observation?.code, reuses: reuses.map((call) => call.vector) };
}

it('tells each reuse check how long the run can give it', async () => {
  const { code, reuses } = await checksPhase(60_000, {
    dev: 'authenticated',
    test: 'authenticated',
  });
  expect(reuses).toHaveLength(2);
  for (const vector of reuses) expect(vector.slice(-2)).toEqual(['--timeout', '14s']);
  expect(code).toBe('LOGIN_CHECKED');
});

it('leaves the logins unchecked, not wanting, when the run has too little time to ask', async () => {
  const { code, reuses } = await checksPhase(5_000, {
    dev: 'authenticated',
    test: 'authenticated',
  });
  expect(reuses).toEqual([]);
  expect(code).toBe('LOGIN_UNCHECKED');
});

it('still asks for a login an answered check found missing beside one that did not answer', async () => {
  const { code } = await checksPhase(60_000, { dev: 'hangs', test: 'signed-out' });
  expect(code).toBe('LOGIN_REQUIRED');
});
