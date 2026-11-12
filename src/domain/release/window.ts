// Relative look-back syntax and reproducible, timezone-qualified half-open ranges.

import { DevkitError } from '../errors.js';

const UNIT_MS: Readonly<Record<string, number>> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};
const PATTERN = /^(\d+)([hdw])$/;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

export interface TimeRange {
  readonly start: string;
  readonly end: string;
  readonly bounds: '[start,end)';
}

export interface RangeInput {
  readonly since?: string;
  readonly start?: string;
  readonly end?: string;
}

export function parseWindow(text: string): number | undefined {
  const m = PATTERN.exec(text.trim());
  if (m === null || m[1] === undefined || m[2] === undefined) return undefined;
  const ms = Number(m[1]) * (UNIT_MS[m[2]] ?? 0);
  return ms > 0 && Number.isSafeInteger(ms) ? ms : undefined;
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

// Check calendar components before parsing. Provider timestamps may carry microseconds;
// comparisons truncate fractional seconds to milliseconds and never round into the next bound.
export function instantMs(text: string): number | undefined {
  const match = INSTANT.exec(text);
  if (match === null) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    days === undefined ||
    day < 1 ||
    day > days ||
    (hour ?? 24) > 23 ||
    (minute ?? 60) > 59 ||
    (second ?? 60) > 59
  )
    return undefined;
  const zone = match[8] ?? '';
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
    return undefined;
  const fraction = match[7];
  const millis = fraction === undefined ? '' : `.${fraction.slice(0, 3).padEnd(3, '0')}`;
  const ms = Date.parse(`${text.slice(0, 19)}${millis}${zone}`);
  return Number.isFinite(ms) ? ms : undefined;
}

export function resolveRange(input: RangeInput, now: Date): TimeRange {
  if (input.start !== undefined || input.end !== undefined) {
    if (input.since !== undefined) throw badRange('Use either since or start/end, not both');
    if (input.start === undefined || input.end === undefined)
      throw badRange('Both start and end are required');
    return absoluteRange(input.start, input.end);
  }
  const end = now.getTime();
  const start = end - windowMs(input.since ?? '14d');
  if (!Number.isFinite(end) || !Number.isFinite(new Date(start).getTime()))
    throw badRange('The relative window is outside the supported date range');
  return absoluteRange(new Date(start).toISOString(), now.toISOString());
}

export function absoluteRange(start: string, end: string): TimeRange {
  const floor = instantMs(start);
  const ceiling = instantMs(end);
  if (floor === undefined || ceiling === undefined)
    throw badRange('Start and end must be ISO timestamps with an explicit timezone');
  if (floor >= ceiling) throw badRange('Start must be earlier than end');
  return {
    start: new Date(floor).toISOString(),
    end: new Date(ceiling).toISOString(),
    bounds: '[start,end)',
  };
}

export function isWithinRange(date: string | null, range: TimeRange): boolean {
  const at = date === null ? undefined : instantMs(date);
  return at !== undefined && at >= Date.parse(range.start) && at < Date.parse(range.end);
}

function badRange(message: string): DevkitError {
  return new DevkitError('usage', 'BAD_TIME_RANGE', message, {
    hint: 'Use a positive relative window or two timezone-qualified ISO timestamps.',
    nextSteps: ['fx release check --help'],
  });
}
