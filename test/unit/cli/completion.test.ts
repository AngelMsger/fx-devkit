import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { COMMANDS, compatibilityTarget } from '../../../src/cli/commands/index.js';
import { completionFlags, completionScript } from '../../../src/cli/completion.js';
import { globalFlags } from '../../../src/cli/flags.js';

// The command reads oclif's loaded tree instead; test/e2e/command-tree.test.ts
// holds the two readings to the same ids, flags and compatibility targets.
const commands = Object.entries(COMMANDS)
  .filter(([, command]) => !command.hidden)
  .map(([id, command]) => ({
    id: id.replaceAll(':', ' '),
    aliasOf: compatibilityTarget(id)?.replaceAll(':', ' '),
    flags: completionFlags(command.flags ?? {}),
  }));
const globals = completionFlags(globalFlags);

describe.each(['bash', 'zsh', 'fish', 'powershell'])('completion for %s', (shell) => {
  it('names every command word and the global flags', () => {
    const script = completionScript(shell, commands, globals);
    for (const { id } of commands) for (const word of id.split(' ')) expect(script).toContain(word);
    expect(script).toContain('--format');
    expect(script).toContain('dry-run');
  });
});

describe('completion', () => {
  it('refuses a shell it does not know, with a suggestion', () => {
    let caught: unknown;
    try {
      completionScript('zhs', commands, globals);
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: 'SHELL_UNKNOWN', hint: 'Did you mean "zsh"?' });
  });
});

describe.skipIf(process.platform === 'win32')('native shell completion', () => {
  const script = completionScript('bash', commands, globals);
  function complete(words: string[]): string[] {
    const result = spawnSync(
      'bash',
      [
        '-c',
        script +
          '\nCOMP_WORDS=("$@"); COMP_CWORD=$((${#COMP_WORDS[@]} - 1)); _fx; printf "%s\\n" "${COMPREPLY[@]}"',
        'completion-test',
        ...words,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim().split('\n').filter(Boolean);
  }
  it('completes flags after arguments and option values, including negations and short flags', () => {
    expect(complete(['fx', 'where', 'example', '--env', 'test', '--no-'])).toContain('--no-check');
    expect(complete(['fx', 'repo', 'show', 'example', '--'])).toContain('--format');
    expect(complete(['fx', 'config', 'export', '-'])).toContain('-o');
    expect(complete(['fx', 'sync', '--no-'])).toContain('--no-refresh-manifest');
  });
  it('skips global values when locating command words and completes enum values', () => {
    expect(complete(['fx', '--workspace', 'repo', 'tool', 'inv'])).toEqual(['inventory']);
    expect(complete(['fx', 'repo', '--format', 'json', 'sh'])).toEqual(['show']);
    expect(complete(['fx', 'release', 'check', '--only', 'm'])).toEqual(['merge']);
    expect(complete(['fx', 'release', '--only', 'm'])).toEqual(['merge']);
    expect(complete(['fx', 'repo', 'show', '--workspace', 're'])).toEqual([]);
  });
  it('does not offer commands for positionals or options after the terminator', () => {
    expect(complete(['fx', 'repo', 'show', 'ex'])).toEqual([]);
    expect(complete(['fx', 'repo', 'show', '--', '--'])).toEqual([]);
  });
  it('suggests canonical names while retaining option completion for typed aliases', () => {
    expect(complete(['fx', 'hook', ''])).toEqual(['list', 'enable', 'disable']);
    expect(complete(['fx', 'tool', 'inst'])).toEqual(['install']);
    expect(complete(['fx', 'skill', 'li'])).toEqual([]);
    expect(complete(['fx', 'hook', 'inject', '--d'])).toEqual(['--details', '--dry-run']);
    expect(complete(['fx', 'tool', 'installed', '--format', 'j'])).toEqual(['json']);
    expect(complete(['fx', 'skill', 'list', '--a'])).toEqual(['--allow-writes', '--agent']);
    expect(complete(['fx', 'release', ''])).toEqual(['check']);
    expect(complete(['fx', 'rel'])).toEqual(['release']);
  });
});

it.skipIf(spawnSync('zsh', ['--version']).status !== 0)(
  'runs zsh completion after positionals and global options',
  () => {
    const script = completionScript('zsh', commands, globals);
    const result = spawnSync(
      'zsh',
      [
        '-fc',
        'words=(fx --format json where example --no-); CURRENT=6; compadd() { printf "%s\\n" "$@"; };\n' +
          script,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('--no-check');
  },
);
