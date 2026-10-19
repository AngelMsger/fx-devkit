// What became of one planned effect, in the words every report row uses for it.

// `not_started` marks the effects a run never reached because an earlier one failed.
export type EffectOutcome = 'planned' | 'not_started' | 'done' | 'failed' | 'skipped';

export function isUnfinished(outcome: EffectOutcome | undefined): boolean {
  return outcome === 'failed' || outcome === 'not_started';
}
