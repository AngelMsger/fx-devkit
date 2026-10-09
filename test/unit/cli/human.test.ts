// The human layouts on a terminal. The plain form of the same layouts is what
// render.test.ts pins for pipes; here the display adds meaning, never content.
import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import { displayOf, PLAIN, type Display } from '../../../src/cli/render/display.js';
import {
  humanDiagnostic,
  humanError,
  humanList,
  humanNotice,
  humanProgress,
  humanRecord,
} from '../../../src/cli/render/human.js';
import { ownerLines } from '../../../src/cli/render/owners.js';
import { roleOf } from '../../../src/cli/render/tone.js';
import { truncate, widthOf, wrap } from '../../../src/cli/render/width.js';
import { FakeTerminal, tagged } from '../../fakes/fake-terminal.js';

const terminal = (columns = 120): Display => displayOf(new FakeTerminal(columns), {}, 'darwin');
const lines = (text: string): string[] => stripVTControlCharacters(text).split('\n');

describe('width', () => {
  it('counts terminal columns: wide characters and emoji take two, combining marks none', () => {
    expect(widthOf('dev')).toBe(3);
    expect(widthOf('测试环境')).toBe(8);
    expect(widthOf('Jodoo 生产环境 (全球)')).toBe(21);
    expect(widthOf('e\u0301')).toBe(1);
    expect(widthOf('\u2705 \u{1f680}')).toBe(5);
    expect(widthOf('✓ ✗')).toBe(3);
  });

  it('truncates by columns and never splits a wide character', () => {
    expect(truncate('fx-example-api', 20, '…')).toBe('fx-example-api');
    expect(truncate('fx-example-api', 8, '…')).toBe('fx-exam…');
    expect(truncate('简道云生产环境', 8, '…')).toBe('简道云…');
  });

  it('leaves text whole where not even the ellipsis fits', () => {
    expect(truncate('blocked', 2, '...')).toBe('blocked');
    expect(truncate('', -4, '…')).toBe('');
  });

  it('wraps at spaces and cuts only a word that is too long on its own', () => {
    expect(wrap('no credentials are configured for it', 16)).toEqual([
      'no credentials',
      'are configured',
      'for it',
    ]);
    expect(wrap('see https://logs.example.com/tokens', 10)).toEqual([
      'see',
      'https://lo',
      'gs.example',
      '.com/token',
      's',
    ]);
    expect(wrap('fits', 20)).toEqual(['fits']);
    expect(wrap('', 20)).toEqual(['']);
  });

  it('wraps wide characters by columns and keeps the line breaks the text has', () => {
    expect(wrap('简道云生产环境', 6)).toEqual(['简道云', '生产环', '境']);
    expect(wrap('first\nsecond line', 20)).toEqual(['first', 'second line']);
    expect(wrap('宽', 1)).toEqual(['宽']);
  });
});

describe('roles of values', () => {
  it('reads state words and quiets what says nothing happened', () => {
    expect(roleOf('ready')).toBe('ok');
    expect(roleOf('outdated')).toBe('warn');
    expect(roleOf('blocked')).toBe('fail');
    expect(roleOf('unchanged')).toBe('quiet');
    expect(roleOf(0)).toBe('quiet');
  });

  it('leaves everything else alone, a boolean included', () => {
    for (const value of [true, false, 16, 'dev', 'fx-example-api', '', null, undefined])
      expect(roleOf(value)).toBeUndefined();
  });
});

describe('a table', () => {
  const rows = [
    { name: 'dev', label: '开发环境', picked: true, behind: 0, state: 'ready' },
    { name: 'prod', label: 'Production', picked: false, behind: 16, state: 'blocked' },
  ];
  const wide = [
    { name: 'fx-example-api-with-a-long-name', branch: 'dev', note: 'n'.repeat(80) },
    { name: 'api', branch: 'feature/a-rather-long-branch-name', note: '' },
  ];

  it('lines up columns that hold wide characters', () => {
    expect(humanList(rows, PLAIN, ['name', 'label', 'picked'])).toBe(
      [
        'name  label       picked',
        '----  ----------  ------',
        'dev   开发环境    true',
        'prod  Production  false',
      ].join('\n'),
    );
  });

  it('marks the heading, the rule and each value by what it means', () => {
    expect(tagged(humanList(rows, terminal(), ['name', 'picked', 'behind', 'state']))).toBe(
      [
        '<strong>name</>  <strong>picked</>  <strong>behind</>  <strong>state</>',
        '<quiet>----</>  <quiet>------</>  <quiet>------</>  <quiet>-------</>',
        'dev   true    <quiet>0</>       <ok>ready</>',
        'prod  false   16      <fail>blocked</>',
      ].join('\n'),
    );
  });

  it('shaves the widest columns evenly to fit and keeps the one that names the row', () => {
    expect(lines(humanList(wide, terminal(64)))).toEqual([
      `name${' '.repeat(27)}  branch${' '.repeat(8)}  note`,
      `${'-'.repeat(31)}  ${'-'.repeat(14)}  ${'-'.repeat(14)}`,
      `fx-example-api-with-a-long-name  dev${' '.repeat(11)}  ${'n'.repeat(13)}…`,
      `api${' '.repeat(28)}  feature/a-rat…`,
    ]);
  });

  it('stops at the narrowest useful column and lets a table that cannot fit wrap', () => {
    const fitted = lines(humanList(wide, terminal(30)));
    expect(fitted[2]).toBe(
      `fx-example-api-with-a-long-name  dev${' '.repeat(9)}  ${'n'.repeat(11)}…`,
    );
    expect(widthOf(fitted[2]!)).toBeGreaterThan(30);
  });

  it('shortens a column of wide characters by columns, not characters', () => {
    const fitted = lines(
      humanList([{ name: 'prod', label: '简道云生产环境国内版', note: 'x' }], terminal(24)),
    );
    expect(fitted[2]).toBe('prod  简道云生产…   x');
  });

  it('never shortens what a program may read', () => {
    expect(humanList(wide, PLAIN)).toContain('n'.repeat(80));
  });

  it('says so when there is nothing to list', () => {
    expect(humanList([], PLAIN)).toBe('(none)');
    expect(tagged(humanList([], terminal()))).toBe('<quiet>(none)</>');
  });
});

describe('a record', () => {
  it('quiets keys, heads sections and leaves no trailing space after an absent value', () => {
    const record = { tool: 'logs-cli', env: null, labels: {}, status: 'ready', scope: { n: 1 } };
    expect(humanRecord(record, PLAIN)).toBe(
      ['tool    logs-cli', 'env', 'labels', 'status  ready', 'scope', '  n  1'].join('\n'),
    );
    expect(tagged(humanRecord(record, terminal()))).toBe(
      [
        '<quiet>tool</>    logs-cli',
        '<quiet>env</>',
        '<quiet>labels</>',
        '<quiet>status</>  <ok>ready</>',
        '<strong>scope</>',
        '  <quiet>n</>  1',
      ].join('\n'),
    );
  });

  it('keeps short list items on one line each and drops what has nothing in it', () => {
    const record = {
      steps: [{ id: 'a', state: 'done', note: '' }, { note: null }, { id: 'b', state: 'blocked' }],
    };
    expect(humanRecord(record, PLAIN)).toBe(
      ['steps', '  - id: a, state: done', '  - id: b, state: blocked'].join('\n'),
    );
    expect(tagged(humanRecord(record, terminal())).split('\n')[2]).toBe(
      '  <quiet>-</> <quiet>id:</> b, <quiet>state:</> <fail>blocked</>',
    );
  });

  it('gives every item of a list one field per line once any item runs long', () => {
    const record = {
      platforms: [
        { platform: 'logs', vars: { stream: 'app' }, note: 'x'.repeat(120) },
        { platform: 'ci', vars: {}, note: '' },
      ],
    };
    expect(humanRecord(record, PLAIN)).toBe(
      [
        'platforms',
        '  - platform  logs',
        '    vars      stream=app',
        `    note      ${'x'.repeat(120)}`,
        '  - platform  ci',
      ].join('\n'),
    );
  });

  it('lets a describer lay one key out through the same display', () => {
    const owners = [
      { area: 'Core', scenario: 'Accounts', lead: null, devLead: null, roles: { qa: [] } },
    ];
    const text = humanRecord({ owners }, terminal(), { owners: ownerLines });
    expect(tagged(text)).toBe(
      ['<strong>owners</>', '  <quiet>-</> Core / Accounts', '    <quiet>qa:</> '].join('\n'),
    );
    expect(ownerLines(null, PLAIN)).toEqual(['(no members document)']);
  });
});

describe('what goes to stderr', () => {
  it('labels a notice and points at each next step', () => {
    const notice = { code: 'SCOPE_UNSET', message: 'Everything is selected', nextSteps: ['fx x'] };
    expect(humanNotice(notice, PLAIN)).toBe('notice SCOPE_UNSET: Everything is selected\n  fx x');
    expect(tagged(humanNotice(notice, terminal()))).toBe(
      '<accent>●</> <quiet>SCOPE_UNSET:</> Everything is selected\n  <quiet>→</> fx x',
    );
  });

  it('marks finished and failed progress and keeps the rest quiet in the same column', () => {
    const at = (state: 'start' | 'running' | 'skip' | 'done' | 'fail'): string =>
      tagged(humanProgress({ id: 'api', state, detail: 'clone' }, terminal()));
    const id = `api${' '.repeat(21)}`;
    for (const state of ['start', 'running', 'skip'] as const)
      expect(at(state)).toBe(`  ${id} <quiet>${state}</>  <quiet>clone</>`);
    expect(at('done')).toBe(`<ok>✓</> ${id} <ok>done</>  <quiet>clone</>`);
    expect(at('fail')).toBe(`<fail>✗</> ${id} <fail>fail</>  <quiet>clone</>`);
    expect(humanProgress({ id: 'api', state: 'done', detail: 'clone' }, PLAIN)).toBe(
      `${id} done  clone`,
    );
  });

  it('keeps a diagnostic in the background', () => {
    const event = { kind: 'process' as const, phase: 'version probe', exit_code: 1 };
    expect(humanDiagnostic(event, PLAIN)).toBe('diagnostic process: version probe  exit_code=1');
    expect(tagged(humanDiagnostic(event, terminal()))).toBe(
      '<quiet>diagnostic process: version probe  exit_code=1</>',
    );
  });

  it('lays an error out as text: what failed, why, what to do and what a person must do', () => {
    const plain = {
      category: 'auth' as const,
      code: 'LOGIN_REQUIRED',
      message: 'logs-cli is not signed in',
      hint: 'Sign in with your own account.',
      next_steps: ['fx login logs-cli'],
      retryable: false,
    };
    const handoff = {
      summary: 'A person has to sign in',
      user_steps: [
        {
          id: 'credential',
          kind: 'run' as const,
          title: 'Sign in',
          instructions: 'Use your own account',
          command: ['logs-cli', 'auth', 'login', '--name', 'my team'],
        },
        {
          id: 'token',
          kind: 'file' as const,
          title: 'Save the token',
          open: 'https://logs.example.com/tokens',
          expects: { path: '~/.logs/token' },
        },
      ],
      command: 'fx doctor',
    };
    expect(lines(humanError({ ...plain, handoff }, terminal(), 'posix'))).toEqual([
      '✗ LOGIN_REQUIRED: logs-cli is not signed in',
      '  Sign in with your own account.',
      '  → fx login logs-cli',
      '',
      '  A person has to sign in',
      '  1. Sign in',
      '     Use your own account',
      "     logs-cli auth login --name 'my team'",
      '  2. Save the token',
      '     Open: https://logs.example.com/tokens',
      '     Expected: ~/.logs/token',
      '  → fx doctor',
    ]);
    expect(humanError(plain, PLAIN, 'posix')).toBe(
      [
        'error LOGIN_REQUIRED: logs-cli is not signed in',
        '  Sign in with your own account.',
        '  fx login logs-cli',
      ].join('\n'),
    );
    const twoLines = { ...plain, message: 'Nonexistent flag: --bogus\nSee more help with --help' };
    expect(
      tagged(humanError(twoLines, terminal(), 'posix'))
        .split('\n')
        .slice(0, 2),
    ).toEqual([
      '<fail>✗</> <quiet>LOGIN_REQUIRED:</> <strong>Nonexistent flag: --bogus</>',
      '  See more help with --help',
    ]);
  });
});
