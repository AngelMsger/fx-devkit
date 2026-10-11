// @ts-check
// The controlled entry point pins both npm registry settings to npmjs. No arbitrary
// npm arguments are forwarded, and package metadata is never rewritten with an address.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import spawn from 'cross-spawn';

import {
  publicationRegistry,
  registryArguments,
} from '../src/adapters/registry/registry-policy.js';
import { PACKAGE_NAME } from '../src/domain/distribution.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const registry = publicationRegistry(process.env.FX_REGISTRY);
const extra = process.argv.slice(2);
if (!registry || extra.some((arg) => arg !== '--dry-run') || extra.length > 1) {
  console.error('Publishing targets npmjs only and accepts only --dry-run.');
  process.exit(1);
}
if (
  pkg.name !== PACKAGE_NAME ||
  pkg.publishConfig?.registry ||
  pkg.publishConfig?.access !== 'public'
) {
  console.error(
    `Package metadata must name ${PACKAGE_NAME}, use public access and omit the Registry address.`,
  );
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
