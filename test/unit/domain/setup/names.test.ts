import { describe, expect, it } from 'vitest';

import {
  problemsOfRecipe,
  problemsOfTool,
  setupKeyOf,
  setupVars,
  stepId,
} from '../../../../src/domain/setup/names.js';
import type { PlanProblem } from '../../../../src/domain/setup/types.js';

function problem(step: string): PlanProblem {
  return { step, reason: 'missing_vars', detail: step };
}

describe('step ids', () => {
  const problems = [
    problem(stepId('kubectl', 'service', 'dev')),
    problem(stepId('kubectl', 'context', 'dev')),
    problem(stepId('kube', 'service')),
    problem(stepId('sentry', 'services')),
  ];

  it('selects the problems of one tool without those of a tool it is a prefix of', () => {
    expect(problemsOfTool(problems, 'kube').map((p) => p.step)).toEqual(['kube.service']);
    expect(problemsOfTool(problems, 'kubectl').map((p) => p.step)).toEqual([
      'kubectl.service@dev',
      'kubectl.context@dev',
    ]);
  });

  it('selects the problems of one recipe with and without an environment', () => {
    expect(problemsOfRecipe(problems, 'service').map((p) => p.step)).toEqual([
      'kubectl.service@dev',
      'kube.service',
    ]);
  });
});

describe('setup variables', () => {
  it('reads back the block key a setup variable was built from, and no other variable', () => {
    const vars = setupVars({ source: 'https://wiki.example.com/kubeconfig' });
    expect(Object.keys(vars).map(setupKeyOf)).toEqual(['source']);
    expect(setupKeyOf('namespace')).toBeUndefined();
    expect(setupVars(undefined)).toEqual({});
  });
});
