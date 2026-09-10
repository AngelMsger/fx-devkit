import { describe, expect, it } from 'vitest';

import { DevkitError } from '../../../../src/domain/errors.js';
import { isWindow, parseWindow, windowMs } from '../../../../src/domain/release/window.js';

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
