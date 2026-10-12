// A person reading fx release must see, per repository, what holds its release back,
// without scrolling through the repositories that are ready.
import { expect, it } from 'vitest';

import { releaseText } from '../../../src/cli/release-view.js';
import { displayOf, PLAIN } from '../../../src/cli/render/display.js';
import { releaseFinding, unanswered, type Check } from '../../../src/domain/release/types.js';
import { report } from '../../../src/domain/report.js';
import { FakeTerminal, tagged } from '../../fakes/fake-terminal.js';

const CHECKS: readonly Check[] = ['deps', 'merge', 'ci', 'errors'];

function checklist(...findings: Parameters<typeof report<Check>>[1]) {
  return report(CHECKS, findings);
}

const passing = (repo: string) => [
  releaseFinding('deps', repo, 'ok', 'package.json: no pre-release dependency'),
  releaseFinding('merge', repo, 'ok', 'dev and main agree'),
];

it('lists each repository with a problem under its own name and the ready ones on one line', () => {
  const text = releaseText(
    checklist(
      ...passing('web'),
      releaseFinding('deps', 'api', 'fail', 'package.json: sdk 1.0.0-dev (dependencies)'),
      releaseFinding('merge', 'api', 'ok', 'dev and main agree'),
      ...passing('worker'),
    ),
    { display: PLAIN, details: false },
  );
  expect(text).toBe(
    [
      'api  1 fail',
      '  deps   fail  package.json: sdk 1.0.0-dev (dependencies)',
      '  merge  ok    dev and main agree',
      '',
      'All checks ok: web, worker',
      '',
    ].join('\n'),
  );
  expect(releaseText(checklist(...passing('web')), { display: PLAIN, details: true })).toBe(
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
    checklist(
      ...passing('web'),
      login('web'),
      releaseFinding('deps', 'api', 'ok', 'no dependency file, not checked'),
      releaseFinding('merge', 'api', 'warn', 'could not compare main..dev: timed out'),
      login('api'),
    ),
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
      'Otherwise ok: web',
      '',
    ].join('\n'),
  );
});

it('paints levels, keeps passing checks quiet and wraps a long message under its column', () => {
  const text = tagged(
    releaseText(
      checklist(
        releaseFinding('deps', 'api', 'ok', 'pom.xml: no pre-release dependency'),
        releaseFinding('ci', 'api', 'fail', 'dev #12 succeeded; main #9 succeeded before the head'),
      ),
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
