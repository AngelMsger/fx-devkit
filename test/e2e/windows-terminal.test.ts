import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { completionScript } from '../../src/cli/completion.js';

import { freshHome, fx, userHome } from './harness.js';

describe('command shell configuration', () => {
  it('round-trips the setting and honours the global flag', () => {
    const env = { FX_HOME: freshHome(), FX_COMMAND_SHELL: undefined };
    expect(fx(['config', 'set', 'command_shell', 'powershell'], env).status).toBe(0);
    expect(fx(['config', 'get', 'command_shell', '--format', 'json'], env).stdout).toContain(
      'powershell',
    );
    expect(fx(['config', 'list', '--command-shell', 'cmd', '--format', 'json'], env).status).toBe(
      0,
    );
    expect(fx(['config', 'list', '--command-shell', 'invalid'], env).status).toBe(2);
  });
});

describe.runIf(process.platform === 'win32')('native Windows terminals', () => {
  it.each(['powershell.exe', 'pwsh.exe'])(
    'loads completion in %s and completes commands',
    (shell) => {
      const dir = freshHome();
      const file = path.join(dir, 'completion.ps1');
      const script = completionScript(
        'powershell',
        [{ id: 'repo list', flags: ['dry-run'] }],
        ['format'],
      );
      writeFileSync(
        file,
        '\ufeff' +
          script +
          "\n$r=[System.Management.Automation.CommandCompletion]::CompleteInput('fx repo l',9,$null);$r.CompletionMatches.CompletionText | ConvertTo-Json -Compress\n",
      );
      const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', file], {
        encoding: 'utf8',
        env: { ...process.env, HOME: userHome, USERPROFILE: userHome },
      });
      expect(result.error, `${shell} is required by the Windows acceptance matrix`).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('list');
    },
  );
});
