import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { writeNodeShim } from '../platform.js';

import { freshHome, fx, manifestDirOf, userHome } from './harness.js';

function fixture() {
  const home = freshHome();
  const root = freshHome();
  const binaries = freshHome();
  const source = manifestDirOf(home, 'test');
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(
    path.join(home, 'config.yaml'),
    JSON.stringify({
      default_workspace: 'test',
      workspaces: { test: { root, source: '-' } },
    }),
  );
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    'schema_version: 2\ndefaults: {host: https://git.example.com, branch: main}\nrepos: [{name: app}]\n',
  );
  const env =
    'schema_version: 2\nplatforms:\n  kube: {provider: kubectl, capability: cluster}\nenvs:\n  dev:\n    platforms:\n      kube:\n        vars: {kubeconfig: "~/.kube/test", context: selected, namespace: team}\n        confidence: unverified\n        note: "keep this"\n';
  const file = path.join(source, 'manifest/environments.yaml');
  writeFileSync(file, env);
  const calls = path.join(binaries, 'calls.json');
  writeNodeShim(
    binaries,
    'kubectl',
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))); console.log('{}');\n`,
  );
  return {
    home,
    root,
    file,
    env,
    calls,
    vars: {
      FX_HOME: home,
      PATH: `${binaries}${path.delimiter}${process.env.PATH ?? ''}`,
      FX_SECRET: 'not-for-recording',
    },
  };
}
const args = [
  'where',
  'app',
  '--env',
  'dev',
  '--platform',
  'kube',
  '--probe',
  '--record',
  '--format',
  'json',
];

describe('where probe recording', () => {
  it('previews without running checks or touching source, even in read-only mode', () => {
    const f = fixture();
    const result = fx(
      [...args, '--dry-run'],
      { ...f.vars, FX_READ_ONLY: '1', FX_UPDATE_CHECK: '1' },
      f.root,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ action: 'preview', written: false, after: null });
    expect(existsSync(f.calls)).toBe(false);
    expect(readFileSync(f.file, 'utf8')).toBe(f.env);
    expect(existsSync(path.join(f.home, 'cache'))).toBe(false);
  });
  it('records a definite result and its template without expanded machine values, then becomes unchanged', () => {
    const f = fixture();
    const result = fx([...args, '--no-check'], f.vars, f.root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ action: 'recorded', written: true, after: 'verified' });
    const text = readFileSync(f.file, 'utf8');
    const coordinate = parse(text).envs.dev.platforms.kube;
    expect(coordinate.confidence).toBe('verified');
    expect(coordinate.note).toContain('{kubeconfig}');
    expect(coordinate.note).not.toContain(userHome);
    expect(text).not.toContain('not-for-recording');
    expect(JSON.parse(readFileSync(f.calls, 'utf8'))).toContain(path.join(userHome, '.kube/test'));
    const repeated = fx([...args, '--no-check'], f.vars, f.root);
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(repeated.json()).toMatchObject({ action: 'unchanged', written: false });
    expect(readFileSync(f.file, 'utf8')).toBe(text);
  });
  it('requires explicit recording inputs and refuses a read-only write before the probe', () => {
    const f = fixture();
    expect(fx(['where', 'app', '--record', '--format', 'json'], f.vars, f.root).error().code).toBe(
      'PROBE_RECORD_INPUT_REQUIRED',
    );
    expect(fx([...args, '--no-check'], { ...f.vars, FX_READ_ONLY: '1' }, f.root).error().code).toBe(
      'READONLY_BLOCKED',
    );
    expect(existsSync(f.calls)).toBe(false);
    expect(readFileSync(f.file, 'utf8')).toBe(f.env);
  });
});

it('offers the same safe recording preview through the explicit manifest action', () => {
  const f = fixture();
  const canonical = fx(
    [
      'manifest',
      'record-probe',
      'app',
      '--env',
      'dev',
      '--platform',
      'kube',
      '--dry-run',
      '--format',
      'json',
    ],
    { ...f.vars, FX_READ_ONLY: '1' },
    f.root,
  );
  const legacy = fx([...args, '--dry-run'], { ...f.vars, FX_READ_ONLY: '1' }, f.root);
  expect(canonical.status, canonical.stderr).toBe(0);
  expect(canonical.json()).toEqual(legacy.json());
  expect(existsSync(f.calls)).toBe(false);
  expect(readFileSync(f.file, 'utf8')).toBe(f.env);
});
