// Harness declarations carry symbolic environment bindings, never credential
// values. Transport-specific decisions live in the shared document rules.

import * as z from 'zod';

import { scanBoundary, containsCommandCredentials } from '../boundary/scan.js';

import { commandVector, jsonExpectation, minCli, schemaVersion } from './common.schema.js';

const safeText = z
  .string()
  .refine(
    (text) => scanBoundary({ text, policy: 'manifest' }).length === 0,
    'protected content is not allowed',
  );

const reference = z
  .strictObject({
    from_env: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .describe('environment variable name, not its value'),
  })
  .describe('a native environment reference');
const bindings = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/), reference)
  .optional()
  .describe('native field names mapped to environment references');
const vector = commandVector
  .min(1)
  .refine(
    (v) => !containsCommandCredentials(v) && v.every((arg) => !/\$\{|\$[A-Za-z_]/.test(arg)),
    'use explicit environment bindings instead of credential arguments or interpolation',
  )
  .refine(
    (v) => scanBoundary({ text: v.join(' '), policy: 'manifest' }).length === 0,
    'protected command content is not allowed',
  )
  .refine(
    (v) => v.every((s) => s.length > 0 && !/[\x00\r\n]/.test(s)),
    'command arguments must be nonempty single-line values',
  );

export const mcpSchema = z
  .strictObject({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .describe('stable resource identifier'),
    description: safeText.optional().describe('what this resource provides'),
    transport: z
      .enum(['stdio', 'http'])
      .describe('local stdio process or streamable HTTP endpoint'),
    command: vector.optional().describe('literal startup argument vector; no shell expansion'),
    url: safeText.optional().describe('HTTP endpoint without credentials or query parameters'),
    env: bindings,
    headers: bindings,
    variables: z
      .record(
        z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
        z.strictObject({
          instructions: safeText
            .min(1)
            .describe('how a person obtains this variable without storing its value'),
        }),
      )
      .optional()
      .describe('human setup instructions for every referenced variable'),
    check: z
      .strictObject({
        command: vector.describe('dedicated read-only companion check, separately trusted'),
        json: jsonExpectation
          .optional()
          .describe('optional scalar assertion on a successful command response'),
      })
      .optional()
      .describe('optional current readiness evidence; never the MCP startup command'),
  })
  .describe('one team MCP resource');

export const harnessSchema = z
  .strictObject({
    schema_version: schemaVersion,
    min_cli: minCli,
    mcp: z.array(mcpSchema).default([]).describe('optional team MCP resources'),
    rules: z
      .strictObject({
        enabled: z
          .boolean()
          .default(true)
          .describe('project AGENTS.md pointers for hosts that require them'),
      })
      .optional()
      .describe('fixed pointer projection; never arbitrary rules text'),
  })
  .describe('optional workspace harness configuration');
