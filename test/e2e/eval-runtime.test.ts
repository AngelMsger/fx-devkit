// The trial launcher must expose fx to a fresh child shell and collect its
// trace without relying on the operator's interactive aliases or home.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { userHome } from './harness.js';

// This case tests the POSIX evaluation launcher; native Windows has its own check entry.
it.skipIf(process.platform === 'win32')(
  'a trial shell discovers fx and writes one trace even when its path contains spaces',
  () => {
    const root = mkdtempSync(path.join(tmpdir(), 'fx evaluation '));
    const result = spawnSync('bash', ['docs/eval/sandbox.sh', 'smoke'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: userHome, EVAL: root },
    });
    expect(result.status, result.stderr).toBe(0);
    const smoke = readdirSync(root).find((name) => name.startsWith('smoke.'));
    expect(smoke).toBeDefined();
    const records = readFileSync(path.join(root, smoke!, 'trace.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line: string) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ argv: ['config', 'list', '--format', 'json'], exit: 0 });
    expect(() =>
      JSON.parse(readFileSync(path.join(root, smoke!, 'result.json'), 'utf8')),
    ).not.toThrow();
  },
);
