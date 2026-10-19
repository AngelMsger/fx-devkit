import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  contributionJournalPath,
  harnessStatePath,
  localLayerPath,
  manifestSourceDir,
  workspaceHome,
} from '../../../src/infra/workspace-home.js';

describe('workspace home', () => {
  it('keeps the personal layer and the manifest source under one directory per name', () => {
    expect(path.dirname(localLayerPath('/h', 'fx'))).toBe(
      path.dirname(manifestSourceDir('/h', 'fx')),
    );
  });

  it('places every entry, the manifest source included, directly in the personal directory', () => {
    const personal = workspaceHome('/h', 'fx');
    for (const entry of [
      localLayerPath,
      manifestSourceDir,
      harnessStatePath,
      contributionJournalPath,
    ])
      expect(path.dirname(entry('/h', 'fx'))).toBe(personal);
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
