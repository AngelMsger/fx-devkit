// Exercise report projection through real workflow entrypoints without remote services or host resources.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, it } from 'vitest';
import { parse } from 'yaml';

import { freshHome, fx, repository } from './harness.js';

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
  const baseline = parse(readFileSync('defaults/tools.yaml', 'utf8')) as {
    tools: { name: string }[];
  };
  writeFileSync(
    path.join(source, 'manifest/tools.yaml'),
    `schema_version: 2\ntools:\n${baseline.tools.map((tool) => `  - {name: ${tool.name}, enabled: false}`).join('\n')}\n`,
  );
  const env = { FX_HOME: freshHome(), FX_AGENTS: '' };
  const init = ['init', root, '--from', source, '--repos', 'api'];
  return { root, env, init };
}

it('projects init and sync preview/apply reports without exposing unrequested detail', () => {
  const f = fixture();
  const init = fx(
    [...f.init, '--format', 'json', '--fields', 'name,registered,preparation_complete'],
    f.env,
  );
  expect(init.status, init.stderr).toBe(0);
  expect(init.json()).toEqual({ name: 'work', registered: true, preparation_complete: true });
  for (const flags of [['--dry-run'], []]) {
    const result = fx(
      [
        'sync',
        '--only',
        'repos,docs',
        ...flags,
        '--format',
        'json',
        '--details',
        '--fields',
        'operation,preparation_complete,items,summary',
      ],
      f.env,
      f.root,
    );
    expect(result.status, result.stderr).toBe(0);
    const json = result.json() as { items: { name: string }[] };
    expect(Object.keys(json)).toEqual(['operation', 'preparation_complete', 'items', 'summary']);
    expect(json.items.map((item) => item.name)).toEqual(['api', 'docs']);
    expect(result.stdout).not.toContain('stage_details');
    expect(result.stdout).not.toContain('AGENTS.md');
    expect(result.stderr).not.toContain('FIELDS_UNMATCHED');
  }
  expect(existsSync(path.join(f.root, 'api/.git'))).toBe(true);
  expect(existsSync(path.join(f.root, 'docs'))).toBe(false);
  const ndjson = fx(
    [
      'sync',
      '--dry-run',
      '--only',
      'repos,docs',
      '--format',
      'ndjson',
      '--fields',
      'operation,items.name,summary.failed',
    ],
    f.env,
    f.root,
  );
  expect(ndjson.status, ndjson.stderr).toBe(0);
  expect(ndjson.stdout.trim().split('\n')).toHaveLength(1);
  expect(ndjson.json()).toEqual({
    operation: 'preview',
    'items.name': ['api', 'docs'],
    'summary.failed': 0,
  });
  const human = fx(
    ['sync', '--dry-run', '--only', 'repos', '--fields', 'operation,items.name'],
    f.env,
    f.root,
  );
  expect(human.status, human.stderr).toBe(0);
  expect(human.stdout).toContain('docs');
  expect(human.stdout).not.toContain('stage_details');
  expect(human.stderr).not.toContain('FIELDS_UNMATCHED');
  const empty = fx(
    ['sync', '--only', 'docs', '--format', 'json', '--fields', 'operation,items.name,summary.done'],
    f.env,
    f.root,
  );
  expect(empty.status, empty.stderr).toBe(0);
  expect(empty.json()).toEqual({ operation: 'apply', 'items.name': [], 'summary.done': 0 });
});

it('projects doctor and release summaries across JSON, NDJSON and human output', () => {
  const f = fixture();
  expect(fx([...f.init, '--format', 'json'], f.env).status).toBe(0);
  for (const command of [['doctor'], ['release', 'api', '--only', 'deps']]) {
    for (const format of ['json', 'ndjson', 'human']) {
      const result = fx(
        [
          ...command,
          '--format',
          format,
          '--details',
          '--fields',
          'ok,complete,summary,findings.group',
        ],
        f.env,
        f.root,
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toContain('FIELDS_UNMATCHED');
      expect(result.stdout).not.toContain('evidence');
      expect(result.stdout).not.toContain('stage_details');
      if (format !== 'human') {
        expect(Object.keys(result.json() as object)).toEqual([
          'ok',
          'complete',
          'summary',
          'findings.group',
        ]);
        expect(result.stdout.trim().split('\n')).toHaveLength(1);
      } else {
        expect(result.stdout).toContain('findings.group');
        expect(result.stdout).toContain('summary');
      }
    }
  }
});
