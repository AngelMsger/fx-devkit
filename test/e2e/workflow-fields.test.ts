// The projection rules belong to the renderer's unit suite. These cases show that a list
// command and a report command hand their whole result to it.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, it } from 'vitest';

import { disabledBundledTools, freshHome, fx, repository } from './harness.js';

function fixture() {
  const base = freshHome();
  const repo = repository(base, 'api', {
    'package.json': '{"name":"fixture","version":"1.0.0"}\n',
  });
  const source = path.join(base, 'source');
  const root = path.join(base, 'work');
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    `schema_version: 2\ndefaults: {branch: main}\nrepos: [{name: api, upstream: '${repo.bare}'}, {name: docs, upstream: '${repo.bare}'}]\n`,
  );
  writeFileSync(path.join(source, 'manifest/tools.yaml'), disabledBundledTools());
  const env = { FX_HOME: freshHome() };
  const init = ['init', root, '--from', source, '--repos', 'api'];
  return { root, env, init };
}

it('projects the sync report, trailer included, through --fields', () => {
  const f = fixture();
  expect(fx([...f.init, '--format', 'json'], f.env).status).toBe(0);
  const result = fx(
    [
      'sync',
      '--dry-run',
      '--only',
      'repos,docs',
      '--format',
      'json',
      '--fields',
      'operation,items.name,summary.failed',
    ],
    f.env,
    f.root,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.json()).toEqual({
    operation: 'preview',
    'items.name': ['api', 'docs'],
    'summary.failed': 0,
  });
  expect(result.stderr).not.toContain('FIELDS_UNMATCHED');
});

it('projects the doctor report through --fields', () => {
  const f = fixture();
  expect(fx([...f.init, '--format', 'json'], f.env).status).toBe(0);
  const fields = 'preparation.state,coverage,summary,findings.group';
  const result = fx(['doctor', '--format', 'json', '--fields', fields], f.env, f.root);
  expect(result.status, result.stderr).toBe(0);
  expect(Object.keys(result.json() as object)).toEqual(fields.split(','));
  expect(result.stderr).not.toContain('FIELDS_UNMATCHED');
});
