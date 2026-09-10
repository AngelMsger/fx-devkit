// Fragments shared by several documents. Every field carries a description:
// the JSON Schema, `manifest explain` and the validator all read it from here.

import * as z from 'zod';

import { CAPABILITIES } from '../capability.js';

export const CONFIDENCE = [
  'verified',
  'derived',
  'unverified',
  'not_covered',
  'not_found',
] as const;

export const schemaVersion = z
  .number()
  .int()
  .positive()
  .describe('document shape; the loader negotiates it against the versions this CLI supports');

export const minCli = z
  .string()
  .optional()
  .describe('lowest fx version that reads this document correctly');

export const confidence = z
  .enum(CONFIDENCE)
  .optional()
  .describe(
    'how well this value is known: verified, derived, unverified, not_covered or not_found',
  );

export const vars = z
  .record(z.string(), z.string())
  .optional()
  .describe('variables substituted into command templates as {name}');

export const note = z
  .string()
  .optional()
  .describe('why this entry is unusual; carried into every rendering');

export const coordinate = z
  .strictObject({ vars, confidence, note })
  .describe('a per-platform coordinate: variables, how well they are known, and a caveat');

export const capability = z.enum(CAPABILITIES).describe('the responsibility this provider fulfils');

export const commandVector = z
  .array(z.string())
  .describe('a command as an argument vector; never passed through a shell');

export const jsonExpectation = z
  .strictObject({
    path: z
      .string()
      .regex(/^[^.]+(?:\.[^.]+)*$/)
      .describe('dot-separated JSON result path'),
    equals: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .describe('expected scalar value'),
  })
  .describe('a scalar JSON readiness assertion');
