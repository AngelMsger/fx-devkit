// Separate evidence of a release problem from unavailable checks, grouping only
// identical causes and preserving the exact repositories affected by each check.
import type { ReleaseFinding } from '../domain/release/types.js';
import type { Finding, Report } from '../domain/report.js';

import type { Display } from './render/display.js';

export function releaseCounts(report: Pick<Report, 'findings'>): string {
  const count = (test: (f: Finding) => boolean): number => report.findings.filter(test).length;
  return `Checks: ${count((f) => f.level === 'fail')} failed, ${count((f) => f.level === 'warn' && f.coverage !== 'incomplete')} warnings, ${count((f) => f.coverage === 'incomplete')} incomplete, ${count((f) => f.level === 'ok' && f.coverage === 'checked')} passed, ${count((f) => f.coverage === 'not_applicable')} not applicable`;
}

export function incompleteLines(findings: readonly ReleaseFinding[], display: Display): string[][] {
  const groups = new Map<string, ReleaseFinding[]>();
  for (const f of findings) {
    if (f.coverage !== 'incomplete') continue;
    // Findings with evidence of a failure remain in their repository block too.
    const key = JSON.stringify([f.message, recovery(f), f.failure?.category, f.failure?.code]);
    const group = groups.get(key) ?? [];
    group.push(f);
    groups.set(key, group);
  }
  if (groups.size === 0) return [];
  const wrap = (line: string): string[] =>
    display.wrap(line, Math.max(24, display.room(2))).map((l) => `  ${l}`);
  return [
    [
      display.paint('warn', 'Unavailable or partial checks'),
      ...[...groups.values()]
        .flatMap((group) => {
          const first = group[0]!;
          const scopes = new Map<string, string[]>();
          for (const check of [...new Set(group.map((f) => f.group))]) {
            const repos = [...new Set(group.filter((f) => f.group === check).map((f) => f.id))];
            const key = repos.join(', ');
            scopes.set(key, [...(scopes.get(key) ?? []), check]);
          }
          return [
            ...wrap(first.message),
            ...[...scopes].flatMap(([repos, checks]) => wrap(`${checks.join(', ')}: ${repos}`)),
            ...(recovery(first) === undefined ? [] : wrap(`Next: ${recovery(first)}`)),
            '',
          ];
        })
        .slice(0, -1),
    ],
  ];
}

function recovery(f: ReleaseFinding): string | undefined {
  return f.failure?.code === 'PROCESS_TIMEOUT'
    ? 'fx release check <repo> --only <check> --jobs 1 --details'
    : f.fix;
}
