// Bare npm publish is refused: scoped CLI settings are not all exported to
// lifecycle scripts. The wrapper controls both settings and never inherits a target.

import { readFileSync } from 'node:fs';

import { privateRegistry } from '../src/adapters/registry/registry-policy.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const registry = privateRegistry(process.env.FX_REGISTRY);
if (
  pkg.publishConfig?.registry ||
  process.env.FX_PUBLISH_WRAPPED !== '1' ||
  !registry ||
  privateRegistry(process.env.npm_config_registry) !== registry
) {
  console.error(
    'Publishing requires scripts/publish.mjs with a private FX_REGISTRY; package metadata must not contain a registry address.',
  );
  process.exit(1);
}
