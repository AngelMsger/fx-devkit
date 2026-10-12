import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncGoWork } from '../../../../src/application/workspace/go-work.js';
import { harness, ROOT, type Harness } from '../../../fakes/workspace.js';

const workspace = (go: string): string => `schema_version: 2
defaults: {branch: main}
${go}
repos:
  - {name: kit, path: src/kit, upstream: 'https://git.example.com/team/kit.git'}
  - {name: cli, path: src/cli, upstream: 'https://git.example.com/team/cli.git'}
  - {name: site, path: src/site, upstream: 'https://git.example.com/team/site.git'}
  - {name: later, path: src/later, upstream: 'https://git.example.com/team/later.git'}
`;
const ON = 'go: {workspace: true}';
const GO_WORK = path.join(ROOT, 'go.work');
const write = { dryRun: false, posture: { readOnly: false, source: 'default' as const } };

// kit and cli are Go modules, site is not, and later is not cloned yet.
async function stage(go: string, files: Record<string, string> = {}): Promise<Harness> {
  return harness({
    workspace: workspace(go),
    files: {
      [path.join(ROOT, 'src/kit/go.mod')]: 'module example.com/kit\n\ngo 1.24.0\n',
      [path.join(ROOT, 'src/cli/go.mod')]: 'module example.com/cli\n\ngo 1.25.0\n',
      [path.join(ROOT, 'src/site/package.json')]: '{}',
      ...files,
    },
  });
}

describe('the root go.work', () => {
  it('covers the checked-out Go modules, then stays unchanged until they change', async () => {
    const h = await stage(ON);
    const first = await syncGoWork(h.deps, write);
    expect(first.file).toMatchObject({ path: GO_WORK, action: 'created', result: 'done' });
    expect(first.modules.map((m) => m.path)).toEqual(['src/kit', 'src/cli']);
    const text = await h.fs.readText(GO_WORK);
    expect(text).toContain('go 1.25.0\n\nuse (\n\t./src/cli\n\t./src/kit\n)\n');
    expect((await syncGoWork(h.deps, write)).file?.action).toBe('unchanged');
    await h.fs.writeText(path.join(ROOT, 'src/later/go.mod'), 'module example.com/later\n');
    expect((await syncGoWork(h.deps, write)).file?.action).toBe('updated');
    expect(await h.fs.readText(GO_WORK)).toContain('\t./src/later\n');
  });

  it('leaves out repositories this machine did not select', async () => {
    const h = await harness({
      workspace: workspace(ON),
      local: { scope: { repos: ['kit'] } },
      files: {
        [path.join(ROOT, 'src/kit/go.mod')]: 'module example.com/kit\n\ngo 1.24.0\n',
        [path.join(ROOT, 'src/cli/go.mod')]: 'module example.com/cli\n\ngo 1.25.0\n',
      },
    });
    await syncGoWork(h.deps, write);
    expect(await h.fs.readText(GO_WORK)).toContain('go 1.24.0\n\nuse (\n\t./src/kit\n)\n');
  });

  it("reports a person's own go.work and never touches it", async () => {
    const own = 'go 1.25.0\n\nuse ./src/cli\n';
    const h = await stage(ON, { [GO_WORK]: own });
    const out = await syncGoWork(h.deps, write);
    expect(out.file).toMatchObject({ action: 'foreign', result: 'skipped' });
    expect(h.reporter.codes()).toContain('GO_WORK_FOREIGN');
    expect(await h.fs.readText(GO_WORK)).toBe(own);
  });

  it('retires its own go.work once the manifest stops asking, and ignores anyone else’s', async () => {
    const h = await stage(ON);
    await syncGoWork(h.deps, write);
    const off = await stage('', { [GO_WORK]: (await h.fs.readText(GO_WORK))! });
    expect((await syncGoWork(off.deps, write)).file).toMatchObject({
      action: 'removed',
      result: 'done',
    });
    expect(await off.fs.exists(GO_WORK)).toBe(false);
    const own = await stage('', { [GO_WORK]: 'go 1.25.0\n' });
    expect((await syncGoWork(own.deps, write)).file).toBeNull();
    expect(own.reporter.codes()).not.toContain('GO_WORK_FOREIGN');
    expect((await syncGoWork((await stage('')).deps, write)).file).toBeNull();
  });

  it('plans without writing under --dry-run and refuses to write when read-only', async () => {
    const h = await stage(ON);
    const planned = await syncGoWork(h.deps, { ...write, dryRun: true });
    expect(planned.file).toMatchObject({ action: 'created', result: 'planned' });
    expect(await h.fs.exists(GO_WORK)).toBe(false);
    await expect(
      syncGoWork(h.deps, { ...write, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(await h.fs.exists(GO_WORK)).toBe(false);
  });
});
