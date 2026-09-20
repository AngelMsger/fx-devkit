// Document updates preserve concurrent saves and expose enough evidence to resume partial writes.
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { NodeFs } from '../../../../src/adapters/fs/node-fs.js';
import { DeriveDocs } from '../../../../src/application/docs/derive.js';
import { RenderRegions } from '../../../../src/application/docs/render-regions.js';
import { Sync } from '../../../../src/application/sync/index.js';
import { syncStages } from '../../../../src/application/sync/stages.js';
import { WorkspaceContext } from '../../../../src/application/workspace-context.js';
import { createContainer } from '../../../../src/composition/container.js';
import { harnessSession } from '../../../../src/composition/harness.js';
import { asDevkitError } from '../../../../src/domain/errors.js';
import { FileLock } from '../../../../src/infra/lock.js';
import { FileProjectionStore } from '../../../../src/infra/projection-store.js';
import type { ProjectionStore } from '../../../../src/ports/projection.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness } from '../../../fakes/workspace.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const input = {
  check: false,
  dryRun: false,
  posture: { readOnly: false, source: 'default' as const },
};
const original =
  '# Team\nOriginal prose\n<!-- fx:begin project-index -->\nstale\n<!-- fx:end project-index -->\n';
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'fx-docs-recovery-')));
  directories.push(root);
  const source = path.join(root, 'source');
  await mkdir(source);
  const h = await harness();
  const lock = new FileLock(path.join(root, 'state'));
  const fs = new NodeFs(lock);
  const projections = new FileProjectionStore(lock);
  const context = { ...h.ctx.context, dir: source };
  const ctx = await WorkspaceContext.preview(root, 'docs', context, {}, fs);
  return { root, source, projections, deps: { ...h.deps, fs, ctx, projections } };
}

it('refuses an outdated render, then preserves the new prose on retry', async () => {
  const s = await fixture();
  const target = path.join(s.source, 'AGENTS.md');
  await writeFile(target, original);
  const concurrent = original.replace('Original prose', 'New instructions saved by a person');
  const projections: ProjectionStore = {
    read: (at) => s.projections.read(at),
    async write(request) {
      await writeFile(target, concurrent);
      return s.projections.write(request);
    },
  };
  const deps = { ...s.deps, context: s.deps.ctx.context, describeProvider: () => undefined };
  await expect(new RenderRegions({ ...deps, projections }).execute(input)).rejects.toMatchObject({
    code: 'DOCS_WRITE_CONFLICT',
    partialResult: { files: [{ result: 'failed' }, { result: 'not_started' }] },
  });
  expect(await readFile(target, 'utf8')).toBe(concurrent);
  const render = new RenderRegions(deps);
  await render.execute(input);
  expect(await readFile(target, 'utf8')).toContain('New instructions saved by a person');
  expect((await render.execute(input)).files.map((file) => file.result)).toEqual([
    'skipped',
    'skipped',
  ]);
});

it('keeps the first write in a failed sync report and resumes without rewriting it', async () => {
  const s = await fixture();
  const claude = path.join(s.root, 'CLAUDE.md');
  let interrupted = false;
  const projections: ProjectionStore = {
    read: (at) => s.projections.read(at),
    async write(request) {
      if (request.relative === 'CLAUDE.md' && !interrupted) {
        interrupted = true;
        await writeFile(claude, 'A person created this file after planning');
      }
      return s.projections.write(request);
    },
  };
  const deps = { ...s.deps, projections };
  const docs = new DeriveDocs(deps, { describeProvider: () => undefined });
  const sync = () =>
    new Sync(deps).execute({
      ...input,
      jobs: 1,
      only: 'docs',
      stages: {
        docs: async () => ({ summary: {}, details: { files: (await docs.execute(input)).files } }),
      },
    });
  const failure = await sync().then(() => {
    throw new Error('Expected a document conflict');
  }, asDevkitError);
  expect(failure).toMatchObject({
    code: 'DOCS_WRITE_CONFLICT',
    partialResult: {
      preparation_complete: false,
      stage_details: {
        docs: {
          files: [
            { result: 'done' },
            { result: 'failed', failure: { code: 'DOCS_WRITE_CONFLICT' } },
          ],
        },
      },
    },
  });
  const agents = await readFile(path.join(s.root, 'AGENTS.md'), 'utf8');
  expect(agents).toContain('# docs workspace');
  expect(await readFile(claude, 'utf8')).toBe('A person created this file after planning');
  await rm(claude);
  const resumed = await sync();
  expect(resumed).toMatchObject({
    preparation_complete: true,
    stage_details: {
      docs: {
        files: [
          { action: 'unchanged', result: 'skipped' },
          { action: 'created', result: 'done' },
        ],
      },
    },
  });
  expect(await readFile(path.join(s.root, 'AGENTS.md'), 'utf8')).toBe(agents);
});

it('retains completed documents when the following rules source cannot be projected', async () => {
  const s = await fixture();
  const env = { FX_HOME: path.join(s.root, 'state'), FX_AGENTS: '' };
  const container = createContainer(env);
  await container.config.write({ workspaces: { docs: { root: s.root } }, agents: [] });
  const blocked = path.join(s.source, 'manifest/harness.yaml');
  await mkdir(blocked, { recursive: true });
  const login = fakeLoginDeps({});
  const stages = syncStages({
    deps: s.deps,
    login,
    process: container.process,
    trust: { ...login.trust, workspace: s.deps.ctx.name },
    dryRun: false,
    posture: input.posture,
    skills: { hosts: [], configured: [], bundledSkillDir: s.source, globalLock: container.lock },
    harness: harnessSession({
      container,
      env,
      cliVersion: '1.0.0',
      noInput: true,
      yes: false,
      posture: input.posture,
      resolve: {
        cwd: s.root,
        name: 'docs',
        config: container.config,
        fs: s.deps.fs,
        reporter: s.deps.reporter,
        manifestDirFor: () => s.source,
      },
    }),
  });
  const sync = () => new Sync(s.deps).execute({ ...input, jobs: 1, only: 'docs', stages });
  await expect(sync()).rejects.toMatchObject({
    code: 'HARNESS_SOURCE_FOREIGN',
    partialResult: {
      stage_details: { docs: { files: [{ result: 'done' }, { result: 'done' }] } },
    },
  });
  await rm(blocked, { recursive: true });
  await expect(sync()).resolves.toMatchObject({
    preparation_complete: true,
    stage_details: {
      docs: {
        files: [
          { action: 'unchanged', result: 'skipped' },
          { action: 'unchanged', result: 'skipped' },
        ],
      },
    },
  });
});
