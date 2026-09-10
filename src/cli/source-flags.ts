// Source contribution flags describe input and recovery intent. The shared
// write posture and confirmation flags remain owned by the command base.

import { Flags } from '@oclif/core';

import { dryRunFlag } from './flags.js';

export const sourcePushFlags = {
  issue: Flags.string({ description: 'issue ID for the commit; prompted if omitted' }),
  title: Flags.string({ description: 'new PR title; prompted if omitted' }),
  message: Flags.string({ description: 'single-line commit summary' }),
  new: Flags.boolean({
    default: false,
    description: 'start a separate contribution instead of reusing a pending PR',
  }),
  pr: Flags.string({ description: 'known PR ID or URL to associate after an uncertain creation' }),
  'dry-run': dryRunFlag,
};
