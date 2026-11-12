// A person reading fx release check must see, per repository, what its release would
// ship and what holds it back, without scrolling through the repositories that are ready.
import { expect, it } from 'vitest';

import { RELEASE_CODES, reportNotice } from '../../../src/cli/notices.js';
import { releaseText } from '../../../src/cli/release-view.js';
import { displayOf, PLAIN } from '../../../src/cli/render/display.js';
import { DevkitError, toEnvelope } from '../../../src/domain/errors.js';
import {
  releaseFinding,
  unanswered,
  type Check,
  type ReleaseFinding,
  type ReleaseHead,
  type ReleaseRepo,
  type ReleaseReport,
} from '../../../src/domain/release/types.js';
import { report } from '../../../src/domain/report.js';
import { FakeTerminal, tagged } from '../../fakes/fake-terminal.js';

const CHECKS: readonly Check[] = ['deps', 'merge', 'ci', 'errors'];

// Each repository's description defaults to nothing known, as when the host was not asked.
function checklist(
  findings: readonly ReleaseFinding[],
  repos: readonly ReleaseRepo[] = [],
): ReleaseReport {
  const names = [...new Set(findings.map((f) => f.id))];
  return {
    ...report(CHECKS, findings),
    repos: names.map((name) => repos.find((r) => r.name === name) ?? unknown(name)),
  };
}

const unknown = (name: string): ReleaseRepo => ({
  name,
  source: null,
  target: null,
  version_file: null,
  unmerged: null,
  note: null,
  unanswered: [],
});

const head = (branch: string, sha: string, version: string | null): ReleaseHead => ({
  branch,
  sha,
  date: null,
  message: null,
  version,
});

const passing = (repo: string) => [
  releaseFinding('deps', repo, 'ok', 'package.json: no pre-release dependency'),
  releaseFinding('merge', repo, 'ok', 'dev and main agree'),
];

it('groups one timed-out dependency across checks while retaining exact repository scope and recovery', () => {
  const failure = toEnvelope(
    new DevkitError('internal', 'PROCESS_TIMEOUT', 'bitbucket-cli did not finish within 15000ms'),
  ).error;
  const findings = (['deps', 'merge', 'ci'] as const).flatMap((check) =>
    ['api', 'web'].map((repo) =>
      unanswered(check, repo, failure.message, { failure, fix: `Inspect ${repo} ${check}` }),
    ),
  );
  const report = checklist(findings);
  const text = releaseText(report, { display: PLAIN, details: false });
  expect(text.match(/did not finish/g)).toHaveLength(1);
  expect(text).toContain('deps, merge, ci: api, web');
  expect(text).toContain('--jobs 1 --details');
  expect(text).not.toContain('Completed checks');
  expect(reportNotice(report, RELEASE_CODES, ['fx release check --details'])).toMatchObject({
    code: 'RELEASE_INCOMPLETE',
    message: expect.stringContaining('6 incomplete'),
    nextSteps: ['fx release check --details'],
  });
});

it('keeps a confirmed failure visible even when its evidence is partial', () => {
  const report = checklist([
    releaseFinding('errors', 'api', 'fail', 'at least 1000 unresolved issues', {
      coverage: 'incomplete',
    }),
  ]);
  const text = releaseText(report, { display: PLAIN, details: false });
  expect(text).toContain('api  1 fail, 1 incomplete');
  expect(text).toContain('errors  fail  at least 1000 unresolved issues');
  expect(reportNotice(report, RELEASE_CODES).code).toBe('RELEASE_FAILURES');
});

it('lists each repository with a problem under its own name and the ready ones on one line', () => {
  const text = releaseText(
    checklist([
      ...passing('web'),
      releaseFinding('deps', 'api', 'fail', 'package.json: sdk 1.0.0-dev (dependencies)'),
      releaseFinding('merge', 'api', 'ok', 'dev and main agree'),
      ...passing('worker'),
    ]),
    { display: PLAIN, details: false },
  );
  expect(text).toBe(
    [
      'Checks: 1 failed, 0 warnings, 0 incomplete, 5 passed, 0 not applicable',
      '',
      'api  1 fail',
      '  deps   fail  package.json: sdk 1.0.0-dev (dependencies)',
      '  merge  ok    dev and main agree',
      '',
      'Completed checks (passed or not applicable)',
      '  web',
      '  worker',
      '',
    ].join('\n'),
  );
  expect(releaseText(checklist(passing('web')), { display: PLAIN, details: true })).toBe(
    [
      'Checks: 0 failed, 0 warnings, 0 incomplete, 2 passed, 0 not applicable',
      '',
      'web  ok',
      '  deps   ok    package.json: no pre-release dependency',
      '  merge  ok    dev and main agree',
      '',
    ].join('\n'),
  );
});

it('groups unavailable checks across a subset without calling affected repositories ready', () => {
  const login = (repo: string) =>
    unanswered('errors', repo, 'sentry is unauthenticated for dev', { fix: 'fx login sentry' });
  const report = checklist([
    ...passing('web'),
    login('web'),
    releaseFinding('deps', 'api', 'fail', 'sdk is a snapshot'),
    login('api'),
    ...passing('worker'),
  ]);
  const text = releaseText(report, { display: PLAIN, details: false });
  expect(text).toContain('Checks: 1 failed, 0 warnings, 2 incomplete, 4 passed, 0 not applicable');
  expect(text).toContain('api  1 fail, 1 incomplete');
  expect(text.indexOf('sdk is a snapshot')).toBeLessThan(
    text.indexOf('Unavailable or partial checks'),
  );
  expect(text.match(/sentry is unauthenticated/g)).toHaveLength(1);
  expect(text).toContain('errors: web, api');
  expect(text).toContain('Next: fx login sentry');
  expect(text).toContain('Checks incomplete\n  web');
  expect(text).toContain('Completed checks (passed or not applicable)\n  worker');
  const details = releaseText(report, { display: PLAIN, details: true });
  expect(details).toContain('web  1 incomplete');
  expect(details.match(/sentry is unauthenticated/g)).toHaveLength(2);
});

it('paints levels, keeps passing checks quiet and wraps a long message under its column', () => {
  const text = tagged(
    releaseText(
      checklist([
        releaseFinding('deps', 'api', 'ok', 'pom.xml: no pre-release dependency'),
        releaseFinding('ci', 'api', 'fail', 'dev #12 succeeded; main #9 succeeded before the head'),
      ]),
      { display: displayOf(new FakeTerminal(56), {}, 'darwin'), details: false },
    ),
  ).split('\n');
  expect(text).toEqual([
    'Checks: 1 failed, 0 warnings, 0 incomplete, 1 passed, 0',
    'not applicable',
    '',
    '<strong>api</>  <fail>1 fail</>',
    '  deps  <ok>ok</>    <quiet>pom.xml: no pre-release dependency</>',
    '  ci    <fail>fail</>  dev #12 succeeded; main #9 succeeded',
    '              before the head',
    '',
  ]);
});

it('opens each repository with what it would ship, and counts the commits not merged yet', () => {
  const api: ReleaseRepo = {
    ...unknown('api'),
    source: head('dev', 'd1d1d1d1d1', '1.3.0'),
    target: head('main', 'a1a1a1a1a1', '1.2.0'),
    version_file: 'package.json',
    unmerged: { commits: 2, authors: 2 },
    note: 'releases from dev while the migration lasts',
  };
  const web: ReleaseRepo = {
    ...unknown('web'),
    source: head('dev', 'e1e1e1e1e1', '2.0.1'),
    target: head('main', 'f1f1f1f1f1', '2.0.1'),
    version_file: 'package.json',
    unmerged: { commits: 0, authors: 0 },
  };
  const tool: ReleaseRepo = { ...unknown('tool'), source: head('master', 'b1b1b1b1b1', null) };
  const text = releaseText(
    checklist(
      [
        releaseFinding('merge', 'api', 'fail', '2 commits on dev not merged into main'),
        releaseFinding('merge', 'web', 'ok', 'dev and main agree'),
        releaseFinding('merge', 'tool', 'ok', 'one branch, no main or master, not checked'),
        releaseFinding('merge', 'gone', 'ok', 'one branch, no main or master, not checked'),
      ],
      [api, web, tool],
    ),
    { display: PLAIN, details: false },
  );
  expect(text).toBe(
    [
      'Checks: 1 failed, 0 warnings, 0 incomplete, 3 passed, 0 not applicable',
      '',
      'api  1 fail',
      '  1.2.0  main a1a1a1a, dev d1d1d1d (1.3.0) not merged: 2 commits by 2 people',
      '  note: releases from dev while the migration lasts',
      '  merge  fail  2 commits on dev not merged into main',
      '',
      'Completed checks (passed or not applicable)',
      '  web   2.0.1  main f1f1f1f, dev merged',
      '  tool         master b1b1b1b',
      '  gone',
      '',
    ].join('\n'),
  );
});

it('counts the commits and the people behind them, however many there are', () => {
  const text = releaseText(
    checklist(
      [releaseFinding('merge', 'api', 'fail', '120 commits on dev not merged into main')],
      [
        {
          ...unknown('api'),
          source: head('dev', 'd1d1d1d1d1', null),
          target: head('main', 'a1a1a1a1a1', null),
          unmerged: { commits: 120, authors: 1 },
        },
      ],
    ),
    { display: PLAIN, details: false },
  );
  expect(text.split('\n').slice(2, 5)).toEqual([
    'api  1 fail',
    '  main a1a1a1a, dev d1d1d1d not merged: 120 commits by 1 person',
    '  merge  fail  120 commits on dev not merged into main',
  ]);
});

it('names every repository with what it would ship, even when all its findings are shared', () => {
  const behind = (name: string, sha: string): ReleaseRepo => ({
    ...unknown(name),
    source: head('dev', `d${sha}`, '1.3.0'),
    target: head('main', `m${sha}`, '1.2.0'),
    unmerged: { commits: 1, authors: 1 },
  });
  const merge = (repo: string) =>
    releaseFinding('merge', repo, 'fail', '1 commit on dev not merged into main');
  const report = checklist(
    [merge('api'), merge('web')],
    [behind('api', '111111'), behind('web', '222222')],
  );
  const text = releaseText(report, { display: PLAIN, details: false });
  expect(text).toContain('api  1 fail\n  1.2.0  main m111111, dev d111111');
  expect(text).toContain('web  1 fail\n  1.2.0  main m222222, dev d222222');
  expect(text.match(/1 commit on dev not merged into main/g)).toHaveLength(2);
  expect(text).not.toContain('Completed checks');
  const detailed = releaseText(report, { display: PLAIN, details: true });
  expect(detailed).toContain('api  1 fail');
  expect(detailed).toContain('web  1 fail');
});

it('says which question to the host failed, beside the note', () => {
  const api: ReleaseRepo = {
    ...unknown('api'),
    source: head('dev', 'd1d1d1d1d1', '1.3.0'),
    target: head('main', 'a1a1a1a1a1', null),
    unmerged: { commits: 0, authors: 0 },
    note: 'frozen until the audit',
    unanswered: [{ field: 'target.version', reason: 'timed out reading package.json' }],
  };
  const text = releaseText(checklist(passing('api'), [api]), { display: PLAIN, details: false });
  expect(text.split('\n').slice(2, 6)).toEqual([
    'Completed checks (passed or not applicable)',
    '  api  main a1a1a1a, dev merged',
    '       target.version unknown: timed out reading package.json',
    '       note: frozen until the audit',
  ]);
});
