// Proposed selections must remain valid when aliases and not-yet-created checkout leaves are resolved.
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { validateWorkspaceLayer } from '../../../src/application/workspace/validate-layer.js';
import type { Workspace } from '../../../src/domain/manifest/types.js';

const shared: Workspace = {
  schema_version: 2,
  defaults: {},
  repos: [{ name: 'api', path: 'group/api' }],
};

describe('physical layer validation', () => {
  it('detects overlapping missing leaves reached through a symlink parent', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'fx-layer-'));
    const root = path.join(base, 'root');
    const external = path.join(base, 'external');
    mkdirSync(root);
    mkdirSync(external);
    symlinkSync(
      external,
      path.join(root, 'group'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      validateWorkspaceLayer(new NodeFs(), root, shared, {
        repos: [{ name: 'personal', path: path.join(external, 'api') }],
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_INVALID' });
    expect(
      await validateWorkspaceLayer(new NodeFs(), root, shared, {
        repos: [{ name: 'personal', path: path.join(external, 'other') }],
      }),
    ).toMatchObject({ repos: [{ name: 'api' }, { name: 'personal' }] });
  });

  it('rejects a physical ancestor of the workspace reached through another path', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'fx-layer-'));
    const root = path.join(base, 'root');
    const alias = path.join(base, 'alias');
    mkdirSync(root);
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      validateWorkspaceLayer(new NodeFs(), root, shared, {
        scope: { repos: [] },
        repos: [{ name: 'personal', path: alias }],
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_INVALID' });
  });
});
