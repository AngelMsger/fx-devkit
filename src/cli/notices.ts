// What a command says on stderr once its rows are out: stage outcomes, plan
// problems, a summary line. Data went to stdout already; these are for the
// person reading along.

import type { SyncOutput } from '../application/sync/types.js';
import type { Report } from '../domain/report.js';
import type { Notice } from '../ports/reporter.js';

export function syncNotices(out: SyncOutput, dryRun: boolean): Notice[] {
  const stages = Object.entries(out.stages).map(([stage, state]): Notice =>
    typeof state === 'string'
      ? { code: 'SYNC_STAGE_UNAVAILABLE', message: `${stage}: ${state} in this version` }
      : { code: 'SYNC_STAGE', message: `${stage}: ${describe(state)}` },
  );
  const { done, skipped, failed, unreadable } = out.summary;
  return [
    ...stages,
    {
      code: 'SYNC_SUMMARY',
      message: `${done} done, ${skipped} skipped, ${failed} failed, ${unreadable} unreadable${dryRun ? ' (dry run)' : ''}`,
    },
  ];
}

export interface LoginProblem {
  readonly step: string;
  readonly reason: string;
  readonly detail: string;
}

export function loginNotices(
  problems: readonly LoginProblem[],
  summary?: Readonly<Record<string, number>>,
): Notice[] {
  const notices = problems.map((p): Notice => ({
    code: 'LOGIN_PLAN_PROBLEM',
    message: `${p.step}: ${p.detail} (${p.reason})`,
    nextSteps: ['fx manifest explain platforms', 'fx tool show <tool>'],
  }));
  if (summary !== undefined)
    notices.push({ code: 'LOGIN_SUMMARY', message: describe(nonZero(summary)) });
  return notices;
}

export interface ReportCodes {
  readonly ok: string;
  readonly failures: string;
}

export const DOCTOR_CODES: ReportCodes = { ok: 'DOCTOR_OK', failures: 'DOCTOR_FAILURES' };
export const RELEASE_CODES: ReportCodes = { ok: 'RELEASE_OK', failures: 'RELEASE_FAILURES' };

// One line of counts; when something failed, the fixes the findings named
// and whatever the command adds for reading the evidence.
export function reportNotice(
  report: Report,
  codes: ReportCodes,
  nextSteps: readonly string[] = [],
): Notice {
  const { ok, warn, fail } = report.summary;
  const fixes = report.findings
    .filter((f) => f.level === 'fail')
    .flatMap((f) => (f.fix === undefined ? [] : [f.fix]));
  return {
    code: report.ok ? codes.ok : codes.failures,
    message: `${ok} ok, ${warn} warn, ${fail} fail${report.complete ? '' : '; checks incomplete'}`,
    ...(report.ok ? {} : { nextSteps: [...new Set([...fixes, ...nextSteps])] }),
  };
}

function describe(summary: Readonly<Record<string, number | string>>): string {
  const parts = Object.entries(summary).map(([key, value]) => `${value} ${key}`);
  return parts.length === 0 ? 'nothing to do' : parts.join(', ');
}

function nonZero(summary: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(summary).filter(([, n]) => n > 0));
}
