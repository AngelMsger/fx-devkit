import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveWorkspace } from '../../../src/application/workspace/resolve.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';

const manifestDirFor = (name: string): string =>
  path.resolve(`/home/.fx/workspaces/${name}/source`);

// A file system where /link/fx and /a-much-longer-alias are symbolic links.
class LinkedFs extends FakeFs {
  override async realpath(target: string): Promise<string> {
    for (const [alias, real] of [
      ['/link/fx', '/ws/fx'],
      ['/a-much-longer-alias', '/ws'],
    ]) {
      const relative = path.relative(path.resolve(alias!), path.resolve(target));
      if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
        return path.resolve(real!, relative);
    }
    return path.resolve(target);
  }
}

function resolve(overrides: {
  cwd?: string;
  name?: string;
  config?: FakeConfigStore;
  fs?: FakeFs;
}) {
  const reporter = new FakeReporter();
  return resolveWorkspace({
    cwd: overrides.cwd ?? path.resolve('/ws/fx/fx-example-api/src'),
    name: overrides.name,
    config:
      overrides.config ??
      new FakeConfigStore({
        default_workspace: 'fx',
        workspaces: {
          fx: { root: path.resolve('/ws/fx') },
          other: { root: path.resolve('/ws/other') },
        },
      }),
    fs: overrides.fs ?? FakeFs.from({}),
    reporter,
    manifestDirFor,
  }).then((located) => ({ located, reporter }));
}

describe('resolveWorkspace', () => {
  it('finds the registered workspace containing cwd, reading no file', async () => {
    const { located, reporter } = await resolve({});
    expect(located).toEqual({
      name: 'fx',
      root: path.normalize(path.resolve('/ws/fx')),
      manifestDir: manifestDirFor('fx'),
    });
    expect(reporter.codes()).toEqual([]);
  });

  it('prefers an explicit --workspace name and rejects an unknown one with a suggestion', async () => {
    const { located } = await resolve({ name: 'other' });
    expect(located.root).toBe(path.normalize(path.resolve('/ws/other')));
    await expect(resolve({ name: 'othr' })).rejects.toMatchObject({
      code: 'WORKSPACE_UNKNOWN',
      hint: expect.stringContaining('other'),
    });
  });

  it('takes the innermost of nested roots and never a sibling that shares a prefix', async () => {
    const config = new FakeConfigStore({
      workspaces: { outer: { root: path.resolve('/ws') }, fx: { root: path.resolve('/ws/fx') } },
    });
    expect(
      (await resolve({ config, cwd: path.resolve('/ws/fx/fx-example-api') })).located.name,
    ).toBe('fx');
    expect((await resolve({ config, cwd: path.resolve('/ws/fxtra') })).located.name).toBe('outer');
  });

  it('follows symbolic links before comparing, on cwd and on the roots alike', async () => {
    const { located } = await resolve({ cwd: path.resolve('/link/fx/deep'), fs: new LinkedFs() });
    expect(located.name).toBe('fx');
    const aliased = new FakeConfigStore({
      workspaces: {
        outer: { root: path.resolve('/a-much-longer-alias') },
        fx: { root: path.resolve('/link/fx') },
      },
    });
    const inner = await resolve({
      cwd: path.resolve('/ws/fx/repo'),
      config: aliased,
      fs: new LinkedFs(),
    });
    expect(inner.located).toMatchObject({
      name: 'fx',
      root: path.normalize(path.resolve('/ws/fx')),
    });
  });

  it('falls back to default_workspace outside any root and says so when there are several', async () => {
    const { located, reporter } = await resolve({ cwd: path.resolve('/elsewhere') });
    expect(located.name).toBe('fx');
    expect(reporter.notices).toEqual([
      expect.objectContaining({
        code: 'WORKSPACE_IMPLICIT',
        silence: 'FX_WORKSPACE=fx',
        data: { active: 'fx', available: ['fx', 'other'], override: '--workspace <name>' },
      }),
    ]);
    const one = new FakeConfigStore({
      default_workspace: 'fx',
      workspaces: { fx: { root: path.resolve('/ws/fx') } },
    });
    expect(
      (await resolve({ cwd: path.resolve('/elsewhere'), config: one })).reporter.codes(),
    ).toEqual([]);
  });

  it('fails with WORKSPACE_NOT_FOUND when nothing is registered for cwd', async () => {
    await expect(
      resolve({ cwd: path.resolve('/elsewhere'), config: new FakeConfigStore({}) }),
    ).rejects.toMatchObject({
      category: 'not_found',
      code: 'WORKSPACE_NOT_FOUND',
      message: expect.stringContaining('not inside a registered workspace'),
    });
  });
});
