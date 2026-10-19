// A command reads stdin only where it names it as a source; a missing argument is never
// taken from data that happens to be waiting there.
import { describe, expect, it } from 'vitest';

import { fx, freshHome } from './harness.js';

describe('explicit input boundaries', () => {
  it.each([
    ['repo', 'show'],
    ['config', 'get'],
    ['member', 'show'],
  ])('does not take missing %j arguments from stdin', (...args) => {
    const result = fx([...args, '--format', 'json'], {}, undefined, 'unexpected-input');
    expect(result.status).toBe(2);
    expect(result.error().code).toBe('BAD_FLAG');
    expect(result.stderr).not.toContain('unexpected-input');
  });
  it('classifies a quoted command as usage and continues to accept explicit stdin sources', () => {
    const invalid = fx(['manifest lint', '--format', 'json']);
    expect(invalid.status).toBe(2);
    expect(invalid.error().code).toBe('UNKNOWN_COMMAND');
    const input = fx(
      ['init', freshHome(), '--from', '-', '--dry-run', '--format', 'json'],
      {},
      undefined,
      'schema_version: 2\ndefaults: { branch: main }\nrepos: [{name: sample, upstream: https://git.example.com/team/sample.git}]',
    );
    expect(input.status).toBe(0);
  });
});
