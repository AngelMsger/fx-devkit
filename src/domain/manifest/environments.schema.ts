// manifest/environments.yaml: platform instances and the per-environment variables that
// turn a platform's template into a coordinate. Schema 2 adds `provider`/`capability` on
// a platform.

import * as z from 'zod';

import {
  capability,
  confidence,
  coordinate,
  minCli,
  note,
  schemaVersion,
  vars,
} from './common.schema.js';

export const platformSchema = z
  .strictObject({
    label: z.string().optional().describe('human-readable name'),
    provider: z.string().optional().describe('provider id fulfilling this platform, e.g. sentry'),
    capability: capability.optional(),
    vars,
    command: z
      .string()
      .optional()
      .describe(
        'command template printed for the reader to run; overrides the provider default; never executed by fx',
      ),
    note,
  })
  .describe('one platform instance: a system that coordinates point into');

const observation = z.strictObject({
  confidence: z.enum(['verified', 'not_found']).describe('a definite resource probe result'),
  note: z.string().describe('dated probe template and retained context, without expanded secrets'),
  fingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .describe('coordinate identity; changed variables invalidate this observation'),
});

export const envPlatformSchema = coordinate
  .extend({
    observations: z
      .record(z.string(), observation)
      .optional()
      .describe('repository-scoped probe evidence; never certifies sibling repositories'),
    setup: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'entry points for manual setup steps, e.g. source: the page a kubeconfig is downloaded from',
      ),
  })
  .describe("this environment's coordinate on one platform");

export const envSchema = z
  .strictObject({
    label: z.string().optional().describe('human-readable name'),
    platforms: z
      .record(z.string(), envPlatformSchema)
      .optional()
      .describe(
        'per-platform coordinates; values may use {svc}, {repo} and {env}; an undeclared platform means the environment has none',
      ),
    confidence,
    note,
  })
  .describe('one environment');

export const environmentsSchema = z
  .strictObject({
    schema_version: schemaVersion,
    min_cli: minCli,
    platforms: z.record(z.string(), platformSchema).describe('platform instances, keyed by name'),
    envs: z.record(z.string(), envSchema).describe('environments, keyed by name'),
  })
  .describe('the environments and the platforms each one exposes');
