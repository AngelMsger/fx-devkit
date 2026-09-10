// Query and recording options share one definition; recording is an explicit
// write mode and dry-run never means running a probe without saving its result.

import { Flags } from '@oclif/core';

import { dryRunFlag, jobsFlag } from './flags.js';

export const whereFlags = {
  env: Flags.string({ description: 'one environment; default: every environment in scope' }),
  platform: Flags.string({ description: 'one platform; default: all' }),
  check: Flags.boolean({
    default: true,
    allowNo: true,
    description: "fill the ready column by running each provider's read-only verify",
  }),
  probe: Flags.boolean({
    default: false,
    description: 'ask each platform, read-only, whether the coordinate exists; needs --env',
  }),
  record: Flags.boolean({
    default: false,
    description:
      'record definite probe evidence in source environments.yaml; needs --probe, --env and --platform',
  }),
  'dry-run': dryRunFlag,
  jobs: jobsFlag,
};

export function selectWhereColumns(probe: boolean): string[] {
  const columns = ['platform', 'env', 'status', 'ready', 'confidence', 'command', 'notes'];
  return probe ? [...columns, 'outcome', 'suggested_confidence'] : columns;
}
