import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fx } from './harness.js';

describe('public discovery contracts', () => {
  it.each([
    { command: [], lastSection: 'TOPICS' },
    { command: ['repo'], lastSection: 'COMMANDS' },
    { command: ['repo', 'list'], lastSection: 'EXAMPLES' },
  ])('puts Agent guidance after normal help for $command', ({ command, lastSection }) => {
    const result = fx([...command, '--help']);
    expect(result.status, result.stderr).toBe(0);
    const agentStart = result.stdout.indexOf('AGENT USAGE');
    const normalSection = result.stdout.indexOf(lastSection);
    expect(normalSection).toBeGreaterThanOrEqual(0);
    expect(agentStart).toBeGreaterThan(normalSection);
    expect(result.stdout.match(/AGENT USAGE/g)).toHaveLength(1);
    expect(result.stdout.trimEnd()).toMatch(
      /Set FX_FORMAT=json to apply the format to a whole session\.$/,
    );
  });

  it.each(['bash', 'zsh', 'fish', 'powershell'])(
    'keeps internal dispatch out of %s completion',
    (shell) => {
      const result = fx(['completion', shell]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain('dispatch');
    },
  );

  it('does not suggest hidden lifecycle commands for misspelled public invocations', () => {
    const result = fx(['hook', 'dispacth', '--format', 'json']);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('hook dispatch');
    expect(result.error().next_steps).toContain('fx hook --help');
  });

  it('documents parameter semantics and hides internal commands', () => {
    const reference = readFileSync('docs/cli/README.md', 'utf8');
    expect(reference).not.toContain('fx hook dispatch');
    expect(reference).toContain('--check / --no-check');
    expect(reference).toContain('default: true');
    expect(reference).toContain('(variadic)');
    expect(reference).toContain('repeatable');
    expect(reference).toContain('exclusive with:');
    expect(reference).toContain('requires: --fetch');
    expect(reference.split('\n').find((line) => line.startsWith('| `--from`'))).toContain(
      '(required)',
    );
  });
});

it('separates compatibility names from primary topic help and explains alias help', () => {
  const topic = fx(['--format', 'json', 'hook', '--help']);
  expect(topic.status, topic.stderr).toBe(0);
  const primary = topic.stdout.split('COMMANDS')[1]?.split('COMPATIBILITY')[0] ?? '';
  expect(primary).toContain('hook enable');
  expect(primary).toContain('hook disable');
  expect(primary).not.toContain('hook inject');
  expect(primary).not.toContain('hook remove');
  expect(topic.stdout).toContain('hook inject -> hook enable');
  const alias = fx(['hook', 'inject', '--help']);
  expect(alias.status, alias.stderr).toBe(0);
  expect(alias.stdout).toContain('Use fx hook enable for this operation.');
  const typo = fx(['hook', 'injec', '--format', 'json']);
  expect(typo.status).toBe(2);
  expect(typo.stderr).not.toContain('Did you mean `fx hook inject`');
});

it('allows leading global flags on a bare topic and still rejects invalid values', () => {
  const result = fx(['--quiet', '--format', 'json', 'self']);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('self info');
  for (const argv of [
    ['--format', 'bogus', 'self'],
    ['--format', 'json', 'self', '--bogus'],
  ]) {
    const invalid = fx(argv);
    expect(invalid.status).toBe(2);
    expect(invalid.error().code).toBe('BAD_FLAG');
  }
});
