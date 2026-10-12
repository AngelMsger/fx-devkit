// A supervised worker that gives up on one companion command, in real
// processes: what survives it depends on whether a host is waiting on the run.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NodeLifecycleRunner } from '../../src/adapters/process/lifecycle-runner.js';
import type { LifecycleRole } from '../../src/ports/lifecycle-runner.js';

import { tempDir } from './harness.js';

const adapter = pathToFileURL(path.resolve('dist/adapters/process/node-process.js')).href;

// The companion command outlives its budget; the line after it stands for every
// later phase of the run.
function worker(dir: string): string {
  return [
    `import { NodeProcess } from ${JSON.stringify(adapter)};`,
    "import { writeFileSync } from 'node:fs';",
    "const outcome = await new NodeProcess().run([process.execPath, '-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 300 }).then(() => 'resolved', (error) => error.code);",
    `writeFileSync(${JSON.stringify(path.join(dir, 'outcome'))}, outcome);`,
    "process.stdout.write('later phase');",
  ].join('\n');
}

function supervise(dir: string, role: LifecycleRole): { run: Promise<string>; reasons: string[] } {
  const reasons: string[] = [];
  return {
    reasons,
    run: new NodeLifecycleRunner((reason) => reasons.push(reason)).run({
      vector: [process.execPath, '--input-type=module', '-e', worker(dir)],
      input: Promise.resolve('{}'),
      timeoutMs: 10000,
      role,
    }),
  };
}

describe('a supervised worker whose companion command exhausts its budget', () => {
  it('keeps a background run going, so its later phases still answer', async () => {
    const dir = tempDir('fx-background-worker-');
    const supervised = supervise(dir, 'background');
    expect(await supervised.run).toBe('later phase');
    expect(supervised.reasons).toEqual([]);
    expect(readFileSync(path.join(dir, 'outcome'), 'utf8')).toBe('PROCESS_TIMEOUT');
  }, 20000);

  it('ends a run a host is waiting on, leaving nothing after it', async () => {
    const dir = tempDir('fx-foreground-worker-');
    const supervised = supervise(dir, 'foreground');
    expect(await supervised.run).toBe('');
    expect(supervised.reasons).toEqual(['HOOK_ABORTED']);
    expect(existsSync(path.join(dir, 'outcome'))).toBe(false);
  }, 20000);
});
