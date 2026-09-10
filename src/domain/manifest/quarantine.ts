// Which problems belong to one entry of a collection and which to the document. An
// entry's problems only cost that entry; the document's problems cost the whole load.

import type { Problem } from './types.js';

export interface Partition {
  readonly entries: ReadonlyMap<number, readonly Problem[]>;
  readonly document: readonly Problem[];
}

export function partitionProblems(
  problems: readonly Problem[],
  collection: 'repos' | 'tools' | 'mcp',
): Partition {
  const pattern = new RegExp(`^${collection}\\[(\\d+)\\]`);
  const entries = new Map<number, Problem[]>();
  const document: Problem[] = [];
  for (const problem of problems) {
    const match = pattern.exec(problem.path);
    if (match === null) {
      document.push(problem);
      continue;
    }
    const index = Number(match[1]);
    entries.set(index, [...(entries.get(index) ?? []), problem]);
  }
  return { entries, document };
}
