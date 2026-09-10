import { describe, expect, it } from 'vitest';

import { COMMANDS } from '../../../src/cli/commands/index.js';
import { completionScript } from '../../../src/cli/completion.js';
import { globalFlags } from '../../../src/cli/flags.js';

const commands = Object.entries(COMMANDS).map(([id, command]) => ({
  id: id.replaceAll(':', ' '),
  flags: Object.keys((command as { flags?: object }).flags ?? {}),
}));
const globals = Object.keys(globalFlags);

describe.each(['bash', 'zsh', 'fish', 'powershell'])('completion for %s', (shell) => {
  it('names every command word and the global flags', () => {
    const script = completionScript(shell, commands, globals);
    for (const { id } of commands) for (const word of id.split(' ')) expect(script).toContain(word);
    expect(script).toContain(shell === 'fish' ? '-l format' : '--format');
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
