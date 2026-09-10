// The controlled entry point pins both npm registry settings. No arbitrary npm
// arguments are forwarded, and package metadata is never rewritten with an address.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

import { distribution, packageChannel } from '../src/domain/distribution.js';

import {
  publicationRegistry,
  registryArguments,
} from '../src/adapters/registry/registry-policy.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const registry = publicationRegistry(pkg.name, process.env.FX_REGISTRY);
const extra = process.argv.slice(2);
if (!registry || extra.some((arg) => arg !== '--dry-run') || extra.length > 1) {
  console.error(
    'Publishing requires the matching distribution Registry and accepts only --dry-run.',
  );
  process.exit(1);
}
if (
  pkg.publishConfig?.registry ||
  pkg.publishConfig?.access !== distribution(packageChannel(pkg.name)).access
) {
  console.error('Package metadata must use matching channel access and omit the Registry address.');
  process.exit(1);
}
const result = spawn.sync(
  'npm',
  [
    'publish',
    ...registryArguments({ packageName: pkg.name, registry }),
    '--ignore-scripts=false',
    ...extra,
  ],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      FX_REGISTRY: registry,
      FX_PUBLISH_WRAPPED: '1',
      npm_config_registry: registry,
    },
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
