import { describe, expect, it } from 'vitest';

import { normalizeArgv, routeArgv } from '../../../src/cli/route.js';

const ids = ['status', 'self info', 'config get', 'config set', 'config list'];

describe('routeArgv', () => {
  it.each([
    ['--format', 'json', 'self'],
    ['--workspace=example', 'self', '--help'],
    ['--quiet', 'config', '--format', 'json', '--help'],
  ])('accepts global flags before a bare topic: %j', (...argv) => {
    expect(routeArgv(normalizeArgv(argv, ids), ids)).toEqual({ kind: 'run' });
  });

  it.each([
    ['--command-shell', 'cmd', 'config', 'list'],
    ['config', '--command-shell=cmd', 'list'],
    ['config', 'list', '--command-shell', 'cmd'],
  ])('routes global shell flags consistently: %j', (...argv) => {
    expect(routeArgv(normalizeArgv(argv, ids), ids)).toEqual({ kind: 'run' });
  });

  it('validates the shell enum on a bare topic instead of reporting successful help', () => {
    expect(routeArgv(['config', '--command-shell', 'invalid'], ids)).toEqual({
      kind: 'bad-flag-value',
      flag: '--command-shell',
      value: 'invalid',
    });
  });

  it('reports invalid leading global values as value errors, not misplaced flags', () => {
    expect(
      routeArgv(normalizeArgv(['--command-shell', 'invalid', 'config', 'list'], ids), ids),
    ).toEqual({ kind: 'bad-flag-value', flag: '--command-shell', value: 'invalid' });
    expect(routeArgv(normalizeArgv(['--command-shell'], ids), ids)).toEqual({
      kind: 'bad-flag-value',
      flag: '--command-shell',
    });
  });

  it('runs a known command, including one followed by its own arguments', () => {
    expect(routeArgv(['config', 'get', 'format', '--explain'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['status'], ids)).toEqual({ kind: 'run' });
  });

  it('lets a bare topic or an empty invocation fall through to help', () => {
    expect(routeArgv([], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['config'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['--help'], ids)).toEqual({ kind: 'run' });
  });

  it('rejects an unknown child of a topic and points at the nearest sibling', () => {
    expect(routeArgv(['config', 'gett', 'format'], ids)).toEqual({
      kind: 'unknown',
      attempted: 'config gett',
      nearest: 'config get',
      help: 'config --help',
    });
  });

  it('rejects an unknown top-level word and points at the nearest command', () => {
    expect(routeArgv(['statsu'], ids)).toEqual({
      kind: 'unknown',
      attempted: 'statsu',
      nearest: 'status',
      help: '--help',
    });
  });

  it('sees through global flags standing between the command words', () => {
    expect(routeArgv(['config', '--format=json', 'list'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['config', '--format', 'json', 'list'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['self', '--format', 'json', 'bogus'], ids)).toEqual({
      kind: 'unknown',
      attempted: 'self bogus',
      help: 'self --help',
    });
  });

  it('moves valid global flags behind the complete command and leaves other leading flags invalid', () => {
    expect(normalizeArgv(['--format', 'json', 'config', 'list', '--quiet'], ids)).toEqual([
      'config',
      'list',
      '--format',
      'json',
      '--quiet',
    ]);
    expect(normalizeArgv(['config', '--format=json', 'list'], ids)).toEqual([
      'config',
      'list',
      '--format=json',
    ]);
    expect(routeArgv(normalizeArgv(['--format', 'json', 'config', 'list'], ids), ids)).toEqual({
      kind: 'run',
    });
    expect(routeArgv(normalizeArgv(['--format', 'json', 'self', 'bogus'], ids), ids)).toMatchObject(
      {
        kind: 'unknown',
        attempted: 'self bogus',
      },
    );
    expect(normalizeArgv(['--fetch', 'status'], ids)).toEqual(['--fetch', 'status']);
    expect(routeArgv(['--fetch', 'status'], ids)).toEqual({
      kind: 'misplaced-flag',
      flag: '--fetch',
    });
    expect(routeArgv(['--help=x'], ids)).toEqual({ kind: 'misplaced-flag', flag: '--help=x' });
    expect(routeArgv(['-v=x'], ids)).toEqual({ kind: 'misplaced-flag', flag: '-v=x' });
    expect(routeArgv(['--help'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['-v'], ids)).toEqual({ kind: 'run' });
  });

  it('reports an impossible or missing --format value wherever it hides', () => {
    expect(routeArgv(['self', '--format', 'bogus'], ids)).toEqual({
      kind: 'bad-flag-value',
      flag: '--format',
      value: 'bogus',
    });
    expect(routeArgv(['self', '--format=bogus'], ids)).toEqual({
      kind: 'bad-flag-value',
      flag: '--format',
      value: 'bogus',
    });
    expect(routeArgv(['self', '--fields'], ids)).toEqual({
      kind: 'bad-flag-value',
      flag: '--fields',
    });
    expect(routeArgv(['self', '--fields='], ids)).toEqual({
      kind: 'bad-flag-value',
      flag: '--fields',
      value: '',
    });
    expect(routeArgv(['self', '--workspace'], ids)).toEqual({
      kind: 'bad-flag-value',
      flag: '--workspace',
    });
    expect(routeArgv(['self', '--fields=x', 'bogus'], ids)).toMatchObject({
      kind: 'unknown',
      attempted: 'self bogus',
    });
    // After a complete command the scan stops; oclif's own strict parse
    // answers a dangling value flag there (see the commands e2e).
    expect(routeArgv(['config', 'list', '--format'], ids)).toEqual({ kind: 'run' });
  });

  it('does not let a bare topic swallow tokens hidden behind --', () => {
    expect(routeArgv(['self', '--', 'bogus'], ids)).toEqual({
      kind: 'unknown',
      attempted: 'self bogus',
      help: 'self --help',
    });
    expect(routeArgv(['config', 'set', '--', '--weird-value'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['config', '--'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['--', 'bogus'], ids)).toMatchObject({ kind: 'unknown', attempted: 'bogus' });
  });

  it('refuses a flag no global owns on a bare topic, and tolerates the harmless globals', () => {
    expect(routeArgv(['self', '--bogus'], ids)).toEqual({
      kind: 'stray-flag',
      topic: 'self',
      flag: '--bogus',
    });
    expect(routeArgv(['self', '--bogus=x'], ids)).toEqual({
      kind: 'stray-flag',
      topic: 'self',
      flag: '--bogus',
    });
    expect(routeArgv(['self', '-x'], ids)).toEqual({
      kind: 'stray-flag',
      topic: 'self',
      flag: '-x',
    });
    expect(routeArgv(['self', '--quiet'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['self', '--format', 'json'], ids)).toEqual({ kind: 'run' });
    expect(routeArgv(['self', '--quiet=true'], ids)).toEqual({
      kind: 'stray-flag',
      topic: 'self',
      flag: '--quiet=true',
    });
    expect(routeArgv(['self', '--yes=no'], ids)).toMatchObject({ kind: 'stray-flag' });
    expect(routeArgv(['self', '--help=x'], ids)).toMatchObject({ kind: 'stray-flag' });
  });

  it('names the replacement of a retired command instead of guessing', () => {
    expect(routeArgv(['setup', '--list'], ids)).toMatchObject({
      kind: 'unknown',
      attempted: 'setup',
      replacement: ['login --list'],
    });
    expect(routeArgv(['obs', 'where', 'a', '--env', 'dev'], ids)).toMatchObject({
      attempted: 'obs where',
      replacement: ['where a --env dev'],
    });
    expect(routeArgv(['obs', 'probe', 'a', '--env', 'dev'], ids)).toMatchObject({
      replacement: ['where a --env dev --probe'],
    });
    expect(routeArgv(['need', 'ci', '--env', 'dev', '--repo', 'a'], ids)).toMatchObject({
      replacement: ['where a --env dev', 'can ci --env dev'],
    });
    expect(routeArgv(['need', 'bitbucket-cli'], ids)).toMatchObject({
      replacement: ['can bitbucket-cli'],
    });
    expect(routeArgv(['docs', 'render', '--check'], ids)).toMatchObject({
      replacement: ['manifest render --check', 'sync --only docs'],
    });
    expect(routeArgv(['tool', 'check', 'a', 'b', '--format', 'json'], ids)).toMatchObject({
      replacement: ['doctor --tool a --tool b --format json'],
    });
    expect(routeArgv(['member', 'owners', 'a'], ids)).toMatchObject({
      replacement: ['repo show a'],
    });
    expect(routeArgv(['self', 'version'], ids)).toMatchObject({
      attempted: 'self version',
      replacement: ['--version'],
    });
    expect(routeArgv(['need', 'ci', '--repo=a', '--env', 'dev'], ids)).toMatchObject({
      replacement: ['where a --env dev', 'can ci --env dev'],
    });
    expect(routeArgv(['need', '--env', 'dev', 'ci', '--repo', 'a'], ids)).toMatchObject({
      replacement: ['where a --env dev', 'can --env dev ci'],
    });
    expect(routeArgv(['tool', 'check', '--quiet', 'a', '--yes', 'b'], ids)).toMatchObject({
      replacement: ['doctor --quiet --tool a --yes --tool b'],
    });
    expect(routeArgv(['skill', 'sync', '--dry-run', '--format', 'json'], ids)).toMatchObject({
      replacement: ['sync --only skills --dry-run --format json'],
    });
    expect(
      routeArgv(['skill', 'install', '--tools', '--agent', 'codex', '--yes', '--dry-run'], ids),
    ).toMatchObject({ replacement: ['sync --only skills --yes --dry-run'] });
    expect(routeArgv(['agent', 'detect', '--format', 'json'], ids)).toMatchObject({
      replacement: ['agent list --format json'],
    });
    expect(routeArgv(['config', 'path', '--format=json'], ids)).toMatchObject({
      replacement: ['self info --format json'],
    });
    expect(routeArgv(['docs', 'render', '--check', '--format', 'json'], ids)).toMatchObject({
      replacement: ['manifest render --check --format json', 'sync --only docs --format json'],
    });
  });

  it('omits the suggestion when nothing is close', () => {
    expect(routeArgv(['zzzzzzzz'], ids)).toEqual({
      kind: 'unknown',
      attempted: 'zzzzzzzz',
      help: '--help',
    });
  });
});
