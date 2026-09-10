// JSON Schema export for editors and CI, generated from the zod schemas so
// it cannot drift from what the loader accepts. It is stricter than the
// loader on purpose: unknown keys fail here (authoring) and are tolerated
// at runtime.

import * as z from 'zod';

import { SCHEMAS } from './explain.js';
import type { Kind } from './types.js';
import { SUPPORTED } from './versioning.js';

export function jsonSchemaFor(kind: Kind, cliVersion: string): Record<string, unknown> {
  // Input mode: this schema is for authors, so defaulted fields stay optional.
  const generated = z.toJSONSchema(SCHEMAS[kind], { target: 'draft-7', io: 'input' }) as Record<
    string,
    unknown
  >;
  const versions = kind === 'local' ? undefined : SUPPORTED[kind];
  const describes =
    versions === undefined
      ? 'the personal layer, which is not versioned'
      : `manifest schema version${versions.length > 1 ? 's' : ''} ${versions.join(' and ')}`;
  const { description: own, $schema: _draft, ...rest } = generated;
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `urn:fx-devkit:manifest:${kind}`,
    title: `fx manifest: ${kind}`,
    description: `${typeof own === 'string' ? `${own}. ` : ''}Generated from @angelmsger/fx ${cliVersion}; describes ${describes}.`,
    ...rest,
  };
}
