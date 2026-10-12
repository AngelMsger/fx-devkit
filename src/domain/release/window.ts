// A look-back window as people write it (`14d`, `48h`, `2w`), in milliseconds.

import { DevkitError } from '../errors.js';

const UNIT_MS: Readonly<Record<string, number>> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const PATTERN = /^(\d+)([hdw])$/;

export function parseWindow(text: string): number | undefined {
  const m = PATTERN.exec(text.trim());
  if (m === null || m[1] === undefined || m[2] === undefined) return undefined;
  const amount = Number(m[1]);
  return amount === 0 ? undefined : amount * (UNIT_MS[m[2]] ?? 0);
}

export function isWindow(text: string): boolean {
  return parseWindow(text) !== undefined;
}

export function windowMs(text: string): number {
  const ms = parseWindow(text);
  if (ms !== undefined) return ms;
  throw new DevkitError('usage', 'BAD_SINCE', `"${text}" is not a window`, {
    hint: 'Write an amount and a unit: 14d, 48h, 2w.',
    nextSteps: ['fx release check --since 14d'],
  });
}
