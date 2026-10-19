import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createContainer } from '../../../src/composition/container.js';
import { importDeps } from '../../../src/composition/import.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';
import { tempDir } from '../../temp.js';

const home = tempDir('fx-import-');

describe('import dependencies', () => {
  it('reads a local host through the provider for repositories kept under its directory', () => {
    const deps = importDeps(createContainer({ FX_HOME: home }), {
      reporter: new FakeReporter(),
      commandShell: 'posix',
    });
    expect(deps.localCodeHost(home).upstreamUrl({ project: 'fx', name: 'a' })).toBe(
      path.join(home, 'fx', 'a.git'),
    );
  });
});
