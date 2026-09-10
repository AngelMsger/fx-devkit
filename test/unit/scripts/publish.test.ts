import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeNodeShim } from '../../platform.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'fx-publish-test-'));
  roots.push(root);
  for (const directory of ['scripts', 'src/adapters/registry', 'bin'])
    mkdirSync(path.join(root, directory), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@fx/devkit', type: 'module' }),
  );
  for (const file of [
    'scripts/publish.mjs',
    'scripts/guard-registry.mjs',
    'src/adapters/registry/registry-policy.js',
  ])
    writeFileSync(path.join(root, file), readFileSync(file));
  writeFileSync(path.join(root, 'bin/package.json'), '{"type":"commonjs"}');
  symlinkSync(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const output = path.join(root, 'invocation.json');
  writeNodeShim(
    path.join(root, 'bin'),
    'npm',
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({args:process.argv.slice(2),wrapped:process.env.FX_PUBLISH_WRAPPED}));\n`,
  );
  return {
    root,
    output,
    env: {
      ...process.env,
      PATH: `${root}/bin${path.delimiter}${process.env.PATH}`,
      FX_REGISTRY: 'https://npm.example.com/',
    },
  };
}
function run(
  f: ReturnType<typeof fixture>,
  script: string,
  extra: NodeJS.ProcessEnv = {},
  args: string[] = [],
) {
  return spawnSync(process.execPath, [path.join(f.root, 'scripts', script), ...args], {
    cwd: f.root,
    env: { ...f.env, ...extra },
    encoding: 'utf8',
  });
}
describe('private publishing boundary', () => {
  it('pins default and scoped registries without changing package metadata', () => {
    const f = fixture();
    const before = readFileSync(path.join(f.root, 'package.json'), 'utf8');
    const result = run(f, 'publish.mjs', {}, ['--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    const invocation = JSON.parse(readFileSync(f.output, 'utf8'));
    expect(invocation.args).toEqual([
      'publish',
      '--registry',
      'https://npm.example.com/',
      '--@fx:registry=https://npm.example.com/',
      '--ignore-scripts=false',
      '--dry-run',
    ]);
    expect(invocation.wrapped).toBe('1');
    expect(readFileSync(path.join(f.root, 'package.json'), 'utf8')).toBe(before);
  });
  it('refuses public, missing or caller-overridden targets before launching npm', () => {
    const f = fixture();
    expect(run(f, 'publish.mjs', { FX_REGISTRY: 'https://registry.npmjs.org/' }).status).toBe(1);
    expect(run(f, 'publish.mjs', { FX_REGISTRY: '' }).status).toBe(1);
    expect(run(f, 'publish.mjs', {}, ['--registry=https://registry.npmjs.org']).status).toBe(1);
  });
  it('blocks direct publishing and any mismatch with the wrapper target', () => {
    const f = fixture();
    expect(run(f, 'guard-registry.mjs', { FX_PUBLISH_WRAPPED: '' }).status).toBe(1);
    expect(
      run(f, 'guard-registry.mjs', {
        FX_PUBLISH_WRAPPED: '1',
        npm_config_registry: 'https://registry.npmjs.org/',
      }).status,
    ).toBe(1);
    expect(
      run(f, 'guard-registry.mjs', {
        FX_PUBLISH_WRAPPED: '1',
        npm_config_registry: f.env.FX_REGISTRY,
      }).status,
    ).toBe(0);
  });
});
