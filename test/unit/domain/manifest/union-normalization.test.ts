// Preserve each declared union alternative until normal schema validation decides which one applies.
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import * as z from 'zod';

import { loadTools, loadToolsDocument } from '../../../../src/domain/manifest/loader.js';
import { stripUnknown } from '../../../../src/domain/manifest/reflect.js';

const baseline = 'schema_version: 2\ntools: [{name: baseline, install: [{via: manual}]}]\n';
function document(verify: unknown): string {
  return stringify({
    schema_version: 2,
    tools: [
      {
        name: 'fixture-tool',
        install: [{ via: 'manual' }],
        setup: [
          {
            id: 'access',
            kind: 'file',
            title: 'Provide access',
            expects: { path: '/fixture/access' },
            verify,
          },
        ],
      },
    ],
  });
}
const checks = [
  { command: ['check'] },
  { command: ['check'], json: { path: 'result.ready', equals: true } },
  { command: ['check'], json: { path: 'result.value', equals: null } },
  { file: '/fixture/access' },
  { provider: 'whoami' },
];

describe('setup verification union loading', () => {
  it.each([false, true])(
    'retains every valid verification alternative with strict=%s',
    (strict) => {
      for (const verify of checks) {
        const standalone = loadToolsDocument(document(verify), { cliVersion: '1.0.0', strict });
        const merged = loadTools(baseline, document(verify), { cliVersion: '1.0.0', strict });
        for (const result of [standalone, merged]) {
          expect(result.problems).toEqual([]);
          expect(result.unknown).toEqual([]);
          expect(result.dropped).toEqual([]);
          expect(
            result.doc.tools.find((tool) => tool.name === 'fixture-tool')?.setup?.[0]?.verify,
          ).toEqual(verify);
        }
      }
    },
  );

  it.each([false, true])(
    'rejects invalid types and mixed declared branches with strict=%s',
    (strict) => {
      for (const verify of [
        { file: 3 },
        { provider: 'unsupported' },
        { command: 'check' },
        { command: ['check'], file: '/fixture/access' },
        { file: '/fixture/access', provider: 'whoami' },
        { file: '/fixture/access', json: { path: 'ready', equals: true } },
        { command: ['check'], provider: 'whoami' },
        { command: ['check'], json: { path: 'ready', equals: { nested: true } } },
      ]) {
        const result = loadTools(baseline, document(verify), {
          cliVersion: '1.0.0',
          strict,
          allowInvalid: true,
        });
        expect(() =>
          loadTools(baseline, document(verify), { cliVersion: '1.0.0', strict }),
        ).toThrow(expect.objectContaining({ code: 'MANIFEST_UNUSABLE' }));
        expect(result.problems.length, stringify(verify)).toBeGreaterThan(0);
        expect(
          result.unknown,
          'declared alternatives must be rejected, not stripped as unknown',
        ).toEqual([]);
      }
    },
  );

  it('reports future keys leniently and rejects them strictly within each alternative', () => {
    for (const verify of checks) {
      const input = document({ ...verify, future_key: 'retained by future clients' });
      const lenient = loadTools(baseline, input, { cliVersion: '1.0.0' });
      expect(lenient.unknown).toEqual(['tools[0].setup[0].verify.future_key']);
      expect(
        lenient.doc.tools.find((tool) => tool.name === 'fixture-tool')?.setup?.[0]?.verify,
      ).toEqual(verify);
      expect(() => loadTools(baseline, input, { cliVersion: '1.0.0', strict: true })).toThrow(
        expect.objectContaining({ code: 'MANIFEST_UNUSABLE' }),
      );
      const strict = loadTools(baseline, input, {
        cliVersion: '1.0.0',
        strict: true,
        allowInvalid: true,
      });
      expect(strict.problems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'tools[0].setup[0].verify.future_key',
            message: 'unrecognised field',
          }),
        ]),
      );
    }
  });

  it('preserves an explicit null assertion while applying ordinary overlay deletions', () => {
    const base = stringify({
      schema_version: 2,
      defaults: { auth: { command: ['auth', 'status'] } },
      tools: [
        {
          name: 'fixture-tool',
          docs: 'https://docs.example.com/tool',
          install: [{ via: 'manual' }],
        },
      ],
    });
    const patch = stringify({
      schema_version: 2,
      defaults: { auth: null },
      tools: [
        {
          name: 'fixture-tool',
          docs: null,
          setup: [
            {
              id: 'value',
              kind: 'manual',
              title: 'Check value',
              verify: { command: ['check'], json: { path: 'value', equals: null } },
            },
          ],
        },
      ],
    });
    for (const strict of [false, true]) {
      const result = loadTools(base, patch, { cliVersion: '1.0.0', strict });
      expect(result.problems).toEqual([]);
      expect(result.doc.defaults).not.toHaveProperty('auth');
      expect(result.doc.tools[0]).not.toHaveProperty('docs');
      expect(result.doc.tools[0]?.setup?.[0]?.verify).toEqual({
        command: ['check'],
        json: { path: 'value', equals: null },
      });
    }
  });

  it('strips only unknown nested assertion fields while preserving scalar equality values', () => {
    for (const equals of ['ready', 0, false, null]) {
      const input = document({
        command: ['check'],
        json: { path: 'result.value', equals, future_key: 1 },
      });
      const result = loadToolsDocument(input, { cliVersion: '1.0.0' });
      expect(result.unknown).toEqual(['tools[0].setup[0].verify.json.future_key']);
      expect(result.doc.tools[0]?.setup?.[0]?.verify).toEqual({
        command: ['check'],
        json: { path: 'result.value', equals },
      });
    }
  });
});

describe('structural union normalization', () => {
  const schema = z.union([
    z.strictObject({ kind: z.literal('first'), value: z.strictObject({ first: z.string() }) }),
    z.strictObject({ kind: z.literal('second'), value: z.strictObject({ second: z.number() }) }),
  ]);
  it('keeps nested fields from same-named properties across union alternatives', () => {
    const stripped = stripUnknown(schema, {
      kind: 'second',
      value: { second: 2, future: true },
      extra: true,
    });
    expect(stripped).toEqual({
      value: { kind: 'second', value: { second: 2 } },
      unknown: [['value', 'future'], ['extra']],
    });
    expect(schema.safeParse(stripped.value).success).toBe(true);
    const mixed = stripUnknown(schema, { kind: 'first', value: { first: 'one', second: 2 } });
    expect(mixed.unknown).toEqual([]);
    expect(schema.safeParse(mixed.value).success).toBe(false);
  });

  it('normalizes unions of array and map alternatives without selecting a branch', () => {
    const arrays = z.union([z.array(schema), z.array(z.strictObject({ third: z.boolean() }))]);
    const input = [{ third: true, future: 'removed' }];
    expect(stripUnknown(arrays, input)).toEqual({
      value: [{ third: true }],
      unknown: [[0, 'future']],
    });
    const map = z.union([z.record(z.string(), schema), z.strictObject({ empty: z.boolean() })]);
    const stripped = stripUnknown(map, {
      selected: { kind: 'second', value: { second: 2, future: 3 } },
    });
    expect(map.safeParse(stripped.value).success).toBe(true);
    expect(stripped.unknown).toEqual([['selected', 'value', 'future']]);
  });

  it('retains unrestricted union alternatives rather than stripping accepted arbitrary data', () => {
    const accepting = z.union([z.strictObject({ known: z.string() }), z.unknown()]);
    const input = { future: { value: true } };
    expect(stripUnknown(accepting, input)).toEqual({ value: input, unknown: [] });
  });
});
