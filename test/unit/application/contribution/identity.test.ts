import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFs } from '../../../../src/adapters/fs/node-fs.js';
import { assertContributionIdentity } from '../../../../src/application/contribution/identity.js';
import { FileConfigStore } from '../../../../src/infra/config-store.js';
import { FileLock } from '../../../../src/infra/lock.js';
import { tempDir } from '../../../temp.js';

async function fixture() {
  const base = await fs.realpath(tempDir('fx-source-identity-'));
  const oldHome = path.join(base, 'old-state');
  const newHome = path.join(base, 'new-state');
  const home = path.join(base, 'fx-state');
  const oldRoot = path.join(base, 'old-workspace');
  const newRoot = path.join(base, 'new-workspace');
  const root = path.join(base, 'workspace');
  const kind = process.platform === 'win32' ? 'junction' : 'dir';
  for (const dir of [oldRoot, newRoot]) await fs.mkdir(dir);
  await fs.symlink(oldRoot, root, kind);
  const expected = { root, source: 'https://git.example.com/team/manifest.git' };
  for (const state of [oldHome, newHome]) {
    await fs.mkdir(path.join(state, 'workspaces/test/source'), { recursive: true });
    await fs.writeFile(
      path.join(state, 'config.yaml'),
      JSON.stringify({ workspaces: { test: expected } }),
    );
  }
  await fs.symlink(oldHome, home, kind);
  const logicalSourceDir = path.join(home, 'workspaces/test/source');
  const deps = {
    source: { workspace: 'test', dir: await fs.realpath(logicalSourceDir), kind: 'repo' as const },
    registration: {
      expected,
      physicalRoot: await fs.realpath(root),
      logicalSourceDir,
      config: new FileConfigStore(home, new FileLock(home)),
      fs: new NodeFs(),
    },
  };
  return { deps, base, oldHome, newHome, home, root, newRoot, kind };
}

describe('source contribution physical identity', () => {
  it('rejects a retargeted FX_HOME ancestor despite unchanged registry strings and an intact old source', async () => {
    const f = await fixture();
    await expect(assertContributionIdentity(f.deps)).resolves.toBeUndefined();
    await fs.unlink(f.home);
    await fs.symlink(f.newHome, f.home, f.kind);
    await expect(assertContributionIdentity(f.deps)).rejects.toMatchObject({
      code: 'WORKSPACE_PLAN_CHANGED',
    });
    expect(await fs.readdir(path.join(f.oldHome, 'workspaces/test/source'))).toEqual([]);
    expect(await fs.readdir(path.join(f.newHome, 'workspaces/test/source'))).toEqual([]);
  });

  it('rejects workspace-root alias retargeting while the source and registry strings stay unchanged', async () => {
    const f = await fixture();
    await fs.unlink(f.root);
    await fs.symlink(f.newRoot, f.root, f.kind);
    const registration = { ...f.deps.registration, commandShell: 'cmd' as const };
    await expect(assertContributionIdentity({ ...f.deps, registration })).rejects.toMatchObject({
      code: 'WORKSPACE_PLAN_CHANGED',
      nextSteps: ['fx ^"workspace^" ^"show^" ^"test^"'],
    });
  });

  it('checks pending lifecycle state through the registered logical source location', async () => {
    const f = await fixture();
    const journal = path.join(
      path.dirname(f.deps.registration.logicalSourceDir),
      'workspace-operation.json',
    );
    await fs.writeFile(journal, '{}');
    await expect(assertContributionIdentity(f.deps)).rejects.toMatchObject({
      code: 'WORKSPACE_OPERATION_PENDING',
    });
    await fs.unlink(journal);
    await fs.unlink(f.home);
    await fs.symlink(f.newHome, f.home, f.kind);
    await fs.writeFile(journal, '{}');
    const current = {
      ...f.deps,
      source: { ...f.deps.source, dir: await fs.realpath(f.deps.registration.logicalSourceDir) },
    };
    await expect(assertContributionIdentity(current)).rejects.toMatchObject({
      code: 'WORKSPACE_OPERATION_PENDING',
    });
    expect(await fs.readFile(journal, 'utf8')).toBe('{}');
  });
});
