import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { tempDir } from '../../temp.js';

const node = process.execPath;

describe('NodeProcess', () => {
  it('passes every argument verbatim, without a shell', async () => {
    // A script file, not -e: Bun on Windows numbers the arguments of -e differently.
    const echoArgs = path.join(tempDir('fx-node-process-'), 'echo.js');
    writeFileSync(echoArgs, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const result = await new NodeProcess().run([node, echoArgs, 'a b', 'c;d', '$HOME']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['a b', 'c;d', '$HOME']);
  });

  it('captures stderr and the exit code', async () => {
    const result = await new NodeProcess().run([
      node,
      '-e',
      'console.error("bad"); process.exit(3)',
    ]);
    expect(result).toMatchObject({ code: 3, stderr: 'bad\n' });
  });

  it('reports a missing binary as exit 127 instead of throwing', async () => {
    const result = await new NodeProcess().run(['definitely-not-a-binary-xyz', '--version']);
    expect(result.code).toBe(127);
    expect(result.stderr).toContain('definitely-not-a-binary-xyz');
    expect(result.notStarted).toBe(true);
  });

  it('does not take a program that started and exited 127 for one that never started', async () => {
    const result = await new NodeProcess().run([
      node,
      '-e',
      'console.error("helper executable unavailable"); process.exit(127)',
    ]);
    expect(result).toEqual({ code: 127, stdout: '', stderr: 'helper executable unavailable\n' });
  });

  it('kills a process that exceeds its timeout', async () => {
    await expect(
      new NodeProcess().run([node, '-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }),
    ).rejects.toMatchObject({ category: 'internal', code: 'PROCESS_TIMEOUT' });
  });

  it('gives up at once on a signal that was already aborted, timeout or not', async () => {
    const control = new AbortController();
    control.abort();
    const started = Date.now();
    await expect(
      new NodeProcess().run([node, '-e', 'setTimeout(()=>{},5000)'], {
        signal: control.signal,
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('gives up on a process when its signal is aborted', async () => {
    const control = new AbortController();
    const started = Date.now();
    const run = new NodeProcess().run([node, '-e', 'setTimeout(()=>{},5000)'], {
      signal: control.signal,
    });
    setTimeout(() => control.abort(), 50);
    await expect(run).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('gives up on the helpers a child spawned too, and does not wait on their pipes', async () => {
    const started = Date.now();
    await expect(
      new NodeProcess().run(
        [
          node,
          '-e',
          'require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},5000)"],{stdio:"inherit"});setTimeout(()=>{},5000)',
        ],
        { timeoutMs: 100 },
      ),
    ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('feeds stdin and honours cwd', async () => {
    const result = await new NodeProcess().run(
      [
        node,
        '-e',
        'process.stdin.on("data", (d) => process.stdout.write(process.cwd() + ":" + d))',
      ],
      { input: 'hello', cwd: process.cwd() },
    );
    expect(result.stdout).toBe(process.cwd() + ':hello');
  });

  it('finds an executable on PATH and reports an unknown one as absent', async () => {
    const found = await new NodeProcess().which('node');
    expect(found).toBeDefined();
    expect(await new NodeProcess().which('definitely-not-a-binary-xyz')).toBeUndefined();
  });
});
