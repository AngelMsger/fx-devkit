import { describe, expect, it } from 'vitest';

import { DeadlineProcess } from '../../../src/adapters/process/deadline-process.js';
import { createContainer } from '../../../src/composition/container.js';
import { FakeProcess } from '../../fakes/fake-process.js';
import { tempDir } from '../../temp.js';

const home = tempDir('fx-container-');

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
