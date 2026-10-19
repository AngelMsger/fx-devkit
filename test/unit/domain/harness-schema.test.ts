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
const problemPaths = (mcp: unknown[]): string[] =>
  loadHarness(document(mcp), { ...options, allowInvalid: true }).problems.map((p) => p.path);

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
    expect(problemPaths([good, good])).toEqual(['mcp']);
    expect(() => loadHarness(document([good, good]), options)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
    expect(problemPaths([{ ...good, variables: {} }])).toEqual(['mcp[0].variables']);
  });
  it.each([
    {
      case: 'a credential URL',
      resource: { name: 'remote', transport: 'http', url: 'https://user:password@mcp.example.com' },
      path: 'mcp[0].url',
    },
    {
      case: 'a URL on a stdio resource',
      resource: { ...good, url: 'https://mcp.example.com' },
      path: 'mcp[0].transport',
    },
    {
      case: 'a command on an HTTP resource',
      resource: {
        name: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com',
        command: ['server'],
      },
      path: 'mcp[0].transport',
    },
  ])('rejects $case at its field', ({ resource, path }) => {
    expect(problemPaths([resource])).toEqual([path]);
  });
  it('rejects credential-shaped startup arguments at the schema boundary', () => {
    const result = mcpSchema.safeParse({ ...good, command: ['server', '--token=inline-secret'] });
    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['command']);
  });
  it('reports unknown fields in strict inspection and negotiates the version', () => {
    const result = loadHarness(document([good], { unexpected: true }), {
      ...options,
      strict: true,
      allowInvalid: true,
    });
    expect(result.unknown).toContain('unexpected');
    expect(() => loadHarness(document([], { schema_version: 99 }), options)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_SCHEMA_TOO_NEW' }),
    );
  });
  it('requires explicit reference bindings instead of credential arguments or implicit interpolation', () => {
    for (const command of [
      ['server', '--token', 'inline-value'],
      ['server', '${TOKEN}'],
    ])
      expect(
        mcpSchema.safeParse({ ...good, command }).error?.issues.map((issue) => issue.path),
        command.join(' '),
      ).toEqual([['command']]);
  });
});
