import { describe, expect, it } from 'vitest';

import { DevkitError } from '../../../../src/domain/errors.js';
import {
  absoluteRange,
  instantMs,
  isWithinRange,
  isWindow,
  parseWindow,
  resolveRange,
  windowMs,
} from '../../../../src/domain/release/window.js';

const HOUR = 60 * 60 * 1000;

describe('windows', () => {
  it('reads hours, days and weeks', () => {
    expect(parseWindow('48h')).toBe(48 * HOUR);
    expect(parseWindow('14d')).toBe(14 * 24 * HOUR);
    expect(parseWindow('2w')).toBe(14 * 24 * HOUR);
  });

  it('refuses anything else, including a zero window', () => {
    for (const text of ['x', '14', 'd', '0d', '1m', '1.5d']) expect(isWindow(text)).toBe(false);
  });

  it('turns a bad window into a usage error a person can act on', () => {
    expect(() => windowMs('soon')).toThrow(DevkitError);
    try {
      windowMs('soon');
    } catch (err) {
      expect(err).toMatchObject({ category: 'usage', code: 'BAD_SINCE' });
    }
  });
});

describe('absolute release ranges', () => {
  it('normalizes timezone offsets and uses inclusive start and exclusive end', () => {
    const range = absoluteRange('2026-11-01T08:00:00+08:00', '2026-11-02T08:00:00+08:00');
    expect(range).toEqual({
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-11-02T00:00:00.000Z',
      bounds: '[start,end)',
    });
    expect(isWithinRange(range.start, range)).toBe(true);
    expect(isWithinRange(range.end, range)).toBe(false);
    expect(isWithinRange('2026-11-02T00:00:01Z', range)).toBe(false);
  });

  it('resolves relative windows from the supplied fixed instant', () => {
    expect(resolveRange({ since: '24h' }, new Date('2026-11-02T00:00:00Z'))).toEqual(
      absoluteRange('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
    );
  });

  it.each([
    { start: '2026-11-01T00:00:00', end: '2026-11-02T00:00:00Z' },
    { start: '2026-02-30T00:00:00Z', end: '2026-11-02T00:00:00Z' },
    { start: '2026-11-01T24:00:00Z', end: '2026-11-02T00:00:00Z' },
    { start: '2026-11-01T00:00:00+25:00', end: '2026-11-02T00:00:00Z' },
    { start: '2026-11-02T00:00:00Z', end: '2026-11-02T00:00:00Z' },
    { start: '2026-11-03T00:00:00Z', end: '2026-11-02T00:00:00Z' },
    { start: '2026-11-01T00:00:00Z' },
    { since: '14d', start: '2026-11-01T00:00:00Z', end: '2026-11-02T00:00:00Z' },
  ])('rejects invalid or ambiguous range input %j', (input) => {
    expect(() => resolveRange(input, new Date())).toThrow(
      expect.objectContaining({ code: 'BAD_TIME_RANGE' }),
    );
  });
});

it('accepts provider microseconds and compares high-precision instants at millisecond precision', () => {
  expect(instantMs('2026-04-24T07:29:20.672000Z')).toBe(Date.parse('2026-04-24T07:29:20.672Z'));
  expect(instantMs('2026-04-24T15:29:20.672999999+08:00')).toBe(
    Date.parse('2026-04-24T07:29:20.672Z'),
  );
  const range = absoluteRange('2026-04-24T07:29:20.672000Z', '2026-04-24T07:29:20.673000Z');
  expect(isWithinRange('2026-04-24T07:29:20.672999Z', range)).toBe(true);
  expect(isWithinRange('2026-04-24T07:29:20.673001Z', range)).toBe(false);
  expect(instantMs('2026-02-30T07:29:20.672000Z')).toBeUndefined();
  expect(instantMs('2026-04-24T07:29:20.Z')).toBeUndefined();
});
