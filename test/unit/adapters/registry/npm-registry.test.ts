// A real npm client must use its selected userconfig and expand scoped authentication.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { NodeProcess } from '../../../../src/adapters/process/node-process.js';
import { NpmRegistryLocator } from '../../../../src/adapters/registry/npm-config.js';
import { NpmRegistry } from '../../../../src/adapters/registry/npm-registry.js';

it('reads private metadata using native npm userconfig and environment-backed authentication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fx-npm-metadata-'));
  const requests: { url: string | undefined; authorization: string | undefined }[] = [];
  let status = 200;
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'public, max-age=600');
    response.statusCode = status;
    response.end(
      JSON.stringify(
        status !== 200
          ? { error: 'Fixture access denied' }
          : {
              name: '@fx/devkit',
              'dist-tags': { latest: '0.4.0' },
              versions: { '0.4.0': { name: '@fx/devkit', version: '0.4.0' } },
            },
      ),
    );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const registry = `http://127.0.0.1:${address.port}/team/`;
    const config = path.join(root, 'user.npmrc');
    const global = path.join(root, 'global.npmrc');
    await writeFile(global, '');
    await writeFile(
      config,
      `@fx:registry=${registry}\nregistry=https://registry.npmjs.org/\n//127.0.0.1:${address.port}/team/:_authToken=\${DEMO_NPM_TOKEN}\n`,
    );
    const env = {
      HOME: root,
      // npm lifecycle scripts supply lowercase keys, which win over uppercase
      // variants. Override those keys to keep the caller's config out of this fixture.
      npm_config_userconfig: config,
      npm_config_globalconfig: global,
      npm_config_cache: path.join(root, 'cache'),
      DEMO_NPM_TOKEN: 'fixture-secret',
      FX_REGISTRY_TOKEN: 'unused-legacy-token',
    };
    const process = new NodeProcess();
    expect(await new NpmRegistryLocator(process, env, root).resolve('@fx/devkit')).toEqual({
      registry,
      source: 'npm_scope',
    });
    const client = new NpmRegistry(process, { registry, env, userHome: root, timeoutMs: 5000 });
    expect(await client.latest('@fx/devkit')).toBe('0.4.0');
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests)
      expect({ ...request, url: decodeURIComponent(request.url ?? '') }).toEqual({
        url: '/team/@fx/devkit',
        authorization: 'Bearer fixture-secret',
      });
    status = 401;
    await expect(client.latest('@fx/devkit')).rejects.toMatchObject({
      category: 'auth',
      code: 'REGISTRY_HTTP_FAILED',
    });
    status = 503;
    await expect(client.latest('@fx/devkit')).rejects.toMatchObject({
      category: 'server',
      code: 'REGISTRY_HTTP_FAILED',
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
