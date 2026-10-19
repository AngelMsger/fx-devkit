// The vocabulary of a compare-and-write projection: what was observed at a managed
// path, and what became of a write planned against that observation.

export interface ProjectionSnapshot {
  readonly kind: 'absent' | 'file' | 'foreign';
  readonly text: string | null;
}

export type ProjectionWriteResult = 'written' | 'unchanged' | 'conflict' | 'busy';

// Another writer held the path, or it changed after it was observed. Either way
// nothing was written and the plan behind the write no longer holds.
export function isLostWrite(result: ProjectionWriteResult): result is 'conflict' | 'busy' {
  return result === 'conflict' || result === 'busy';
}
