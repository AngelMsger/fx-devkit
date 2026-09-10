// A branch counts as built when its job's latest build succeeded and started
// no earlier than the branch's head commit: a green build of an older commit
// says nothing about what is about to ship. The build carries no revision —
// the ci platforms fx drives do not report one — so this is an ordering of
// times, and the message says so rather than claiming the build was of that
// commit. Both sides of the release, the source job and the target job, must
// pass; a side nobody can date, or whose job is not there, is a warning
// rather than a pass, and a side the manifest has no job for says so instead
// of disappearing.

import type { Build } from '../obs/types.js';
import { type Coverage, type Level, worst } from '../report.js';

import { releaseFinding, type ReleaseFinding } from './types.js';

export interface BuildSide {
  readonly side: 'source' | 'target';
  readonly env: string;
  // undefined: the repository has no such branch.
  readonly branch: string | undefined;
  // null: the manifest names no ci coordinate for this repository here.
  readonly path: string | null;
  // undefined: the job does not exist on the platform.
  readonly build: Build | undefined;
  // Why this side went unanswered, when the platform could not be asked.
  readonly reason?: string | undefined;
  // ISO date of the branch's head commit; null when unknown.
  readonly head: string | null;
}

export interface JudgedBuild {
  readonly status: Build['status'];
  // null when either date is unknown, so nothing is concluded from it.
  readonly current: boolean | null;
}

export function judgeBuild(build: Build, head: string | null): JudgedBuild {
  const started = build.startedAt === null ? NaN : Date.parse(build.startedAt);
  const at = head === null ? NaN : Date.parse(head);
  if (Number.isNaN(started) || Number.isNaN(at)) return { status: build.status, current: null };
  return { status: build.status, current: started >= at };
}

export function ciFinding(repo: string, sides: readonly BuildSide[]): ReleaseFinding {
  const judged = sides.map((s) => ({ side: s, verdict: verdictOf(s) }));
  return releaseFinding(
    'ci',
    repo,
    worst(judged.map((j) => j.verdict.level)),
    judged.map((j) => j.verdict.message).join('; '),
    {
      coverage: combineCoverage(sides.map(coverageOf)),
      evidence: {
        builds: judged.map(({ side, verdict }) => ({
          side: side.side,
          env: side.env,
          branch: side.branch ?? null,
          path: side.path,
          number: side.build?.number ?? null,
          status: side.build?.status ?? null,
          started_at: side.build?.startedAt ?? null,
          url: side.build?.url ?? null,
          current: verdict.current,
        })),
      },
    },
  );
}

function verdictOf(side: BuildSide): { level: Level; message: string; current: boolean | null } {
  const { branch, build } = side;
  if (side.reason !== undefined)
    return { level: 'warn', message: `${side.side}: ${side.reason}`, current: null };
  if (branch === undefined)
    return {
      // Without the branch a release is cut from there is nothing to build.
      level: side.side === 'source' ? 'warn' : 'ok',
      message: `${side.side}: no branch, not checked`,
      current: null,
    };
  if (side.path === null)
    return {
      level: 'ok',
      message: `${branch}: no ci coordinate in ${side.env}, not checked`,
      current: null,
    };
  // The manifest named a job and the platform has none: the question went
  // unanswered, which is not the same as passing.
  if (build === undefined)
    return { level: 'warn', message: `${branch}: no job ${side.path}`, current: null };
  const { status, current } = judgeBuild(build, side.head);
  const which = `${branch} #${build.number}`;
  if (status === 'building') return { level: 'warn', message: `${which} still building`, current };
  // The platform reported a state fx cannot map: it did not say the build
  // failed, so neither does the report.
  if (status === 'unknown')
    return { level: 'warn', message: `${which} in an unreadable state`, current };
  if (status !== 'success') return { level: 'fail', message: `${which} ${status}`, current };
  if (current === false)
    return { level: 'fail', message: `${which} succeeded before the head commit`, current };
  if (current === null)
    return {
      level: 'warn',
      message: `${which} succeeded, undated against the head commit`,
      current,
    };
  return { level: 'ok', message: `${which} succeeded after the head commit`, current };
}

function coverageOf(side: BuildSide): Coverage {
  if (side.reason !== undefined) return 'incomplete';
  if (side.branch === undefined) return side.side === 'source' ? 'incomplete' : 'not_applicable';
  if (side.path === null) return 'not_applicable';
  if (side.build === undefined || side.build.status === 'unknown') return 'incomplete';
  if (side.build.status === 'success' && judgeBuild(side.build, side.head).current === null)
    return 'incomplete';
  return 'checked';
}
function combineCoverage(coverage: readonly Coverage[]): Coverage {
  if (coverage.includes('incomplete')) return 'incomplete';
  return coverage.every((item) => item === 'not_applicable') ? 'not_applicable' : 'checked';
}
