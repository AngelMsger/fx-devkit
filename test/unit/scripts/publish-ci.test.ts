// Verify effective Registry selection without real npm configuration or publication.
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeNodeShim } from '../../platform.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'fx-ci-publish-'));
  roots.push(root);
  for (const dir of ['scripts', 'src/adapters/registry', 'src/domain', 'bin'])
    mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@fx/devkit', version: '0.1.0', type: 'module' }),
  );
  for (const file of [
    'scripts/publish-ci.mjs',
    'scripts/check-release.mjs',
    'src/adapters/registry/registry-policy.js',
    'src/domain/distribution.js',
    'src/domain/public-url.js',
    'src/domain/semver.js',
  ])
    writeFileSync(path.join(root, file), readFileSync(file));
  const output = path.join(root, 'publish.json');
  writeFileSync(
    path.join(root, 'scripts/publish.mjs'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({registry: process.env.FX_REGISTRY, config: process.env.npm_config_userconfig, args: process.argv.slice(2)}));`,
  );
  symlinkSync(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  writeFileSync(path.join(root, 'bin/package.json'), '{"type":"commonjs"}');
  writeNodeShim(
    path.join(root, 'bin'),
    'npm',
    `#!${process.execPath}\nconsole.log(process.argv.at(-1) === '@fx:registry' ? process.env.TEST_SCOPE : process.env.TEST_DEFAULT);`,
  );
  const config = path.join(root, 'managed.npmrc');
  writeFileSync(config, '//npm.example.com/:_authToken=fake-secret\n');
  const env = {
    ...process.env,
    PATH: `${root}/bin${path.delimiter}${process.env.PATH}`,
    NPM_CONFIG_USERCONFIG: config,
    TEST_SCOPE: 'https://scoped.example.com/',
    TEST_DEFAULT: 'https://registry.npmjs.org/',
  };
  const run = (extra: NodeJS.ProcessEnv = {}, script = 'publish-ci.mjs') =>
    spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      env: { ...env, ...extra },
      encoding: 'utf8',
    });
  return { root, output, config, run };
}
describe('Jenkins Managed npmrc publication', () => {
  it('uses the effective scope registry and preserves injected authentication without logging it', () => {
    const f = fixture();
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(f.output, 'utf8'))).toMatchObject({
      registry: 'https://scoped.example.com/',
      config: f.config,
    });
    expect(result.stdout + result.stderr).not.toMatch(/scoped\.example|fake-secret/);
    expect(existsSync(f.config)).toBe(true);
  });
  it('uses the default only when the package scope is unset', () => {
    const f = fixture();
    expect(
      f.run({ TEST_SCOPE: 'undefined', TEST_DEFAULT: 'https://npm.example.com/' }).status,
    ).toBe(0);
    expect(JSON.parse(readFileSync(f.output, 'utf8')).registry).toBe('https://npm.example.com/');
  });
  it('rejects missing managed configuration, public targets and invalid scoped overrides', () => {
    const f = fixture();
    for (const env of [
      { NPM_CONFIG_USERCONFIG: '' },
      { TEST_SCOPE: 'https://registry.npmjs.org/' },
      { TEST_SCOPE: 'invalid', TEST_DEFAULT: 'https://npm.example.com/' },
    ])
      expect(f.run(env).status).toBe(1);
    expect(existsSync(f.output)).toBe(false);
  });
  it('requires main or an exact version tag before publication', () => {
    const f = fixture();
    expect(f.run({ TAG_NAME: 'v0.1.0' }, 'check-release.mjs').status).toBe(0);
    expect(f.run({ TAG_NAME: 'v0.2.0' }, 'check-release.mjs').status).toBe(1);
    expect(f.run({ TAG_NAME: 'release-1' }, 'check-release.mjs').status).toBe(1);
    expect(f.run({ TAG_NAME: 'v0.1.0-rc.1' }, 'check-release.mjs').status).toBe(1);
    expect(f.run({ TAG_NAME: '', BRANCH_NAME: 'main' }, 'check-release.mjs').status).toBe(0);
    expect(f.run({ TAG_NAME: '', BRANCH_NAME: 'feature/test' }, 'check-release.mjs').status).toBe(
      1,
    );
  });
});
