// A failed check is read by the cases its recipe declares. The tool's own words stay
// the detail; a case adds what is wrong and what resolves it, and silence adds nothing.

import { expect, it } from 'vitest';

import { Verifier } from '../../../../src/application/login/verify.js';
import type { SetupStep } from '../../../../src/domain/setup/types.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness } from '../../../fakes/workspace.js';

function step(origin: SetupStep['origin'] = 'base'): SetupStep {
  return {
    id: 'tool.access',
    tool: 'check',
    kind: 'manual',
    title: 'Confirm access',
    instructions: 'The check asks the service.',
    verify: {
      command: ['check'],
      failures: [
        {
          cause: 'credential',
          stderr: 'Unauthorized',
          instructions: 'Renew the credential.',
          open: 'https://console.example.com/',
        },
        { cause: 'permission', exitCode: 1, stdout: '^no$', instructions: 'Ask the owner.' },
      ],
    },
    requires: [],
    origin,
    required: false,
  };
}

it('names the cause and the recovery of a failure its recipe can read', async () => {
  const h = await harness();
  h.process.on(['check'], { code: 1, stdout: '', stderr: 'error: Unauthorized\n' });
  expect(await new Verifier(h.deps, fakeLoginDeps({})).verify(step())).toEqual({
    ok: false,
    detail: 'error: Unauthorized',
    cause: 'credential',
    recovery: { instructions: 'Renew the credential.', open: 'https://console.example.com/' },
  });
  h.process.clear().on(['check'], { code: 1, stdout: 'no', stderr: '' });
  expect(await new Verifier(h.deps, fakeLoginDeps({})).verify(step())).toEqual({
    ok: false,
    detail: 'exit 1',
    cause: 'permission',
    recovery: { instructions: 'Ask the owner.' },
  });
});

it('keeps only the tool own words for a failure no case answers to', async () => {
  const h = await harness();
  h.process.on(['check'], { code: 1, stdout: '', stderr: 'x509: certificate has expired\n' });
  expect(await new Verifier(h.deps, fakeLoginDeps({})).verify(step())).toEqual({
    ok: false,
    detail: 'x509: certificate has expired',
  });
});

it('reads no failure into a check that passed', async () => {
  const h = await harness();
  h.process.on(['check'], { code: 0, stdout: 'yes', stderr: 'Warning: Unauthorized plugin' });
  expect(await new Verifier(h.deps, fakeLoginDeps({})).verify(step())).toEqual({
    ok: true,
    detail: 'the check passed',
  });
});

it('fails as a missing tool, not as a failed check, when the tool could not start', async () => {
  const h = await harness();
  h.process.on(['check'], {
    code: 127,
    stdout: '',
    stderr: 'command not found: check\n',
    notStarted: true,
  });
  await expect(new Verifier(h.deps, fakeLoginDeps({})).verify(step())).rejects.toMatchObject({
    code: 'TOOL_MISSING',
    message: 'check is not installed or not on PATH',
    nextSteps: ['fx tool show check --workspace fx', 'fx tool install check --workspace fx'],
  });
});

it('keeps the words of a tool that started and exited 127 on its own account', async () => {
  const h = await harness();
  h.process.on(['check'], { code: 127, stdout: '', stderr: 'helper executable unavailable\n' });
  expect(await new Verifier(h.deps, fakeLoginDeps({})).verify(step())).toEqual({
    ok: false,
    detail: 'helper executable unavailable',
  });
});

it('marks a check it withheld under a dry run, which says nothing about the step', async () => {
  const h = await harness();
  const result = await new Verifier(h.deps, fakeLoginDeps({})).verify(step('patch'), {
    dryRun: true,
  });
  expect(result).toEqual({
    ok: false,
    detail: 'manifest command is not trusted',
    withheld: true,
  });
  expect(h.process.calls).toEqual([]);
});
