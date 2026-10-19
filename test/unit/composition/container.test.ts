import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DeadlineProcess } from '../../../src/adapters/process/deadline-process.js';
import { createContainer } from '../../../src/composition/container.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const home = mkdtempSync(path.join(tmpdir(), 'fx-container-'));

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('a decorated process port', () => {
  it('bounds the commands of members that were built on the port', async () => {
    const inner = new FakeProcess().always({ code: 1, stdout: '', stderr: '' });
    const bounded = createContainer(
      { FX_HOME: home },
      {
        decorateProcess: () => new DeadlineProcess(inner, { totalMs: 60_000, commandMs: 500 }),
      },
    );
    await bounded.registryLocator.resolve(bounded.packageMetadata().name);
    await bounded.git.toplevel(home);
    expect(inner.soleCallTo(['npm', 'config', 'get']).options).toMatchObject({
      interactive: false,
      timeoutMs: 500,
    });
    expect(inner.soleCallTo(['git']).options).toMatchObject({ interactive: false });
  });
});
