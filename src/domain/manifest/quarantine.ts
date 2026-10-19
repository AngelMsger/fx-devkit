// Which problems belong to one entry of a collection and which to the document. An
// entry's problems only cost that entry; the document's problems cost the whole load.
// The path syntax that names an entry, and the tie between a dropped entry and the
// problems that dropped it, are decided here alone.

import type { Dropped, Problem } from './types.js';

export type EntryCollection = Dropped['collection'];

export interface Partition {
  readonly entries: ReadonlyMap<number, readonly Problem[]>;
  readonly document: readonly Problem[];
}

function entryHead(collection: EntryCollection): RegExp {
  return new RegExp(`^${collection}\\[(\\d+)\\]`);
}

export function partitionProblems(
  problems: readonly Problem[],
  collection: EntryCollection,
): Partition {
  const pattern = entryHead(collection);
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

// Rewrites the index a path names its entry by; any other path is returned as it is.
export function mapEntryIndex(
  path: string,
  collection: EntryCollection,
  next: (index: number) => number | string,
): string {
  return path.replace(entryHead(collection), (_, i: string) => `${collection}[${next(Number(i))}]`);
}

function statement(problem: Problem): string {
  return `${problem.path}: ${problem.message}`;
}

export function droppedEntry(
  collection: EntryCollection,
  name: string,
  problems: readonly Problem[],
): Dropped {
  return { collection, name, reason: problems.map(statement).join('; ') };
}

// A dropped entry keeps its name, not its index, so the reason it was given is what
// ties a problem back to it.
export function droppedEntryOf(problem: Problem, dropped: readonly Dropped[]): Dropped | undefined {
  return dropped.find((entry) => entry.reason.includes(statement(problem)));
}
