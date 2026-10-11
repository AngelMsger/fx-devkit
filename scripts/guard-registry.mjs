// @ts-check
// Bare npm publish is refused: scoped CLI settings are not all exported to
// lifecycle scripts. The wrapper controls both settings and never inherits a target.

import { readFileSync } from 'node:fs';

import { publicationRegistry } from '../src/adapters/registry/registry-policy.js';
import { PACKAGE_NAME } from '../src/domain/distribution.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const registry = publicationRegistry(process.env.FX_REGISTRY);
if (
  pkg.name !== PACKAGE_NAME ||
  pkg.publishConfig?.registry ||
  pkg.publishConfig?.access !== 'public' ||
  process.env.FX_PUBLISH_WRAPPED !== '1' ||
  !registry ||
  publicationRegistry(process.env.npm_config_registry) !== registry
) {
  console.error(
    'Publish with `npm run release`; package metadata must not contain a registry address.',
  );
  process.exit(1);
}
