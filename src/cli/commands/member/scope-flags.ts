// Shared syntax for the context of a member lookup.
import { Flags } from '@oclif/core';

export const scopeFlags = {
  area: Flags.string({ description: 'business area id or group name' }),
  scenario: Flags.string({ description: 'scenario id within --area' }),
  'as-of': Flags.string({
    description: 'relationship validity date (YYYY-MM-DD, default today in UTC)',
  }),
};
