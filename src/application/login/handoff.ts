// How an undone step is put into a person's hands: the wire shape of one
// step, and the fx command that walks exactly the pending set.

import type { HandoffStep } from '../../domain/errors.js';
import type { SetupStep } from '../../domain/setup/types.js';

export function handoffStep(step: SetupStep): HandoffStep {
  return {
    id: step.id,
    kind: step.kind,
    title: step.title,
    ...(step.instructions === undefined ? {} : { instructions: step.instructions }),
    ...(step.open === undefined ? {} : { open: step.open }),
    ...(step.expects === undefined ? {} : { expects: step.expects }),
    ...(step.run === undefined ? {} : { command: step.run }),
  };
}

export function loginCommand(steps: readonly SetupStep[]): string {
  const tools = [...new Set(steps.map((s) => s.tool))];
  const envs = [...new Set(steps.flatMap((s) => (s.env === undefined ? [] : [s.env])))];
  return ['fx login', ...tools, ...envs.flatMap((e) => ['--env', e])].join(' ');
}
