import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { jsonSchemaFor } from '../../../../src/domain/manifest/json-schema.js';
import { KINDS } from '../../../../src/domain/manifest/types.js';

const fixture = (name: string): unknown =>
  parse(readFileSync(path.resolve('test/fixtures/manifest', name), 'utf8'));

type Node = Record<string, unknown>;

function undescribed(node: Node, at: string, out: string[]): void {
  const properties = node['properties'] as Record<string, Node> | undefined;
  for (const [key, child] of Object.entries(properties ?? {})) {
    const here = at === '' ? key : `${at}.${key}`;
    if (typeof child['description'] !== 'string') out.push(here);
    undescribed(child, here, out);
  }
  for (const key of ['items', 'additionalProperties'] as const) {
    const child = node[key];
    if (typeof child === 'object' && child !== null) undescribed(child as Node, `${at}[]`, out);
  }
  for (const option of (node['anyOf'] as Node[] | undefined) ?? []) undescribed(option, at, out);
}

describe('jsonSchemaFor', () => {
  it.each(KINDS)(
    '%s carries identity, forbids unknown keys, and describes every property',
    (kind) => {
      const schema = jsonSchemaFor(kind, '1.2.3') as Node;
      expect(schema['$schema']).toContain('json-schema.org');
      expect(schema['$id']).toContain(kind);
      expect(schema['title']).toContain(kind);
      expect(schema['description']).toContain('1.2.3');
      expect(schema['additionalProperties']).toBe(false);
      const missing: string[] = [];
      undescribed(schema, '', missing);
      expect(missing).toEqual([]);
    },
  );

  it('validates the fixtures with a standard validator', () => {
    const compile = (kind: (typeof KINDS)[number]) =>
      new Ajv({ allErrors: true, strict: false }).compile(jsonSchemaFor(kind, '0.0.0'));
    const cases: [string, string][] = [
      ['workspace', 'v2-full/workspace.yaml'],
      ['environments', 'v2-full/environments.yaml'],
      ['tools', 'v2-full/tools.yaml'],
      ['members', 'v2-full/members.yaml'],
      ['workspace', 'v1-real-shape/workspace.yaml'],
      ['local', 'local/local.yaml'],
    ];
    for (const [kind, file] of cases) {
      const validate = compile(kind as (typeof KINDS)[number]);
      expect(validate(fixture(file)), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
    const workspace = compile('workspace');
    expect(workspace(fixture('broken/unknown-keys.yaml'))).toBe(false);
  });
});
