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

  it('reads other tools by where they failed and why, then falls back to the exit code', () => {
    expect(stderrReason('\n  fatal: no such job\n', 1)).toBe('fatal: no such job');
    expect(
      stderrReason('Error: Config at ./settings\nNo credentials for this host.\nRun login.\n', 13),
    ).toBe('Error: Config at ./settings No credentials for this host.');
    expect(stderrReason(`${NOTICE}\n`, 4)).toBe('exit 4');
    expect(stderrReason('', 2)).toBe('exit 2');
  });

  it('sets log records and warnings aside unless they are all a tool said', () => {
    const record = 'E1009 13:14:36.199047    2943 cache.go:381] "discovery failed" err="timeout"';
    expect(
      stderrReason(
        `${record}\nWarning: resource type unknown\n\nUnable to connect to the server: timeout\n`,
        1,
      ),
    ).toBe('Unable to connect to the server: timeout');
    expect(stderrReason('2026-01-02T03:04:05Z starting\nlevel=error msg=refused\n', 1)).toBe(
      'level=error msg=refused',
    );
  });

  it('takes the message of an error object a tool printed in place of an envelope', () => {
    expect(
      stderrReason('{\n  "errcode": 850003,\n  "errmsg": "authorization expired"\n}\n', 1),
    ).toBe('authorization expired');
  });

  it('shortens a reason that would not fit a report row', () => {
    const reason = stderrReason(`fatal: ${'x'.repeat(400)}`, 1);
    expect(reason).toHaveLength(240);
    expect(reason.endsWith('…')).toBe(true);
  });

  it('is not fooled by braces inside strings or by text around the objects', () => {
    expect(stderrReason(`warn: {odd\n${NOTICE}\n{"error":{"message":"a } b"}}`, 1)).toBe('a } b');
    expect(errorEnvelope(`${NOTICE}\n${PRETTY}`)).toMatchObject({ code: 'AUTH_NO_TOKEN' });
    expect(errorEnvelope('plain failure')).toBeUndefined();
  });
});
