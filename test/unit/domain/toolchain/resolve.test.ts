import { describe, expect, it } from 'vitest';

import { loadTools } from '../../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';
import { extractSemver } from '../../../../src/domain/toolchain/version.js';

const bundled = [
  'schema_version: 3',
  'defaults:',
  '  version_args: [--version]',
  '  npm_scope: "@example"',
  '  install: [{ via: npm }]',
  '  skill: { command: [skill, install], agent_flag: --agent }',
  '  auth: { command: [auth, status] }',
  'tools:',
  '  - name: alpha',
  '    required: true',
  '    min_version: 1.0.0',
  '  - name: beta',
  '    binary: beta-bin',
  '    version_args: [version]',
  '    install: [{ via: brew, spec: beta }]',
  '    skill: { command: [] }',
  '    auth: { command: [] }',
].join('\n');

const cli = { cliVersion: '1.0.0' };

describe('resolveTools', () => {
  it('retains a quarantined base diagnostic unless the overlay repairs that entry', () => {
    const base =
      'schema_version: 3\ntools: [{name: good, install: [{via: npm}]}, {name: bad, required: nope}]';
    const patched = loadTools(base, 'schema_version: 3\ntools: [{name: good, desc: changed}]', cli);
    expect(patched.dropped.map((entry) => entry.name)).toContain('bad');
    expect(patched.problems.length).toBeGreaterThan(0);
    const fixed = loadTools(
      base,
      'schema_version: 3\ntools: [{name: bad, required: false, install: [{via: npm}]}]',
      cli,
    );
    expect(fixed.dropped).toEqual([]);
    expect(fixed.problems).toEqual([]);
  });
  it('fills a bare entry from defaults and the built-in fallbacks', () => {
    const loaded = loadTools(bundled, undefined, cli);
    const alpha = resolveTools(loaded.doc, loaded.provenance).find((t) => t.name === 'alpha')!;
    expect(alpha).toMatchObject({
      binary: 'alpha',
      required: true,
      enabled: true,
      minVersion: '1.0.0',
      versionArgs: ['--version'],
      install: [{ via: 'npm', spec: '@example/alpha' }],
      skill: { command: ['skill', 'install'], agentFlag: '--agent' },
      auth: { command: ['auth', 'status'] },
      setup: [],
    });
    expect(alpha.origins).toEqual({
      binary: 'base',
      versionArgs: 'base',
      install: 'base',
      skill: 'base',
      auth: 'base',
      setup: 'base',
    });
  });

  it('lets an entry replace defaults wholesale and read "none" from an empty command', () => {
    const loaded = loadTools(bundled, undefined, cli);
    const beta = resolveTools(loaded.doc, loaded.provenance).find((t) => t.name === 'beta')!;
    expect(beta).toMatchObject({
      binary: 'beta-bin',
      versionArgs: ['version'],
      install: [{ via: 'brew', spec: 'beta' }],
    });
    expect(beta.skill).toBeUndefined();
    expect(beta.auth).toBeUndefined();
  });

  it('falls back to --version when neither the entry nor defaults say', () => {
    const loaded = loadTools(
      'schema_version: 3\ndefaults: { install: [{ via: manual }] }\ntools: [{ name: solo }]',
      undefined,
      cli,
    );
    expect(resolveTools(loaded.doc, loaded.provenance)[0]?.versionArgs).toEqual(['--version']);
  });

  it('marks the fields a patch changed as patch-origin, including inherited defaults', () => {
    const patch = [
      'schema_version: 3',
      'defaults: { auth: { command: [whoami] } }',
      'tools:',
      '  - name: alpha',
      '    version_args: [--ver]',
      '    enabled: false',
    ].join('\n');
    const loaded = loadTools(bundled, patch, cli);
    const alpha = resolveTools(loaded.doc, loaded.provenance).find((t) => t.name === 'alpha')!;
    expect(alpha.enabled).toBe(false);
    expect(alpha.versionArgs).toEqual(['--ver']);
    expect(alpha.origins.versionArgs).toBe('patch');
    expect(alpha.origins.auth).toBe('patch');
    expect(alpha.origins.skill).toBe('base');
  });
});

describe('extractSemver', () => {
  it('finds the version in every output shape the family produces', () => {
    expect(extractSemver('bitbucket-cli v0.14.1 (commit abc, built 2026)')).toBe('0.14.1');
    expect(extractSemver('lark-cli version 1.0.50')).toBe('1.0.50');
    expect(extractSemver('1.0.19\n')).toBe('1.0.19');
    expect(extractSemver('wecom-cli 1.2.0 (wecom 2026 sha)')).toBe('1.2.0');
    expect(extractSemver('git version 2.50.1 (Apple Git-155)')).toBe('2.50.1');
    expect(extractSemver('1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(extractSemver('no version here')).toBeUndefined();
  });
});
