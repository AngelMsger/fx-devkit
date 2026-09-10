import { describe, expect, it } from 'vitest';

import { mcpSchema } from '../../../src/domain/manifest/harness.schema.js';
import { loadHarness } from '../../../src/domain/manifest/loader.js';

const options = { cliVersion: '0.1.0' };
const good = {
  name: 'knowledge',
  transport: 'stdio',
  command: ['knowledge-mcp', 'serve'],
  env: { SERVICE_TOKEN: { from_env: 'TEAM_SERVICE_TOKEN' } },
  variables: { TEAM_SERVICE_TOKEN: { instructions: 'Ask the team administrator.' } },
};
const document = (mcp: unknown[], extra = {}) =>
  JSON.stringify({ schema_version: 2, mcp, ...extra });

describe('harness manifest', () => {
  it('accepts an empty optional resource set and keeps references symbolic', () => {
    expect(loadHarness(document([]), options).doc.mcp).toEqual([]);
    expect(loadHarness(document([good]), options).doc.mcp[0]?.env).toEqual(good.env);
  });
  it('quarantines an inline credential without losing a valid sibling or echoing its value', () => {
    const secret = 'synthetic-inline-password';
    const result = loadHarness(
      document([good, { ...good, name: 'unsafe', env: { PASSWORD: secret } }]),
      options,
    );
    expect(result.doc.mcp.map((x) => x.name)).toEqual(['knowledge']);
    expect(result.dropped).toMatchObject([{ collection: 'mcp', name: 'unsafe' }]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('rejects ambiguous names and undefined variable instructions', () => {
    expect(() => loadHarness(document([good, good]), options)).toThrow();
    expect(() => loadHarness(document([{ ...good, variables: {} }]), options)).toThrow();
  });
  it('rejects credential URLs and incompatible transport fields', () => {
    for (const resource of [
      { name: 'remote', transport: 'http', url: 'https://user:password@mcp.example.com' },
      { ...good, url: 'https://mcp.example.com' },
      { name: 'remote', transport: 'http', url: 'https://mcp.example.com', command: ['server'] },
    ])
      expect(() => loadHarness(document([resource]), options)).toThrow();
  });
  it('rejects credential-shaped startup arguments at the schema boundary', () => {
    const result = mcpSchema.safeParse({ ...good, command: ['server', '--token=inline-secret'] });
    expect(result.success).toBe(false);
  });
  it('reports unknown fields in strict inspection and negotiates the version', () => {
    const result = loadHarness(document([good], { unexpected: true }), {
      ...options,
      strict: true,
      allowInvalid: true,
    });
    expect(result.unknown).toContain('unexpected');
    expect(() => loadHarness(document([], { schema_version: 99 }), options)).toThrow();
  });
  it('requires explicit reference bindings instead of credential arguments or implicit interpolation', () => {
    for (const command of [
      ['server', '--token', 'inline-value'],
      ['server', '${TOKEN}'],
    ])
      expect(mcpSchema.safeParse({ ...good, command }).success).toBe(false);
  });
});
