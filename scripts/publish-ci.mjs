// @ts-check
// Resolve the publish target from Jenkins' temporary Managed npmrc without logging it.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import spawn from 'cross-spawn';

import { privateRegistry } from '../src/adapters/registry/registry-policy.js';

const config = process.env.NPM_CONFIG_USERCONFIG;
if (!config || !existsSync(config)) {
  console.error('CI publication requires a Jenkins Managed npmrc via NPM_CONFIG_USERCONFIG.');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const { name } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
/** @param {string} key */
function setting(key) {
  const result = spawn.sync('npm', ['config', 'get', key], {
    cwd: root,
    env: { ...process.env, npm_config_userconfig: config },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error('Cannot resolve the Registry from the injected npm configuration.');
    process.exit(1);
  }
  return result.stdout.trim();
}
const scoped = name.startsWith('@') ? setting(`${name.split('/')[0]}:registry`) : 'undefined';
const registry = privateRegistry(
  scoped === 'undefined' || scoped === '' ? setting('registry') : scoped,
);
if (!registry) {
  console.error('The injected npm configuration must select a private package Registry.');
  process.exit(1);
}
const result = spawn.sync(
  process.execPath,
  [fileURLToPath(new URL('./publish.mjs', import.meta.url)), ...process.argv.slice(2)],
  {
    cwd: root,
    env: { ...process.env, FX_REGISTRY: registry, npm_config_userconfig: config },
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
