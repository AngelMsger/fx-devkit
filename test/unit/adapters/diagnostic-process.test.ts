// The diagnostic process records subprocess outcomes without changing them,
// and removes credentials before a record can reach stderr.

import { describe, expect, it } from 'vitest';

import { DiagnosticProcess } from '../../../src/adapters/process/diagnostic-process.js';
import type { DiagnosticEvent } from '../../../src/ports/diagnostics.js';
import { FakeProcess } from '../../fakes/fake-process.js';

describe('DiagnosticProcess', () => {
  it('reports the command outcome with credentials redacted and output bounded', async () => {
    const process = new FakeProcess().always({
      code: 17,
      stdout: '',
      stderr: `Authorization: Bearer private-token\n${'x'.repeat(5000)}`,
    });
    const events: DiagnosticEvent[] = [];
    const observed = new DiagnosticProcess(process, { emit: (event) => events.push(event) });

    const result = await observed.run(
      ['client', '--token', 'private-token', 'https://user:password@example.com/api'],
      {
        cwd: '/work',
        timeoutMs: 5000,
        diagnostic: {
          phase: 'provider query',
          capability: 'ci',
          provider: 'jenkins-cli',
          binding: 'builds',
        },
      },
    );

    expect(result.code).toBe(17);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'process',
        phase: 'provider query',
        vector: ['client', '--token', '[REDACTED]', 'https://user:[REDACTED]@example.com/api'],
        cwd: '/work',
        timeout_ms: 5000,
        exit_code: 17,
        capability: 'ci',
        provider: 'jenkins-cli',
        binding: 'builds',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('private-token');
    expect(JSON.stringify(events).length).toBeLessThan(4600);
  });
  it('omits sensitive command output even when its value has no recognizable credential shape', async () => {
    const events: DiagnosticEvent[] = [];
    const observed = new DiagnosticProcess(
      new FakeProcess().always({ code: 8, stdout: 'opaque-value', stderr: 'opaque-value' }),
      { emit: (event) => events.push(event) },
    );
    await observed.run(['checker', 'status'], { sensitiveOutput: true });
    expect(events[0]?.exit_code).toBe(8);
    expect(JSON.stringify(events)).not.toContain('opaque-value');
  });
});
