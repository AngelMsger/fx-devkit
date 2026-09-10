// manifest/workspace.yaml: projects, repositories, defaults and the workspace-scoped
// provider bindings. Schema 1 documents have no `providers` and carry the git host under
// `defaults.host`; both spellings are accepted so an existing manifest loads unchanged.

import * as z from 'zod';

import { coordinate, minCli, schemaVersion } from './common.schema.js';

export const providerBinding = z
  .strictObject({
    provider: z.string().min(1).describe('provider id, e.g. bitbucket-cli'),
    vars: z
      .record(z.string(), z.string())
      .optional()
      .describe('variables the provider needs, e.g. host, web, space'),
  })
  .describe('which provider fulfils a capability, and with what variables');

export const repoObs = z
  .strictObject({
    svc: z
      .string()
      .optional()
      .describe(
        'service name substituted for {svc}; defaults to the repository name without its prefix',
      ),
    covered: z
      .boolean()
      .optional()
      .describe('false marks a service deliberately outside observability coverage'),
    note: z
      .string()
      .optional()
      .describe('why this repository deviates; carried into every rendering'),
    overrides: z
      .record(z.string(), z.record(z.string(), coordinate))
      .optional()
      .describe('per-platform, per-environment exceptions to the derived coordinates'),
  })
  .describe('deviations from the observability patterns declared in environments.yaml');

const releaseCi = z
  .strictObject({
    source_env: z
      .string()
      .min(1)
      .optional()
      .describe('environment whose ci coordinate is the job building the source branch'),
    target_env: z
      .string()
      .min(1)
      .optional()
      .describe('environment whose ci coordinate is the job building the target branch'),
  })
  .describe('which environments name the ci jobs of the source and target branches');

export const releaseSchema = z
  .strictObject({
    source: z
      .string()
      .min(1)
      .optional()
      .describe('branch a release is cut from; defaults to defaults.branch'),
    targets: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        'candidate branches a release lands on, the first one a repository has wins; defaults to main, master',
      ),
    env: z
      .string()
      .min(1)
      .optional()
      .describe(
        'environment whose error tracker counts for the errors check; unset means errors are not checked',
      ),
    since: z
      .string()
      .optional()
      .describe('how far back a new unresolved error counts, e.g. 14d or 48h; defaults to 14d'),
    ci: releaseCi.optional(),
    bots: z
      .array(z.string())
      .optional()
      .describe('commit author names the merge check ignores, such as a CI account'),
  })
  .describe(
    'what a release is in this workspace: its branches, the environment whose errors count, and its ci jobs',
  );

export const repoRelease = z
  .strictObject({
    covered: z
      .boolean()
      .optional()
      .describe('false keeps this repository off the release checklist'),
    source: z.string().min(1).optional().describe('branch this repository releases from'),
    target: z.string().min(1).optional().describe('branch this repository releases to'),
    ci: releaseCi.optional(),
    note: z
      .string()
      .optional()
      .describe('why this repository deviates; carried into every rendering'),
  })
  .describe('how this repository deviates from the workspace release policy');

export const repoSchema = z
  .strictObject({
    name: z
      .string()
      .min(1)
      .describe('repository name; also the fork name under the personal namespace'),
    path: z
      .string()
      .optional()
      .describe('checkout path relative to the workspace root; defaults to the name'),
    desc: z.string().optional().describe('one-line description shown in listings'),
    aka: z
      .array(z.string().refine((value) => value.trim().length > 0, 'alias must not be blank'))
      .optional()
      .describe('exact aliases used for read-only repository discovery'),
    links: z
      .record(z.string().min(1), z.string().min(1))
      .optional()
      .describe('named reference strings shown by repo show; never fetched or executed'),
    tags: z
      .array(z.string())
      .optional()
      .describe('free-form labels for filtering; a repository may carry several'),
    branch: z.string().optional().describe('branch to track; defaults to defaults.branch'),
    project: z
      .string()
      .optional()
      .describe('code-host project holding this repository; defaults to defaults.upstream_project'),
    upstream: z
      .string()
      .optional()
      .describe('complete upstream URL, replacing the one derived from host, project and name'),
    obs: repoObs.optional(),
    release: repoRelease.optional(),
  })
  .describe('one repository of the workspace');

export const workspaceSchema = z
  .strictObject({
    schema_version: schemaVersion,
    min_cli: minCli,
    providers: z
      .record(z.string(), providerBinding)
      .optional()
      .describe('workspace-scoped capability bindings, keyed by capability'),
    defaults: z
      .strictObject({
        host: z
          .string()
          .optional()
          .describe(
            'git host prefix, e.g. ssh://git@git.example.com (schema 1; schema 2 puts it in providers.code-host.vars.host)',
          ),
        upstream_project: z
          .string()
          .optional()
          .describe('code-host project holding the official repositories'),
        origin_pattern: z
          .string()
          .optional()
          .describe(
            'legacy import hint for fork naming; actual fork URLs are owned by the code-host provider',
          ),
        branch: z.string().optional().describe('branch to track when a repository names none'),
      })
      .default({})
      .describe('values every repository inherits unless it overrides them'),
    projects: z
      .record(
        z.string(),
        z
          .strictObject({
            label: z.string().optional().describe('human-readable name'),
            contact: z
              .string()
              .optional()
              .describe("where to request access to this project's repositories"),
          })
          .describe('one code-host project'),
      )
      .optional()
      .describe('code-host projects this workspace draws on, and who grants access to each'),
    repos: z.array(repoSchema).describe('the repositories that make up the workspace'),
    release: releaseSchema.optional(),
    workflows: z
      .array(z.unknown())
      .optional()
      .describe('reserved for team workflows; parsed and ignored by this version'),
  })
  .describe('the workspace: which repositories exist, how they are reached, and who provides what');
