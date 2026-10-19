import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fx, packageName, tempDir } from './harness.js';

describe('runtime registry coordinates', () => {
  it('reuses npm scope configuration without letting a project redirect global self-update', () => {
    const root = tempDir('fx-npm-config-');
    const project = path.join(root, 'project');
    mkdirSync(project);
    writeFileSync(path.join(project, 'package.json'), '{}');
    writeFileSync(
      path.join(project, '.npmrc'),
      `${packageName.split('/')[0]}:registry=https://project.example.com/\n`,
    );
    const userconfig = path.join(root, 'user.npmrc');
    const globalconfig = path.join(root, 'global.npmrc');
    writeFileSync(globalconfig, '');
    writeFileSync(
      userconfig,
      `${packageName.split('/')[0]}:registry=https://npm.example.com/team/\nregistry=https://registry.npmjs.org/\n`,
    );
    const env = {
      FX_REGISTRY: undefined,
      // The answer comes from the real npm, so this case searches the machine's own PATH.
      PATH: process.env['PATH'],
      npm_config_userconfig: userconfig,
      npm_config_globalconfig: globalconfig,
    };
    const info = fx(['self', 'info', '--format', 'json'], env, project);
    expect(info.status, info.stderr).toBe(0);
    expect(info.json()).toMatchObject({
      registry: 'https://npm.example.com/team/',
      registry_source: 'npm_scope',
    });
    const update = fx(['self', 'update', '--dry-run', '--format', 'json'], env, project);
    expect(update.status, update.stderr).toBe(0);
    expect(update.json()).toMatchObject({
      ran: false,
      vector: [
        'npm',
        'install',
        '-g',
        `${packageName}@latest`,
        `--${packageName.split('/')[0]}:registry=https://npm.example.com/team/`,
      ],
    });
  });

  it('uses FX_REGISTRY for a self-update preview without an embedded package address', () => {
    const result = fx(['self', 'update', '--dry-run', '--format', 'json'], {
      FX_REGISTRY: 'https://npm.example.com/',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      ran: false,
      vector: [
        'npm',
        'install',
        '-g',
        `${packageName}@latest`,
        `--${packageName.split('/')[0]}:registry=https://npm.example.com/`,
      ],
    });
  });
  it('does not infer a public target when the coordinate is absent or unsafe', () => {
    for (const FX_REGISTRY of packageName === '@fx/devkit'
      ? ['', 'https://registry.npmjs.org/']
      : ['', 'invalid']) {
      const result = fx(['self', 'update', '--dry-run', '--format', 'json'], { FX_REGISTRY });
      expect(result.error().code).toBe('REGISTRY_UNKNOWN');
      expect(result.stdout).toBe('');
    }
  });
});
