import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { completionFlags, completionScript } from '../../src/cli/completion.js';

import { freshHome, fx, tempDir, userHome } from './harness.js';

describe('command shell configuration', () => {
  it('round-trips the setting', () => {
    const env = { FX_HOME: freshHome(), FX_COMMAND_SHELL: undefined };
    expect(fx(['config', 'set', 'command_shell', 'powershell'], env).status).toBe(0);
    expect(fx(['config', 'get', 'command_shell', '--format', 'json'], env).stdout).toContain(
      'powershell',
    );
  });

  it('retains the selected shell in initialization preview and service recovery', () => {
    const base = tempDir('fx-shell-init-');
    const source = path.join(base, 'source');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(source, 'manifest/workspace.yaml'),
      `schema_version: 2
providers:
  code-host:
    provider: bitbucket-cli
    vars: {host: 'ssh://git@git.example.com'}
    service: {base_url: 'https://git.example.com', context: team, flavor: datacenter, auth_scheme: pat}
defaults: {upstream_project: team, branch: main}
repos: [{name: app}]
`,
    );
    writeFileSync(
      path.join(source, 'manifest/tools.yaml'),
      'schema_version: 3\ntools: [{name: bitbucket-cli, binary: fixture-shell-missing, install: [{via: manual}], skill: {command: []}}]\n',
    );
    const env = { FX_HOME: freshHome(), FX_AGENTS: 'codex' };
    const args = [
      'init',
      path.join(base, 'workspace'),
      '--from',
      source,
      '--name',
      'shell',
      '--no-repos',
      '--command-shell',
      'powershell',
      '--format',
      'json',
    ];
    const recovery = expect.objectContaining({
      id: 'bitbucket-cli.service',
      status: 'blocked',
      next_steps: [
        "& 'fx' 'doctor' '--tool' 'bitbucket-cli' '--workspace' 'shell'",
        "& 'fx' 'tool' 'update' 'bitbucket-cli' '--workspace' 'shell'",
      ],
    });
    const preview = fx([...args, '--dry-run'], env);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json()).toMatchObject({
      plan: {
        resources: {
          preparation: { services: { details: { items: expect.arrayContaining([recovery]) } } },
        },
      },
    });
    const applied = fx(args, env);
    expect(applied.status, applied.stderr).toBe(12);
    expect(applied.json()).toMatchObject({
      sync: { stage_details: { services: { items: expect.arrayContaining([recovery]) } } },
    });
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
        [{ id: 'repo list', flags: completionFlags({ 'dry-run': { type: 'boolean' } }) }],
        completionFlags({ format: { type: 'option' } }),
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
