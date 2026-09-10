import { describe, expect, it } from 'vitest';

import { NpmHttpRegistry, npmrcTokenIn } from '../../../src/adapters/registry/npm-http.js';

const REGISTRY = 'https://npm.example.com/repository/npm';

describe('npmrcTokenIn', () => {
  it('matches the registry host exactly or as a path under the line, and strips quotes', () => {
    const npmrc = [
      'registry=https://npm.example.com/',
      '//npm.example.com/:_authToken="abc"',
      '',
    ].join('\n');
    expect(npmrcTokenIn(npmrc, 'https://npm.example.com')).toBe('abc');
    expect(npmrcTokenIn(npmrc, REGISTRY)).toBe('abc');
    expect(npmrcTokenIn('//other.example.com/:_authToken=x', REGISTRY)).toBeUndefined();
    expect(npmrcTokenIn('//npm.example.com/repository/npm/:_authToken=deep', REGISTRY)).toBe(
      'deep',
    );
  });
});

describe('NpmHttpRegistry', () => {
  it('asks for the abbreviated document with the token, and reads dist-tags.latest', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ 'dist-tags': { latest: '0.3.0' } }), { status: 200 });
    }) as typeof fetch;
    const registry = new NpmHttpRegistry({
      registry: `${REGISTRY}/`,
      timeoutMs: 100,
      env: { FX_REGISTRY_TOKEN: 'tok' },
      userHome: '/nowhere',
      fetch: fake,
    });
    expect(await registry.latest('@fx/devkit')).toBe('0.3.0');
    expect(seen[0]).toEqual({
      url: `${REGISTRY}/@fx%2Fdevkit`,
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
    await expect(answer(401, {}).latest('@fx/devkit')).rejects.toMatchObject({
      category: 'auth',
      code: 'REGISTRY_HTTP_FAILED',
      message: expect.stringContaining('responded 401'),
    });
    await expect(answer(200, { 'dist-tags': {} }).latest('@fx/devkit')).rejects.toMatchObject({
      category: 'parse',
      code: 'REGISTRY_RESPONSE_INVALID',
      message: expect.stringContaining('dist-tags.latest'),
    });
  });
});
