import { describe, expect, it } from 'vitest';

import { errorEnvelope, stderrReason } from '../../../../src/domain/toolchain/stderr.js';

const NOTICE = '{"_notice":{"skill":{"name":"jenkins","message":"load it {first}"}}}';
const PRETTY =
  '{\n  "error": {\n    "code": "AUTH_NO_TOKEN",\n    "message": "token auth requires a token"\n  }\n}\n';

describe('stderrReason', () => {
  it('reads the error envelope past the notice, pretty-printed or not', () => {
    expect(stderrReason(`${NOTICE}\n${PRETTY}`, 3)).toBe('token auth requires a token');
    expect(stderrReason('{"error":{"message":"job not found"}}\n', 6)).toBe('job not found');
  });

  it('falls back to the first plain line, then to the exit code', () => {
    expect(stderrReason('\n  fatal: no such job\nmore\n', 1)).toBe('fatal: no such job');
    expect(stderrReason(`${NOTICE}\n`, 4)).toBe('exit 4');
    expect(stderrReason('', 2)).toBe('exit 2');
  });

  it('is not fooled by braces inside strings or by text around the objects', () => {
    expect(stderrReason(`warn: {odd\n${NOTICE}\n{"error":{"message":"a } b"}}`, 1)).toBe('a } b');
    expect(errorEnvelope(`${NOTICE}\n${PRETTY}`)).toMatchObject({ code: 'AUTH_NO_TOKEN' });
    expect(errorEnvelope('plain failure')).toBeUndefined();
  });
});
