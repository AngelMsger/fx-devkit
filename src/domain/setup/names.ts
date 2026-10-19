// The two name formats a setup plan mints: a step id, `<tool>.<recipe>[@<env>]`, which
// local.setup, doctor and handoffs quote, and the `setup.<key>` variables an
// environment's setup block supplies to recipe text.

import type { Vars } from '../template.js';

import type { PlanProblem } from './types.js';

export const SERVICE_RECIPE_ID = 'service';

const SETUP_PREFIX = 'setup.';

export function stepId(tool: string, recipe: string, env?: string): string {
  return `${tool}.${recipe}${env === undefined ? '' : `@${env}`}`;
}

export function problemsOfTool(problems: readonly PlanProblem[], tool: string): PlanProblem[] {
  return problems.filter((problem) => problem.step.startsWith(`${tool}.`));
}

export function problemsOfRecipe(problems: readonly PlanProblem[], recipe: string): PlanProblem[] {
  const named = `.${recipe}`;
  return problems.filter(
    (problem) => problem.step.endsWith(named) || problem.step.includes(`${named}@`),
  );
}

export function setupVars(block: Readonly<Record<string, string>> | undefined): Vars {
  return Object.fromEntries(
    Object.entries(block ?? {}).map(([key, value]) => [`${SETUP_PREFIX}${key}`, value]),
  );
}

// The setup-block key a placeholder name reads, or undefined for any other variable.
export function setupKeyOf(variable: string): string | undefined {
  return variable.startsWith(SETUP_PREFIX) ? variable.slice(SETUP_PREFIX.length) : undefined;
}
