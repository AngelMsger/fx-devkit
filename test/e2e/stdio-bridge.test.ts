import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { mcpLaunch } from '../../src/adapters/agent-host/mcp-launch.js';
import { writeNodeShim } from '../platform.js';

import { freshHome } from './harness.js';

describe('native stdio bridge', () => {
  it('transmits bytes and the server exit code without CLI output', () => {
    const dir = freshHome();
    writeNodeShim(
      dir,
      'server',
      "process.stdin.pipe(process.stdout);process.stdin.on('end',()=>{process.stderr.write(process.env.FX_BRIDGE_TEST);process.exitCode=7;});",
    );
    const bytes = Buffer.from([0, 255, 10, 13, 228, 184, 173]);
    const vector = mcpLaunch(['server'], 'win32');
    const result = spawnSync(vector[0]!, vector.slice(1), {
      input: bytes,
      env: { ...process.env, PATH: dir, FX_BRIDGE_TEST: 'stderr sentinel' },
      timeout: 5000,
    });
    expect(result.status, String(result.stderr)).toBe(7);
    expect(result.stdout).toEqual(bytes);
    expect(result.stderr.toString()).toBe('stderr sentinel');
    expect(vector[1]).toBe(path.resolve('bin/mcp-stdio.js'));
  });

  it('returns a missing-command exit without protocol noise', () => {
    const vector = mcpLaunch(['fx-fixture-missing-binary'], 'win32');
    const result = spawnSync(vector[0]!, vector.slice(1), {
      env: { ...process.env, PATH: '' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(127);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
