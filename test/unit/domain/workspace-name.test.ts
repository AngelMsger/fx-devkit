import { describe, expect, it } from 'vitest';

import { assertWorkspaceName } from '../../../src/domain/workspace/name.js';

describe('assertWorkspaceName', () => {
  it('accepts plain identifiers and refuses anything that could leave ~/.fx', () => {
    for (const ok of ['fx', 'fx-2', 'A.b_c', '0x'])
      expect(() => assertWorkspaceName(ok)).not.toThrow();
    for (const bad of ['../../../tmp/owned', 'a/b', 'a\\b', '.hidden', '..', '', 'a'.repeat(65)])
      expect(() => assertWorkspaceName(bad), bad).toThrow(/not a usable workspace name/);
  });
});
