import { describe, expect, it } from 'vitest';

import { type BuildSide, ciFinding, judgeBuild } from '../../../../src/domain/release/ci.js';
import type { Build } from '../../../../src/ports/ci.js';

const build = (
  status: Build['status'],
  startedAt: string | null = '2026-09-02T10:00:00Z',
  commit: string | null = null,
): Build => ({
  number: 7,
  status,
  startedAt,
  url: null,
  commit,
});
const HEAD = '2026-09-02T09:00:00Z';
const at = (head: string | null, sha: string | null = 'd1d1d1d1d1d1') => ({ sha, head });
const side = (
  which: BuildSide['side'],
  b: Build | undefined,
  head: string | null = HEAD,
): BuildSide => ({
  side: which,
  env: which === 'source' ? 'dev' : 'prod',
  branch: which === 'source' ? 'dev' : 'main',
  sha: which === 'source' ? 'd1d1d1d1d1d1' : 'a1a1a1a1a1a1',
  path: `services/a/${which === 'source' ? 'dev' : 'main'}`,
  build: b,
  head,
});

describe('judgeBuild', () => {
  it('calls a build current when it started at or after the head commit', () => {
    expect(judgeBuild(build('success'), at(HEAD))).toMatchObject({ current: true, by: 'time' });
    expect(judgeBuild(build('success', '2026-09-02T08:00:00Z'), at(HEAD)).current).toBe(false);
  });

  it('concludes nothing about currency when a date is missing', () => {
    expect(judgeBuild(build('success', null), at(HEAD))).toMatchObject({ current: null, by: null });
    expect(judgeBuild(build('success'), at(null)).current).toBeNull();
  });

  it('decides by the commit a build checked out whenever the platform names it', () => {
    // Started before the head was written, yet built from it: a commit pushed late.
    const late = build('success', '2026-09-02T08:00:00Z', 'D1D1D1D1D1D1D1D1');
    expect(judgeBuild(late, at(HEAD))).toMatchObject({ current: true, by: 'commit' });
    // Started after the head was written, yet built from the commit before it.
    const older = build('success', '2026-09-02T10:00:00Z', 'c0c0c0c0c0c0');
    expect(judgeBuild(older, at(HEAD))).toMatchObject({ current: false, by: 'commit' });
    expect(judgeBuild(build('success', null, 'd1d1d1d'), at(null))).toMatchObject({
      current: true,
      by: 'commit',
    });
    // Without the head's own commit there is nothing to compare it with.
    expect(judgeBuild(older, at(HEAD, null))).toMatchObject({ current: true, by: 'time' });
  });
});

describe('ciFinding', () => {
  it('passes when both jobs succeeded after the head commit, and names that commit', () => {
    const out = ciFinding('a', [
      side('source', build('success')),
      side('target', build('success')),
    ]);
    expect(out).toMatchObject({ group: 'ci', id: 'a', level: 'ok' });
    expect(out.message).toBe(
      'dev #7 succeeded, started after d1d1d1d; main #7 succeeded, started after a1a1a1a',
    );
    expect(out.evidence).toMatchObject({
      builds: [{ head: 'd1d1d1d1d1d1' }, { head: 'a1a1a1a1a1a1' }],
    });
  });

  it('fails on a failed job, and on a success that predates the head commit', () => {
    expect(ciFinding('a', [side('source', build('failure'))])).toMatchObject({
      level: 'fail',
      message: 'dev #7 failure',
    });
    const stale = ciFinding('a', [side('target', build('success', '2026-09-02T08:00:00Z'))]);
    expect(stale).toMatchObject({
      level: 'fail',
      message: 'main #7 succeeded but started before a1a1a1a',
    });
    expect(stale.evidence).toMatchObject({ builds: [{ side: 'target', current: false }] });
  });

  it('warns while a build is still running', () => {
    expect(ciFinding('a', [side('source', build('building'))])).toMatchObject({
      level: 'warn',
      coverage: 'checked',
    });
  });

  it('warns about a job that is not there, and still judges the other side', () => {
    const out = ciFinding('a', [side('source', undefined), side('target', build('success'))]);
    expect(out).toMatchObject({ level: 'warn', coverage: 'incomplete' });
    expect(out.message).toContain('dev: no job services/a/dev');
    // The platform's own name for the job, when it gives one, is what a person reads.
    const named = ciFinding('a', [
      { ...side('source', undefined), job: 'Jenkins job services/a/dev' },
    ]);
    expect(named.message).toBe('dev: no Jenkins job services/a/dev');
    const bad = ciFinding('a', [side('source', undefined), side('target', build('aborted'))]);
    expect(bad).toMatchObject({ level: 'fail', coverage: 'incomplete' });
  });

  it('warns when the branch a release is cut from is not there, and when a side went unanswered', () => {
    const gone = ciFinding('a', [
      { ...side('source', undefined), branch: undefined, path: null },
      side('target', build('success')),
    ]);
    expect(gone).toMatchObject({
      level: 'warn',
      message: expect.stringContaining('source: no branch'),
    });
    const half = ciFinding('a', [
      { ...side('source', undefined), reason: 'jenkins-cli timed out' },
      side('target', build('failure')),
    ]);
    expect(half).toMatchObject({ level: 'fail', coverage: 'incomplete' });
    expect(half.message).toContain('source: jenkins-cli timed out');
  });

  it('keeps a side the manifest has no job for in the report, as an answer', () => {
    const out = ciFinding('a', [
      { ...side('source', build('success')), path: null },
      side('target', build('success')),
    ]);
    expect(out).toMatchObject({ level: 'ok', coverage: 'checked' });
    expect(out.message).toContain('dev: no ci coordinate in dev, not checked');
    expect(out.evidence).toMatchObject({
      builds: [
        { side: 'source', path: null },
        { side: 'target', number: 7 },
      ],
    });
  });

  it('warns on a state it cannot read and a date it cannot parse', () => {
    expect(ciFinding('a', [side('source', build('unknown'))])).toMatchObject({
      level: 'warn',
      message: 'dev #7 in an unreadable state',
      coverage: 'incomplete',
    });
    expect(judgeBuild(build('success', 'yesterday'), at(HEAD)).current).toBeNull();
  });

  it('warns rather than passes when nothing dates the build against the head commit', () => {
    const undated = ciFinding('a', [side('source', build('success', null))]);
    expect(undated).toMatchObject({
      level: 'warn',
      message: 'dev #7 succeeded, undated against d1d1d1d',
      coverage: 'incomplete',
    });
    expect(ciFinding('a', [side('source', build('success'), null)]).level).toBe('warn');
  });
});
