// What walking a setup plan has established about its steps, and where that leaves the
// next one. A plan lists prerequisites first. A step behind one that did not pass is
// blocked; a step behind a check that gave no answer is as unknown as that check,
// whatever else it waits on.

import type { SetupStep } from './types.js';

type Step = Pick<SetupStep, 'id' | 'requires'>;

// A check that gave no answer: its tool did not start, or it outlived its deadline.
// Nothing about the step follows from it, so nobody is handed the step for it.
export function gaveNoAnswer(code: string | undefined): boolean {
  return code === 'TOOL_MISSING' || code === 'PROCESS_TIMEOUT';
}

// What a step came to. Which failures count as unanswered is the caller's to say.
export type StepConclusion = 'done' | 'undone' | 'unanswered';

// A step one of its prerequisites holds back, and which one.
export interface HeldBack {
  readonly kind: 'blocked' | 'unanswered';
  readonly by: string;
}

// Where a step stands before its own check.
type StepStanding = { readonly kind: 'clear' } | HeldBack;

export class SetupProgress {
  private readonly undone = new Set<string>();
  private readonly unanswered = new Set<string>();

  // A later conclusion about the same step replaces the earlier one.
  record(step: Step, conclusion: StepConclusion): void {
    this.unanswered.delete(step.id);
    if (conclusion === 'done') {
      this.undone.delete(step.id);
      return;
    }
    this.undone.add(step.id);
    if (conclusion === 'unanswered') this.unanswered.add(step.id);
  }

  // The first prerequisite, in the order the step lists them, that is not done for any reason.
  undonePrerequisite(step: Step): string | undefined {
    return step.requires.find((id) => this.undone.has(id));
  }

  // An unanswered prerequisite is looked for first. A step held back is recorded as what
  // its prerequisite made of it, so the steps behind it are held back in turn.
  admit(step: Step): StepStanding {
    const unanswered = step.requires.find((id) => this.unanswered.has(id));
    if (unanswered !== undefined) {
      this.record(step, 'unanswered');
      return { kind: 'unanswered', by: unanswered };
    }
    const undone = this.undonePrerequisite(step);
    if (undone === undefined) return { kind: 'clear' };
    this.record(step, 'undone');
    return { kind: 'blocked', by: undone };
  }
}

// The unanswered steps of a walk that has ended: the ones whose own check gave no answer,
// as the caller tells, and every step waiting on one of them.
export function unansweredSteps(
  steps: readonly Step[],
  wentUnanswered: (step: Step) => boolean,
): ReadonlySet<string> {
  const progress = new SetupProgress();
  const unanswered = new Set<string>();
  for (const step of steps) {
    const waits = progress.admit(step).kind === 'unanswered';
    if (!waits && !wentUnanswered(step)) continue;
    progress.record(step, 'unanswered');
    unanswered.add(step.id);
  }
  return unanswered;
}
