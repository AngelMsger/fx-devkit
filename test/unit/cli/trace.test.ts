import { describe, expect, it } from 'vitest';

import { Trace } from '../../../src/cli/trace.js';
import { DevkitError } from '../../../src/domain/errors.js';

function sink() {
  const lines: string[] = [];
  return { lines, write: async (line: string) => void lines.push(line) };
}

describe('Trace', () => {
  it('writes one JSON line per invocation: argv, exit, duration, cwd, and no code on success', async () => {
    const s = sink();
    const trace = new Trace(s.write, 1000);
    await trace.end(['repo', 'list'], 0, 1250);
    expect(s.lines).toHaveLength(1);
    const record = JSON.parse(s.lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({ argv: ['repo', 'list'], exit: 0, ms: 250, cwd: process.cwd() });
    expect(record['ts']).toEqual(expect.any(String));
    expect(record).not.toHaveProperty('code');
    expect(s.lines[0]!.endsWith('\n')).toBe(true);
  });

  it('carries the code of the failure a command reported', async () => {
    const s = sink();
    const trace = new Trace(s.write, 0);
    trace.failed(new DevkitError('usage', 'UNKNOWN_COMMAND', 'nope'));
    await trace.end(['nope'], 2, 5);
    expect(JSON.parse(s.lines[0]!)).toMatchObject({ exit: 2, code: 'UNKNOWN_COMMAND' });
  });

  it('loses the line, not the command, when the sink fails', async () => {
    const trace = new Trace(async () => {
      throw new Error('EACCES');
    }, 0);
    await expect(trace.end(['status'], 0, 1)).resolves.toBeUndefined();
  });
});
