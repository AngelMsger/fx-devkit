import { describe, expect, it } from 'vitest';

import {
  changeDirectoryCommand,
  resolveCommandShell,
  shellLine,
} from '../../../src/domain/shell.js';

describe('shellLine', () => {
  it('selects presentation independently of the operating system when overridden', () => {
    expect(resolveCommandShell('auto', true)).toBe('powershell');
    expect(resolveCommandShell('auto', false)).toBe('posix');
    expect(resolveCommandShell('cmd', false)).toBe('cmd');
    expect(() => resolveCommandShell('unknown', true)).toThrow();
    expect(shellLine(['tool', "it's $value; `command`"], 'powershell')).toBe(
      "& 'tool' 'it''s $value; `command`'",
    );
    expect(changeDirectoryCommand('D:\\Work Space', 'powershell')).toBe(
      "Set-Location -LiteralPath 'D:\\Work Space'",
    );
    expect(changeDirectoryCommand('D:\\Work Space', 'cmd')).toBe('cd /d D:\\Work^ Space');
  });
  it('quotes only what a shell would misread', () => {
    expect(shellLine(['kubectl', '-n', 'fx', 'get', 'pods'])).toBe('kubectl -n fx get pods');
    expect(shellLine(['sentry-cli', 'issues', 'list', '--query', "is:unresolved it's"])).toBe(
      "sentry-cli issues list --query 'is:unresolved it'\\''s'",
    );
    expect(shellLine(['x', '{stream}', 'a b'])).toBe("x '{stream}' 'a b'");
  });
});
