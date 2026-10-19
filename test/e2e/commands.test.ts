import { describe, expect, it } from 'vitest';

import { writeNodeShim } from '../platform.js';

import { fx, searchPath, tempDir } from './harness.js';

describe('command resolution', () => {
  it('names human list columns unless the caller asks for headerless output', () => {
    const headed = fx(['tool', 'list', '--quiet']);
    expect(headed.status, headed.stderr).toBe(0);
    expect(headed.stdout.split('\n').slice(0, 2)).toEqual([
      expect.stringContaining('name'),
      expect.stringMatching(/^-+/),
    ]);

    const plain = fx(['tool', 'list', '--quiet', '--no-header']);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stdout.split('\n')[0]).not.toContain('name');
  });

  it('shows help and succeeds for a bare topic', () => {
    const run = fx(['self']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('self info');
  });

  it('fails an unknown child of a topic with a structured usage error', () => {
    const run = fx(['self', 'bogus']);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.error()).toMatchObject({ category: 'usage', code: 'UNKNOWN_COMMAND' });
    expect(run.error().next_steps).toContain('fx self --help');
  });

  it('accepts a global flag before the command words', () => {
    const leading = fx(['--format', 'json', 'config', 'list']);
    expect(leading.status, leading.stderr).toBe(0);
    expect(leading.json()).toMatchObject({ has_more: false });
  });

  it.each([
    { misuse: 'a command flag before the command', argv: ['--fetch', 'status'] },
    { misuse: 'an impossible value of a global flag', argv: ['self', '--format=bogus'] },
    { misuse: 'an unknown flag on a bare topic', argv: ['self', '--bogus'] },
    { misuse: 'a value flag left dangling after a command', argv: ['config', 'list', '--format'] },
  ])('answers $misuse with a usage error', ({ argv }) => {
    const run = fx(argv);
    expect(run.status).toBe(2);
    expect(run.error()).toMatchObject({ category: 'usage', code: 'BAD_FLAG' });
  });

  it('puts the everyday commands before the topics on the root help page', () => {
    const run = fx(['--help']);
    expect(run.status, run.stderr).toBe(0);
    const at = (word: string) => run.stdout.indexOf(word);
    expect(at('EVERYDAY')).toBeGreaterThan(-1);
    expect(at('EVERYDAY')).toBeLessThan(at('TOPICS'));
    expect(at('TOPICS')).toBeLessThan(at('AGENT USAGE'));
    const everyday = run.stdout.slice(at('EVERYDAY'), at('TOPICS'));
    const positions = [
      'init',
      'sync',
      'login',
      'doctor',
      'status',
      'can',
      'where',
      'release check',
      'completion',
    ].map((c) => everyday.indexOf(`  ${c} `));
    expect(positions.every((p, i) => p > -1 && (i === 0 || p > (positions[i - 1] ?? 0)))).toBe(
      true,
    );
    expect(everyday).not.toContain('repo ');
    expect(run.stdout.slice(at('TOPICS'), at('AGENT USAGE'))).toContain('manifest');
    expect(run.stdout).toContain('init/sync/doctor return preparation.state');
  });

  it('rejects contradictory or inert flag combinations before doing any work', () => {
    const cases = [
      ['status', '--dry-run'],
      ['doctor', '--dry-run'],
      ['config', 'export', '--dry-run'],
      ['repo', 'list', '--picked', '--unpicked'],
      ['login', '--list', '--dry-run'],
      ['login', '--list', '--skip-manual'],
    ];
    for (const args of cases) {
      const run = fx([...args, '--format', 'json']);
      expect(run.status, args.join(' ')).toBe(2);
      expect(run.error().code, args.join(' ')).toBe('BAD_FLAG');
    }
  });

  it('points a retired command at its replacement and carries its flags over', () => {
    const run = fx(['skill', 'sync', '--dry-run', '--format', 'json']);
    expect(run.status).toBe(2);
    expect(run.error()).toMatchObject({
      code: 'UNKNOWN_COMMAND',
      hint: expect.stringContaining('fx sync --only skills --dry-run'),
    });
    expect(run.error().next_steps[0]).toBe('fx sync --only skills --dry-run --format json');
    const version = fx(['version', '--format', 'json']);
    expect(version.status).toBe(2);
    expect(version.error().next_steps[0], 'a bare flag takes nothing with it').toBe('fx --version');
  });

  it('suggests the nearest command for a typo', () => {
    const run = fx(['statsu', '--format', 'json']);
    expect(run.status).toBe(2);
    expect(run.error().hint).toContain('fx status');
  });
});

describe('consistent command selections', () => {
  it.each(['install', 'update'])('requires names or --all for tool %s', (action) => {
    for (const extra of [[], ['bitbucket-cli', '--all']]) {
      const run = fx(['tool', action, ...extra, '--dry-run', '--format', 'json']);
      expect(run.status).toBe(2);
      expect(run.error().code).toBe('BAD_FLAG');
    }
    const installers = tempDir('fx-installers-');
    writeNodeShim(installers, 'npm', '');
    const all = fx(['tool', action, '--all', '--dry-run', '--format', 'json'], {
      PATH: searchPath(installers),
    });
    expect(all.status, all.stderr).toBe(0);
  });
  it('accepts global flags around root help', () => {
    for (const argv of [
      ['--format', 'json', '--help'],
      ['--help', '--format', 'json'],
    ]) {
      const run = fx(argv);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('EVERYDAY');
    }
  });
  it.each([
    ['agent', 'skills'],
    ['tool', 'inventory'],
    ['hook', 'enable'],
    ['hook', 'disable'],
    ['manifest', 'repo-set'],
    ['manifest', 'record-probe'],
  ])('exposes the canonical command %s %s', (topic, command) => {
    const run = fx([topic, command, '--help']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`${topic} ${command}`);
  });
  it('reports global agent scope and accepts comma-separated standalone agents', () => {
    const result = fx(['agent', 'pick', 'codex', '--dry-run', '--format', 'json']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ scope: 'global', affected_workspaces: [] });
    const targets = fx(['skill', 'path', '--agent', 'codex,claude-code', '--format', 'json']);
    expect(targets.status, targets.stderr).toBe(0);
    expect(targets.json()).toMatchObject({ items: [{ agent: 'claude-code' }, { agent: 'codex' }] });
  });
});
