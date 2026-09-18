import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { codeHostFor, createContainer } from '../../../src/composition/container.js';

const home = mkdtempSync(path.join(tmpdir(), 'fx-container-'));
const container = createContainer({ FX_HOME: home });

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('code host for an import host', () => {
  it('answers with a local host only for a directory that exists', async () => {
    const host = await codeHostFor(container, home);
    expect(host?.upstreamUrl({ project: 'fx', name: 'a' })).toBe(path.join(home, 'fx', 'a.git'));
    expect(await codeHostFor(container, path.join(home, 'absent'))).toBeUndefined();
    expect(await codeHostFor(container, 'ssh://git@git.example.com/fx/a.git')).toBeUndefined();
  });
});
