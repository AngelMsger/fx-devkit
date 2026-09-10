// A successful status command may report that authentication is absent.
// Readiness must check the declared JSON result, without exposing its data.

import { expect, it } from 'vitest';

import { Verifier } from '../../../src/application/login/verify.js';
import { fakeLoginDeps } from '../../fakes/fake-login-deps.js';
import { harness } from '../../fakes/workspace.js';

it('does not treat an unauthenticated JSON status as ready just because it exited zero', async () => {
  const h = await harness();
  h.process.on(['check'], {
    code: 0,
    stdout: '{"authenticated":false,"secret":"private-value"}',
    stderr: '',
  });
  const result = await new Verifier(h.deps, fakeLoginDeps({})).verify({
    id: 'tool.auth',
    tool: 'check',
    kind: 'manual',
    title: 'Authenticate',
    verify: { command: ['check'], json: { path: 'authenticated', equals: true } },
    requires: [],
    origin: 'base',
    required: false,
  });
  expect(result.ok).toBe(false);
  expect(result.detail).not.toContain('private-value');
});
