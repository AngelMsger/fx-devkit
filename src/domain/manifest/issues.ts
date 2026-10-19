// Turn Zod issues into manifest problems. Entries of a collection are validated
// one by one under their original index so a problem names the line the reader
// sees; the document is then validated with only the entries that passed, and
// `kept` maps its indexes back.

import type * as z from 'zod';

import { formatPath, type PathPart, type Raw } from './document.js';
import { mapEntryIndex, type EntryCollection } from './quarantine.js';
import type { Problem } from './types.js';

export interface EntrySpec {
  readonly key: EntryCollection;
  readonly allowEmpty?: boolean;
  readonly schema: z.ZodType;
}

export interface Validated<T> {
  readonly doc: T | undefined;
  readonly problems: Problem[];
  readonly kept: readonly number[];
}

// Issues carry the offending input only on request; "required" is told apart by it.
const REPORT_INPUT = { reportInput: true } as const;

export function validateDocument<T>(
  schema: z.ZodType<T, unknown>,
  entries: EntrySpec | undefined,
  value: Raw,
): Validated<T> {
  const problems: Problem[] = [];
  const kept: number[] = [];
  let candidate: Raw = value;
  if (entries !== undefined && Array.isArray(value[entries.key])) {
    const good: unknown[] = [];
    (value[entries.key] as unknown[]).forEach((entry, i) => {
      const result = entries.schema.safeParse(entry, REPORT_INPUT);
      if (result.success) {
        good.push(entry);
        kept.push(i);
      } else {
        problems.push(...issuesToProblems(result.error.issues, [entries.key, i]));
      }
    });
    candidate = { ...value, [entries.key]: good };
  }
  const result = schema.safeParse(candidate, REPORT_INPUT);
  if (result.success) return { doc: result.data, problems, kept };
  problems.push(...issuesToProblems(result.error.issues, []));
  return { doc: undefined, problems, kept };
}

export function remapIndexes(
  problem: Problem,
  entries: EntrySpec | undefined,
  kept: readonly number[],
): Problem {
  if (entries === undefined) return problem;
  const path = mapEntryIndex(problem.path, entries.key, (index) => kept[index] ?? index);
  return { ...problem, path };
}

function issuesToProblems(issues: readonly z.ZodIssue[], prefix: readonly PathPart[]): Problem[] {
  // A YAML document has no symbol keys; zod's path type merely allows them.
  const parts = (issue: z.ZodIssue): PathPart[] =>
    issue.path.filter((part): part is PathPart => typeof part !== 'symbol');
  return issues.map((issue) => ({
    path: formatPath([...prefix, ...parts(issue)]),
    message:
      issue.code === 'invalid_type' && issue.input === undefined ? 'required' : issue.message,
  }));
}
