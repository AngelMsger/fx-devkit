import { describe, expect, it } from 'vitest';

import { NpmHttpRegistry } from '../../../src/adapters/registry/npm-http.js';
import { NpmRegistry } from '../../../src/adapters/registry/npm-registry.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const REGISTRY = 'https://npm.example.com/repository/npm';

describe('NpmHttpRegistry', () => {
  it('asks for the abbreviated document with the token, and reads dist-tags.latest', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ 'dist-tags': { latest: '0.3.0' } }), { status: 200 });
    }) as typeof fetch;
    const process = new FakeProcess();
    const registry = new NpmRegistry(process, {
      registry: `${REGISTRY}/`,
      timeoutMs: 100,
      env: { FX_REGISTRY_TOKEN: 'tok', FX_REGISTRY: REGISTRY },
      userHome: '/nowhere',
      fetch: fake,
    });
    expect(await registry.latest('@angelmsger/fx')).toBe('0.3.0');
    expect(process.calls).toEqual([]);
    expect(seen[0]).toEqual({
      url: `${REGISTRY}/@angelmsger%2Ffx`,
      headers: { Accept: 'application/vnd.npm.install-v1+json', Authorization: 'Bearer tok' },
    });
  });

  it('does not send a private environment token to the public default', async () => {
    let headers: HeadersInit | undefined;
    const registry = new NpmHttpRegistry({
      registry: 'https://registry.npmjs.org/',
      timeoutMs: 100,
      env: { FX_REGISTRY_TOKEN: 'private-token' },
      userHome: '/nowhere',
      fetch: (async (_url, init) => {
        headers = init?.headers;
        return new Response(JSON.stringify({ 'dist-tags': { latest: '0.1.0' } }));
      }) as typeof fetch,
    });
    await registry.latest('@angelmsger/fx');
    expect(new Headers(headers).has('Authorization')).toBe(false);
  });
  it('throws on a non-2xx answer and on a document without a latest tag', async () => {
    const answer = (status: number, body: unknown) =>
      new NpmHttpRegistry({
        registry: REGISTRY,
        timeoutMs: 100,
        env: {},
        userHome: '/nowhere',
        fetch: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
      });
    await expect(answer(401, {}).latest('@angelmsger/fx')).rejects.toMatchObject({
      category: 'auth',
      code: 'REGISTRY_HTTP_FAILED',
      message: expect.stringContaining('responded 401'),
    });
    await expect(answer(200, { 'dist-tags': {} }).latest('@angelmsger/fx')).rejects.toMatchObject({
      category: 'parse',
      code: 'REGISTRY_RESPONSE_INVALID',
      message: expect.stringContaining('dist-tags.latest'),
    });
  });
});
