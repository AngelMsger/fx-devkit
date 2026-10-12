// Whether each side of a release is built. Builds carry no revision here, so
// currency is an ordering of times; see "Build currency" in docs/design/release.md.

import type { Build } from '../obs/types.js';
import { type Coverage, type Level, worst } from '../report.js';
import { shortSha } from '../workspace/commits.js';

import { releaseFinding, type ReleaseFinding } from './types.js';

export interface BuildSide {
  readonly side: 'source' | 'target';
  readonly env: string;
  // undefined: the repository has no such branch.
  readonly branch: string | undefined;
  // null: the manifest names no ci coordinate for this repository here.
  readonly path: string | null;
  // The job as the platform names it, such as "Jenkins job services/api/dev".
  readonly job?: string | undefined;
  // undefined: the job does not exist on the platform.
  readonly build: Build | undefined;
  // Why this side went unanswered, when the platform could not be asked.
  readonly reason?: string | undefined;
  // The branch's head commit, which a current build started after; null without the branch.
  readonly sha: string | null;
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
          head: side.sha,
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
  // The manifest named a job and the platform has none: unanswered, not passed.
  if (build === undefined)
    return {
      level: 'warn',
      message: `${branch}: no ${side.job ?? `job ${side.path}`}`,
      current: null,
    };
  const { status, current } = judgeBuild(build, side.head);
  const which = `${branch} #${build.number}`;
  const head = side.sha === null ? 'the head commit' : shortSha(side.sha);
  if (status === 'building') return { level: 'warn', message: `${which} still building`, current };
  // The platform reported a state fx cannot map: it did not say the build
  // failed, so neither does the report.
  if (status === 'unknown')
    return { level: 'warn', message: `${which} in an unreadable state`, current };
  if (status !== 'success') return { level: 'fail', message: `${which} ${status}`, current };
  if (current === false)
    return { level: 'fail', message: `${which} succeeded but started before ${head}`, current };
  if (current === null)
    return { level: 'warn', message: `${which} succeeded, undated against ${head}`, current };
  return { level: 'ok', message: `${which} succeeded, started after ${head}`, current };
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
