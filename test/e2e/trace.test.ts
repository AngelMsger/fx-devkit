// FX_TRACE: every invocation leaves one line, whether it was routed away,
// failed inside a command, or succeeded; an unwritable file costs nothing.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fx, tempDir } from './harness.js';

function lines(file: string): Record<string, unknown>[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('FX_TRACE', () => {
  it('appends one record per invocation with the exit and the failure code', () => {
    const file = path.join(tempDir('fx-trace-'), 'trace.jsonl');
    const env = { FX_TRACE: file };
    expect(fx(['config', 'list', '--format', 'json'], env).status).toBe(0);
    expect(fx(['self', 'bogus'], env).status).toBe(2);
    expect(fx(['repo', 'show', 'nope', '--format', 'json'], env).status).not.toBe(0);
    const records = lines(file);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ argv: ['config', 'list', '--format', 'json'], exit: 0 });
    expect(records[0]).not.toHaveProperty('code');
    expect(records[1]).toMatchObject({ argv: ['self', 'bogus'], exit: 2, code: 'UNKNOWN_COMMAND' });
    expect(records[2]).toMatchObject({ code: expect.any(String), exit: expect.any(Number) });
    expect(records[2]!['exit']).not.toBe(0);
    for (const r of records)
      expect(r).toMatchObject({ ms: expect.any(Number), cwd: expect.any(String) });
  });

  it('never fails the command when the file cannot be written', () => {
    const missing = path.join(tempDir('fx-trace-'), 'no', 'dir', 'trace.jsonl');
    const run = fx(['config', 'list', '--format', 'json'], { FX_TRACE: missing });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe('');
  });
});
