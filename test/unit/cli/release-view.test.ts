// A person reading fx release check must see, per repository, what its release would
// ship and what holds it back, without scrolling through the repositories that are ready.
import { expect, it } from 'vitest';

import { releaseText } from '../../../src/cli/release-view.js';
import { displayOf, PLAIN } from '../../../src/cli/render/display.js';
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
      'api  1 fail',
      '  deps   fail  package.json: sdk 1.0.0-dev (dependencies)',
      '  merge  ok    dev and main agree',
      '',
      'All checks ok',
      '  web',
      '  worker',
      '',
    ].join('\n'),
  );
  expect(releaseText(checklist(passing('web')), { display: PLAIN, details: true })).toBe(
    [
      'web  ok',
      '  deps   ok    package.json: no pre-release dependency',
      '  merge  ok    dev and main agree',
      '',
    ].join('\n'),
  );
});

it('says once what every repository lacks, with the command that lets the check run', () => {
  const login = (repo: string) =>
    unanswered('errors', repo, 'sentry is unauthenticated for dev', { fix: 'fx login sentry' });
  const text = releaseText(
    checklist([
      ...passing('web'),
      login('web'),
      releaseFinding('deps', 'api', 'ok', 'no dependency file, not checked'),
      releaseFinding('merge', 'api', 'warn', 'could not compare main..dev: timed out'),
      login('api'),
    ]),
    { display: PLAIN, details: false },
  );
  expect(text).toBe(
    [
      'Every repository',
      '  errors  warn  sentry is unauthenticated for dev',
      '                fx login sentry',
      '',
      'api  1 warn',
      '  deps    ok    no dependency file, not checked',
      '  merge   warn  could not compare main..dev: timed out',
      '',
      'Otherwise ok',
      '  web',
      '',
    ].join('\n'),
  );
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
      'api  1 fail',
      '  1.2.0  main a1a1a1a, dev d1d1d1d (1.3.0) not merged: 2 commits by 2 people',
      '  note: releases from dev while the migration lasts',
      '  merge  fail  2 commits on dev not merged into main',
      '',
      'All checks ok',
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
  expect(text.split('\n').slice(0, 3)).toEqual([
    'api  1 fail',
    '  main a1a1a1a, dev d1d1d1d not merged: 120 commits by 1 person',
    '  merge  fail  120 commits on dev not merged into main',
  ]);
});
