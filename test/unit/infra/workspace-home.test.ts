import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { localLayerPath, manifestSourceDir } from '../../../src/infra/workspace-home.js';

describe('workspace home', () => {
  it('keeps the personal layer and the manifest source under one directory per name', () => {
    expect(localLayerPath('/h', 'fx')).toBe(path.join('/h', 'workspaces', 'fx', 'local.yaml'));
    expect(manifestSourceDir('/h', 'fx')).toBe(path.join('/h', 'workspaces', 'fx', 'source'));
    expect(path.dirname(localLayerPath('/h', 'fx'))).toBe(
      path.dirname(manifestSourceDir('/h', 'fx')),
    );
  });

  it('refuses a name that would leave the home', () => {
    expect(() => localLayerPath('/h', '../x')).toThrow(
      expect.objectContaining({ code: 'WORKSPACE_NAME_INVALID' }),
    );
    expect(() => manifestSourceDir('/h', '../x')).toThrow(
      expect.objectContaining({ code: 'WORKSPACE_NAME_INVALID' }),
    );
  });
});
