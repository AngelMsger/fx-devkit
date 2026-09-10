import { describe, expect, it } from 'vitest';

import { finding, report, summarize, worst } from '../../../src/domain/report.js';

describe('report', () => {
  it('orders findings by the declared groups whatever order they arrived in', () => {
    const out = report(
      ['a', 'b'],
      [finding('b', 'x', 'ok', 'm'), finding('a', 'y', 'ok', 'm'), finding('b', 'z', 'ok', 'm')],
    );
    expect(out.findings.map((f) => `${f.group}:${f.id}`)).toEqual(['a:y', 'b:x', 'b:z']);
  });

  it('is not ok only because of a failure; a warning is something to know', () => {
    expect(report(['a'], [finding('a', 'x', 'warn', 'm')]).ok).toBe(true);
    expect(report(['a'], [finding('a', 'x', 'fail', 'm')]).ok).toBe(false);
    expect(summarize([finding('a', 'x', 'warn', 'm'), finding('a', 'y', 'ok', 'm')])).toEqual({
      ok: 1,
      warn: 1,
      fail: 0,
    });
  });

  it('distinguishes unavailable evidence from advisory warnings and excluded checks', () => {
    expect(report(['a'], [finding('a', 'x', 'warn', 'behind upstream')])).toMatchObject({
      ok: true,
      complete: true,
    });
    expect(
      report(
        ['a'],
        [finding('a', 'x', 'warn', 'could not query upstream', { coverage: 'incomplete' })],
      ),
    ).toMatchObject({ ok: true, complete: false });
    expect(
      report(['a'], [finding('a', 'x', 'ok', 'disabled', { coverage: 'not_applicable' })]),
    ).toMatchObject({ ok: true, complete: true });
    expect(report(['a'], [finding('a', 'x', 'fail', 'build failed')])).toMatchObject({
      ok: false,
      complete: true,
    });
  });

  it('carries evidence only when there is some', () => {
    expect(finding('a', 'x', 'ok', 'm')).not.toHaveProperty('evidence');
    expect(finding('a', 'x', 'ok', 'm', { evidence: { n: 1 } }).evidence).toEqual({ n: 1 });
  });

  it('takes the worst of several levels', () => {
    expect(worst(['ok', 'warn'])).toBe('warn');
    expect(worst(['warn', 'fail', 'ok'])).toBe('fail');
    expect(worst([])).toBe('ok');
  });
});
