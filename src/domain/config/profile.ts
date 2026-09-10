// The profile document: everything personal that is worth carrying to
// another machine — the config file and each workspace's personal layer —
// and nothing that is not: no trust record, no cache, no credential.

import * as z from 'zod';

import { localSchema } from '../manifest/local.schema.js';

import { configFileSchema } from './file.js';

export const PROFILE_VERSION = 1;

export { configFileSchema as profileConfig } from './file.js';

export const profileSchema = z.strictObject({
  fx_profile: z.literal(PROFILE_VERSION),
  exported_at: z.string().optional(),
  config: configFileSchema,
  workspaces: z.record(z.string(), localSchema).default({}),
});

export type Profile = z.infer<typeof profileSchema>;
