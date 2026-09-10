// Bare npm publish is refused: scoped CLI settings are not all exported to
// lifecycle scripts. The wrapper controls both settings and never inherits a target.

import { readFileSync } from 'node:fs';

import { distribution, packageChannel } from '../src/domain/distribution.js';

import { publicationRegistry } from '../src/adapters/registry/registry-policy.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const registry = publicationRegistry(pkg.name, process.env.FX_REGISTRY);
if (
  pkg.publishConfig?.registry ||
  pkg.publishConfig?.access !== distribution(packageChannel(pkg.name)).access ||
  process.env.FX_PUBLISH_WRAPPED !== '1' ||
  !registry ||
  publicationRegistry(pkg.name, process.env.npm_config_registry) !== registry
) {
  console.error(
    'Publishing requires scripts/publish.mjs with a matching distribution Registry; package metadata must not contain a registry address.',
  );
  process.exit(1);
}
