// ~/.fx/workspaces/<name>/local.yaml: what this machine chose from the shared registry
// and how it deviates. It stores references and deviations only; an override may change
// the checkout path and the branch and nothing else, so a shared fact is never copied
// here.

import * as z from 'zod';

import { repoSchema } from './workspace.schema.js';

export const localSchema = z
  .strictObject({
    hooks: z
      .strictObject({
        enabled: z
          .boolean()
          .optional()
          .describe('enable hooks for this workspace; absent means enabled'),
      })
      .optional()
      .describe('personal workspace lifecycle preference'),
    scope: z
      .strictObject({
        repos: z
          .array(z.string())
          .optional()
          .describe('shared repositories this machine tracks; absent means all, empty means none'),
        envs: z
          .array(z.string())
          .optional()
          .describe(
            'environments this person has access to or cares about; login, doctor and can expand only these',
          ),
      })
      .optional()
      .describe('what this machine selected from the shared registry'),
    repos: z
      .array(repoSchema)
      .optional()
      .describe('repositories registered only on this machine; always tracked'),
    overrides: z
      .record(
        z.string(),
        z
          .strictObject({
            path: z.string().optional().describe('checkout path instead of the shared one'),
            branch: z.string().optional().describe('branch to track instead of the shared one'),
          })
          .describe('per-machine deviation for one shared repository'),
      )
      .optional()
      .describe('per-machine adjustments to shared entries, keyed by repository name'),
    setup: z
      .record(
        z.string(),
        z
          .strictObject({
            acknowledged: z.string().describe('when the person confirmed the manual step'),
          })
          .describe('one acknowledged manual step'),
      )
      .optional()
      .describe('manual setup steps this person has confirmed; doctor still verifies'),
  })
  .describe('the personal layer: selection and deviations, never copies');
