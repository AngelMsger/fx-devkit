import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bundledToolsPathFrom } from '../../../src/composition/bundled.js';

describe('bundled assets', () => {
  it('names the bundled toolchain by a local path under a directory with a space or a non-ASCII name', () => {
    const root = path.resolve('/');
    const moduleUrl = new URL(
      'program%20files/fx%20%E5%B7%A5%E5%85%B7/dist/composition/bundled.js',
      pathToFileURL(root),
    ).href;
    expect(bundledToolsPathFrom(moduleUrl)).toBe(
      path.join(root, 'program files', 'fx 工具', 'defaults', 'tools.yaml'),
    );
  });
});
