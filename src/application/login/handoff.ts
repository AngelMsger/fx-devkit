// How an undone step is put into a person's hands: the wire shape of one step, with
// what its check last said, and the fx command that walks exactly the pending set.

import type { HandoffStep } from '../../domain/errors.js';
import type { SetupStep } from '../../domain/setup/types.js';
import { workspaceCommand, type WorkspaceGuidance } from '../workspace/guidance.js';

import type { Verdict } from './verify.js';

// What keeps a step pending: its own check's answer, or the prerequisite it waits on.
export type Pending = { readonly failed: Verdict } | { readonly blockedBy: string };

export function handoffStep(step: SetupStep, pending?: Pending): HandoffStep {
  const failed = pending !== undefined && 'failed' in pending ? pending.failed : undefined;
  // A failure the recipe can read brings its own guidance, page included.
  const { instructions, open } = failed?.recovery ?? step;
  return {
    id: step.id,
    kind: step.kind,
    title: step.title,
    ...(instructions === undefined ? {} : { instructions }),
    ...(open === undefined ? {} : { open }),
    ...(step.expects === undefined ? {} : { expects: step.expects }),
    ...(step.run === undefined ? {} : { command: step.run }),
    ...(pending === undefined ? {} : checked(pending)),
  };
}

// A check that was withheld never ran, so it leaves nothing to report.
function checked(pending: Pending): Pick<HandoffStep, 'check'> {
  if ('blockedBy' in pending) return { check: { result: 'blocked', by: pending.blockedBy } };
  const { detail, cause, withheld } = pending.failed;
  if (withheld) return {};
  return { check: { result: 'failed', detail, ...(cause === undefined ? {} : { cause }) } };
}

// The file a step expects in place, whichever way its check looks for it.
export function expectedPath(step: SetupStep): string | undefined {
  return step.expects?.path ?? ('file' in step.verify ? step.verify.file : undefined);
}

export function loginCommand(steps: readonly SetupStep[], context: WorkspaceGuidance): string {
  const tools = [...new Set(steps.map((s) => s.tool))];
  const envs = [...new Set(steps.flatMap((s) => (s.env === undefined ? [] : [s.env])))];
  return workspaceCommand(context, 'login', ...tools, ...envs.flatMap((e) => ['--env', e]));
}
