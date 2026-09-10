// The one shape for "several things were checked, here is each verdict":
// doctor uses it for a machine, release for repositories. A finding is one
// checked thing with a level and, when it is not fine, what to do — a
// command that fixes it or a handoff for a person — and optionally the
// evidence behind it. A report is the answer; producing one never fails.

import type { HandoffEnvelope } from './errors.js';

// Coverage describes whether the requested check produced evidence, independently of severity.
export type Coverage = 'checked' | 'not_applicable' | 'incomplete';

export type Level = 'ok' | 'warn' | 'fail';

export type Evidence = Readonly<Record<string, unknown>>;

export interface Finding<G extends string = string> {
  readonly group: G;
  readonly id: string;
  readonly level: Level;
  readonly coverage: Coverage;
  readonly message: string;
  readonly fix?: string;
  readonly handoff?: HandoffEnvelope;
  readonly evidence?: Evidence;
}

export interface Report<G extends string = string> {
  readonly ok: boolean;
  readonly complete: boolean;
  readonly summary: Readonly<Record<Level, number>>;
  readonly findings: readonly Finding<G>[];
}

export interface FindingExtra {
  readonly coverage?: Coverage | undefined;
  readonly fix?: string | undefined;
  readonly handoff?: HandoffEnvelope | undefined;
  readonly evidence?: Evidence | undefined;
}

export function finding<G extends string>(
  group: G,
  id: string,
  level: Level,
  message: string,
  extra: FindingExtra = {},
): Finding<G> {
  return {
    group,
    id,
    level,
    coverage: extra.coverage ?? 'checked',
    message,
    ...(extra.fix === undefined ? {} : { fix: extra.fix }),
    ...(extra.handoff === undefined ? {} : { handoff: extra.handoff }),
    ...(extra.evidence === undefined ? {} : { evidence: extra.evidence }),
  };
}

export function summarize(findings: readonly Finding[]): Record<Level, number> {
  const summary: Record<Level, number> = { ok: 0, warn: 0, fail: 0 };
  for (const f of findings) summary[f.level] += 1;
  return summary;
}

// Findings in the groups' declared order, each group keeping its own order,
// so the report reads the same whichever check answered first.
export function orderBy<G extends string>(
  groups: readonly G[],
  findings: readonly Finding<G>[],
): Finding<G>[] {
  return groups.flatMap((group) => findings.filter((f) => f.group === group));
}

// Only a failure makes the report not ok: a warning is something to know.
export function report<G extends string>(
  groups: readonly G[],
  findings: readonly Finding<G>[],
): Report<G> {
  const ordered = orderBy(groups, findings);
  return {
    ok: ordered.every((f) => f.level !== 'fail'),
    complete: ordered.every((f) => f.coverage !== 'incomplete'),
    summary: summarize(ordered),
    findings: ordered,
  };
}

export function worst(levels: readonly Level[]): Level {
  if (levels.includes('fail')) return 'fail';
  return levels.includes('warn') ? 'warn' : 'ok';
}
