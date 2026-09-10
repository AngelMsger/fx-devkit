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
