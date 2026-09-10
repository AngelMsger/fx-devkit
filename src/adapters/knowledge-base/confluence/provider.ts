// Confluence entry and space-access verification. The space check proves
// access to this binding rather than merely finding a stored credential.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { referenceEntry } from '../../reference/entry.js';

const SPACE = [
  'space',
  'get',
  '{space}',
  '--base-url',
  '{base_url}',
  '--format',
  'json',
  '--fields',
  'key',
];

export const confluenceProvider: ProviderDescriptor<Coordinate> = {
  id: 'confluence',
  capability: 'knowledge-base',
  reference: true,
  tools: ['confluence-cli'],
  vars: [
    { name: 'base_url', desc: 'verified Confluence site URL', required: true },
    { name: 'space', desc: 'space key', required: true },
  ],
  recipes: [
    {
      id: 'access',
      tool: 'confluence-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Connect the Confluence space',
      instructions:
        'Configure confluence-cli for the intended site and obtain read access to the declared space.',
      open: '{base_url}',
      verify: { command: SPACE },
    },
  ],
  create: (_deps, vars) =>
    referenceEntry({
      template: {
        label: 'Confluence space {space}',
        command: ['confluence-cli', ...SPACE],
        url: '{base_url}',
      },
      vars,
    }),
};
