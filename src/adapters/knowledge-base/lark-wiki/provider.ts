// Feishu / Lark Wiki as the team's knowledge base: an entry into one space and a read-only
// access check. Reading and writing documents remains the caller's responsibility.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { referenceEntry } from '../../reference/entry.js';

const SPACE_NODES = ['wiki', '+node-list', '--space-id', '{space}', '--format', 'json'];

export const larkWikiProvider: ProviderDescriptor<Coordinate> = {
  id: 'lark-wiki',
  capability: 'knowledge-base',
  reference: true,
  tools: ['lark-cli'],
  vars: [{ name: 'space', desc: 'wiki space id, from lark-cli wiki +space-list', required: true }],
  recipes: [
    {
      // A step's identity is its tool and id, and lark-cli also serves `im`: two providers
      // sharing one CLI must not claim the same step.
      id: 'wiki-access',
      tool: 'lark-cli',
      perEnv: false,
      kind: 'manual',
      title: 'Authorize the Lark wiki space',
      instructions:
        'Use the lark-shared Skill to authorize lark-cli for the docs domain, then confirm the declared space is one the authorized identity can read.',
      // Listing one node proves access to this space, not merely a stored credential.
      verify: { command: [...SPACE_NODES, '--page-size', '1'] },
    },
  ],
  create: (_deps, vars) =>
    referenceEntry({
      template: { label: 'Lark wiki space {space}', command: ['lark-cli', ...SPACE_NODES] },
      vars,
    }),
};
