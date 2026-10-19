// Where a step stands follows from what its prerequisites came to: one that did not pass
// blocks it, one whose check gave no answer leaves it unanswered, and unanswered wins
// wherever both hold it back.

import { describe, expect, it } from 'vitest';

import {
  SetupProgress,
  unansweredSteps,
  type StepConclusion,
} from '../../../../src/domain/setup/progress.js';

interface Walked {
  readonly id: string;
  readonly requires?: readonly string[];
  // What the step's own check comes to when no prerequisite holds it back.
  readonly check?: StepConclusion;
}

function walk(steps: readonly Walked[]): Record<string, string> {
  const progress = new SetupProgress();
  const standings: Record<string, string> = {};
  for (const { id, requires = [], check = 'done' } of steps) {
    const step = { id, requires };
    const standing = progress.admit(step);
    standings[id] = standing.kind === 'clear' ? 'clear' : `${standing.kind} by ${standing.by}`;
    if (standing.kind === 'clear') progress.record(step, check);
  }
  return standings;
}

const role: Walked = { id: 'role', check: 'undone' };
const token: Walked = { id: 'token', check: 'unanswered' };

describe('the standing of a step', () => {
  it.each<[string, readonly Walked[], Record<string, string>]>([
    [
      'is clear behind prerequisites that are done',
      [{ id: 'token' }, { id: 'quota', requires: ['token'] }],
      { quota: 'clear' },
    ],
    [
      'is clear for a step that requires nothing, whatever the others came to',
      [role, token, { id: 'quota' }],
      { quota: 'clear' },
    ],
    [
      'is blocked behind a prerequisite that did not pass',
      [role, { id: 'quota', requires: ['role'] }],
      { quota: 'blocked by role' },
    ],
    [
      'is unanswered behind a check that gave no answer',
      [token, { id: 'quota', requires: ['token'] }],
      { quota: 'unanswered by token' },
    ],
    [
      'is unanswered behind both, the one that did not pass listed first',
      [role, token, { id: 'quota', requires: ['role', 'token'] }],
      { quota: 'unanswered by token' },
    ],
    [
      'is unanswered behind both, the unanswered one listed first',
      [role, token, { id: 'quota', requires: ['token', 'role'] }],
      { quota: 'unanswered by token' },
    ],
    [
      'stays blocked down a chain',
      [role, { id: 'quota', requires: ['role'] }, { id: 'report', requires: ['quota'] }],
      { quota: 'blocked by role', report: 'blocked by quota' },
    ],
    [
      'stays unanswered down a chain',
      [token, { id: 'quota', requires: ['token'] }, { id: 'report', requires: ['quota'] }],
      { quota: 'unanswered by token', report: 'unanswered by quota' },
    ],
    [
      'is unanswered behind a blocked step and an unanswered one',
      [
        role,
        token,
        { id: 'quota', requires: ['role'] },
        { id: 'report', requires: ['quota', 'token'] },
      ],
      { quota: 'blocked by role', report: 'unanswered by token' },
    ],
  ])('%s', (_name, steps, expected) => {
    expect(walk(steps)).toMatchObject(expected);
  });
});

describe('the first prerequisite that is not done', () => {
  const after = (...steps: readonly Walked[]): SetupProgress => {
    const progress = new SetupProgress();
    for (const { id, check = 'done' } of steps) progress.record({ id, requires: [] }, check);
    return progress;
  };

  it.each<[readonly string[], string | undefined]>([
    [['role', 'token'], 'role'],
    [['token', 'role'], 'token'],
    [['ready', 'token'], 'token'],
    [['ready'], undefined],
    [[], undefined],
  ])('follows the order a step lists them in, unanswered or not: %j', (requires, expected) => {
    const progress = after(role, token, { id: 'ready' });
    expect(progress.undonePrerequisite({ id: 'quota', requires })).toBe(expected);
  });
});

describe('the unanswered steps of a finished walk', () => {
  const steps = [
    { id: 'role', requires: [] },
    { id: 'token', requires: [] },
    { id: 'quota', requires: ['role', 'token'] },
    { id: 'report', requires: ['quota'] },
    { id: 'audit', requires: ['role'] },
  ];

  it.each<[readonly string[], readonly string[]]>([
    [['token'], ['token', 'quota', 'report']],
    [['role'], ['role', 'quota', 'report', 'audit']],
    [['report'], ['report']],
    [[], []],
  ])('are the checks that gave no answer and every step behind one: %j', (own, expected) => {
    const unanswered = unansweredSteps(steps, (step) => own.includes(step.id));
    expect([...unanswered]).toEqual(expected);
  });
});
