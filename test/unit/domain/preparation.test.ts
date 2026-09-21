import { expect, it } from 'vitest';

import {
  preparation,
  preparationCheck,
  preparationScope,
  type PreparationAction,
} from '../../../src/domain/preparation.js';

it('keeps optional native activation separate from the required work and never calls a preview ready', () => {
  const scope = preparationScope('work', ['repos', 'hooks']);
  const checks = [
    preparationCheck('repo:api', 'ready', 'Cloned'),
    preparationCheck('hook:codex', 'unknown', 'Native activation unverified', { required: false }),
  ];
  expect(preparation({ scope, checks })).toMatchObject({
    state: 'ready',
    next: { kind: 'complete' },
    blockers: [],
    warnings: [{ id: 'hook:codex' }],
  });
  expect(preparation({ scope, checks, preview: true })).toMatchObject({
    state: 'planned',
    next: { kind: 'review' },
    completed: [],
  });
});

it('retains completed work and specific blockers until fresh verification establishes readiness', () => {
  const scope = preparationScope('work', ['repos', 'setup']);
  const ready = preparationCheck('repo:api', 'ready', 'Cloned');
  const userAction: PreparationAction = {
    id: 'sign-in',
    actor: 'user',
    description: 'Personal sign-in',
    argv: ['tool', 'login'],
    cwd: '/work',
    requires_approval: true,
  };
  const resume: PreparationAction = {
    id: 'resume',
    actor: 'agent',
    description: 'Continue after access changes',
    argv: ['fx', 'init', '--resume', '--workspace', 'work'],
    cwd: '/work',
    requires_approval: false,
  };
  const missing = preparationCheck('tool:access', 'blocked', 'Operator access is missing', {
    owner: 'user',
    actions: [userAction],
  });
  expect(preparation({ scope, checks: [ready, missing], resume })).toMatchObject({
    state: 'incomplete',
    next: { kind: 'handoff' },
    next_actions: [],
    resume,
    completed: ['repo:api'],
    blockers: [missing],
  });
  const verifyAction = { ...resume, id: 'verify', requires_approval: true };
  expect(
    preparation({ scope, checks: [ready, { ...missing, actions: [verifyAction] }], resume }),
  ).toMatchObject({ next: { kind: 'act' }, next_actions: [verifyAction], resume });
  expect(preparation({ scope, checks: [ready, { ...missing, state: 'ready' }] })).toMatchObject({
    state: 'ready',
    blockers: [],
  });
});
