// What a command says on stderr once its rows are out: plan problems and a
// summary line. Data went to stdout already; these are for the person reading
// along.

import type { StepRow } from '../application/login/run.js';
import type { Report } from '../domain/report.js';
import type { Notice } from '../ports/reporter.js';

import { releaseCounts } from './release-coverage.js';

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

// A step that ran off the terminal and failed with its companion's own error: the table
// shows only the message, so a person reading along is told what the companion advised.
// The generic code means fx captured no such error, as from a step given the terminal.
export function stepRecoveryNotices(
  rows: readonly Pick<StepRow, 'id' | 'result' | 'failure'>[],
): Notice[] {
  return rows.flatMap((row) => {
    const { failure } = row;
    if (row.result !== 'failed' || failure === undefined) return [];
    if (failure.code === 'SETUP_COMMAND_FAILED') return [];
    const advice = [...(failure.hint ? [failure.hint] : []), ...failure.next_steps];
    if (advice.length === 0) return [];
    return [
      {
        code: 'LOGIN_STEP_FAILED',
        message: `${row.id}: ${failure.message}`,
        nextSteps: advice,
      },
    ];
  });
}

export interface ReportCodes {
  readonly ok: string;
  readonly failures: string;
}

export const RELEASE_CODES: ReportCodes = { ok: 'RELEASE_OK', failures: 'RELEASE_FAILURES' };

// One line of counts; when something failed, the fixes the findings named
// and whatever the command adds for reading the evidence.
export function reportNotice(
  report: Report,
  codes: ReportCodes,
  nextSteps: readonly string[] = [],
): Notice {
  const fixes = report.findings
    .filter((f) => f.level === 'fail')
    .flatMap((f) => (f.fix === undefined ? [] : [f.fix]));
  const passed = report.complete ? codes.ok : 'RELEASE_INCOMPLETE';
  return {
    code: report.ok ? passed : codes.failures,
    message: releaseCounts(report),
    ...(report.ok && report.complete ? {} : { nextSteps: [...new Set([...fixes, ...nextSteps])] }),
  };
}

function describe(summary: Readonly<Record<string, number | string>>): string {
  const parts = Object.entries(summary).map(([key, value]) => `${value} ${key}`);
  return parts.length === 0 ? 'nothing to do' : parts.join(', ');
}

export function nonZero(summary: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(summary).filter(([, n]) => n > 0));
}
