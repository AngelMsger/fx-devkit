import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PushSourceInput } from '../../../../src/application/contribution/push-types.js';
import { PushSource } from '../../../../src/application/contribution/push.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeCodeHost } from '../../../fakes/fake-code-host.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import {
  SETTINGS,
  SOURCE,
  TARGET,
  FakeContributionGit,
  FakeContributionStore,
  FakeContributionTransport,
} from '../../../fakes/fake-contribution.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';

const input: PushSourceInput = {
  paths: ['a.md'],
  issue: 'g-1',
  title: 'Reviewed change',
  cliVersion: '1.0.0',
  dryRun: false,
  yes: true,
  forceNew: false,
  posture: { readOnly: false, source: 'default' },
};
function fixture() {
  const git = new FakeContributionGit();
  const transport = new FakeContributionTransport();
  const records = new FakeContributionStore();
  const host = new FakeCodeHost();
  const prompter = new FakePrompter();
  const expected = { root: path.resolve('/workspace'), source: SETTINGS.upstreamUrls[0]! };
  const config = new FakeConfigStore({ workspaces: { test: expected } });
  const fs = new FakeFs();
  const lock = new FakeLock();
  host.identities.set('~alice/manifest', {
    ref: SOURCE,
    cloneUrls: SETTINGS.originUrls,
    defaultBranch: 'main',
    personalOwner: 'alice',
    parent: TARGET,
  });
  host.identities.set('TEAM/manifest', {
    ref: TARGET,
    cloneUrls: SETTINGS.upstreamUrls,
    defaultBranch: 'main',
    personalOwner: null,
    parent: null,
  });
  let next = 0;
  let valid = true;
  transport.onFetch = () => {
    git.available = true;
  };
  const deps = {
    registration: {
      expected,
      physicalRoot: expected.root,
      logicalSourceDir: path.resolve('/source'),
      config,
      fs,
    },
    source: { workspace: 'test', dir: path.resolve('/source'), kind: 'repo' as const },
    git,
    transport,
    records,
    hostFor: () => host,
    prompter,
    ids: { next: () => `operation-${++next}` },
    clock: new FakeClock(),
    validator: {
      execute: async () => ({
        ok: valid,
        findings: valid
          ? []
          : [
              {
                path: 'manifest/workspace.yaml',
                rule: 'manifest-invalid',
                line: null,
                column: null,
              },
            ],
      }),
    },
    lock,
  };
  return {
    deps,
    config,
    fs,
    lock,
    git,
    transport,
    records,
    host,
    prompter,
    usecase: new PushSource(deps),
    invalidate: () => {
      valid = false;
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
type Registration = Fixture['deps']['registration']['expected'];
async function opened(f: Fixture) {
  await f.usecase.execute(input);
  return f.records.operations[0]!;
}

describe('source contribution orchestration', () => {
  it('previews in read-only mode without locks, journal writes or Git objects', async () => {
    const f = fixture();
    const result = await f.usecase.execute({
      ...input,
      dryRun: true,
      posture: { readOnly: true, source: 'env' },
    });
    expect(result).toMatchObject({
      action: 'create',
      validated: true,
      written: false,
      files: ['a.md'],
    });
    expect(JSON.stringify(result)).not.toContain('selected private contents');
    expect(f.lock.requests).toEqual([]);
    expect(f.records.writes).toEqual([]);
    expect(f.git.prepared).toEqual([]);
    expect(f.transport.pushes).toEqual([]);
  });
  it('gates writes after planning and never prompts under a lock', async () => {
    const f = fixture();
    await expect(
      f.usecase.execute({ ...input, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    f.prompter.unavailable = true;
    await expect(f.usecase.execute({ ...input, yes: false })).rejects.toMatchObject({
      code: 'CONFIRM_REQUIRED',
    });
    expect(f.lock.requests).toEqual([]);
    expect(f.records.writes).toEqual([]);
  });
  it('records the expected commit before publishing its branch and creates one PR', async () => {
    const f = fixture();
    f.git.beforePublish = () => {
      expect(f.records.operations[0]).toMatchObject({
        phase: 'committed',
        commit: expect.any(String),
      });
    };
    const result = await f.usecase.execute(input);
    expect(result).toMatchObject({
      action: 'create',
      written: true,
      pull_request: { id: '1', state: 'open' },
    });
    expect(f.records.operations[0]?.phase).toBe('open');
    expect(f.transport.pushes).toHaveLength(1);
    expect(f.host.createdPullRequests).toHaveLength(1);
    expect(JSON.stringify(f.records.operations)).not.toContain('selected private contents');
    expect(f.lock.unreleased()).toEqual([]);
  });
  it('uses the explicitly configured fork owner when the companion cannot report an actor', async () => {
    const f = fixture();
    f.host.user = undefined;
    const result = await new PushSource({ ...f.deps, user: 'alice' }).execute(input);
    expect(result).toMatchObject({
      action: 'create',
      source: { project: '~alice', name: 'manifest' },
    });
  });
  it('refuses invalid candidate content before recording or constructing anything', async () => {
    const f = fixture();
    f.invalidate();
    await expect(f.usecase.execute(input)).rejects.toMatchObject({
      code: 'SOURCE_VALIDATION_FAILED',
    });
    expect(f.records.writes).toEqual([]);
    expect(f.git.prepared).toEqual([]);
  });
  it('skips unchanged trees without touching the journal, branch or PR', async () => {
    const f = fixture();
    await opened(f);
    const count = f.records.writes.length;
    expect(await f.usecase.execute(input)).toMatchObject({ action: 'unchanged', written: false });
    expect(f.transport.pushes).toHaveLength(1);
    expect(f.git.prepared).toHaveLength(1);
    expect(f.host.createdPullRequests).toHaveLength(1);
    expect(f.records.writes).toHaveLength(count);
  });
  it('updates the same PR only when the new selection covers its previous files', async () => {
    const f = fixture();
    const previous = await opened(f);
    f.git.files = ['a.md', 'b.md'];
    f.git.tree = 'e'.repeat(40);
    f.git.fingerprint = 'changed';
    expect(await f.usecase.execute({ ...input, paths: ['a.md', 'b.md'] })).toMatchObject({
      action: 'update',
      branch: previous.branch,
    });
    expect(f.git.prepared[1]?.parent).toBe(previous.commit);
    expect(f.host.createdPullRequests).toHaveLength(1);
    f.git.files = ['b.md'];
    f.git.tree = 'f'.repeat(40);
    expect(await f.usecase.execute({ ...input, paths: ['b.md'] })).toMatchObject({
      action: 'create',
    });
    expect(f.records.operations).toHaveLength(2);
    expect(f.host.createdPullRequests).toHaveLength(2);
  });
  it('keeps pending records when a remote cannot be queried', async () => {
    const f = fixture();
    await opened(f);
    const before = structuredClone(f.records.operations);
    f.transport.failHead = true;
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ category: 'network' });
    expect(f.records.operations).toEqual(before);
  });
  it.each([
    {
      state: 'closed',
      settle: (f: Fixture): void => {
        const request = f.host.pullRequests.get('TEAM/manifest/1')!;
        f.host.pullRequests.set('TEAM/manifest/1', { ...request, state: 'merged' });
      },
    },
    {
      state: 'missing',
      settle: (f: Fixture, branch: string): void => {
        f.transport.heads.delete(branch);
      },
    },
  ])('retires a record only after authoritative $state evidence', async ({ settle }) => {
    const f = fixture();
    const previous = await opened(f);
    settle(f, previous.branch);
    const preview = await f.usecase.execute({ ...input, dryRun: true });
    expect(preview.retired).toEqual([previous.id]);
    expect(f.records.operations).toHaveLength(1);
    await f.usecase.execute(input);
    expect(f.records.operations).toHaveLength(1);
    expect(f.records.operations[0]?.id).not.toBe(previous.id);
  });
  it('revalidates a plan under its leases before writing', async () => {
    const f = fixture();
    f.lock.onAcquire(() => {
      f.git.fingerprint = 'concurrent edit';
    });
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ code: 'SOURCE_PLAN_CHANGED' });
    expect(f.git.prepared).toEqual([]);
    expect(f.records.writes).toEqual([]);
    expect(f.lock.unreleased()).toEqual([]);
  });
  it('does not publish a branch when the committed journal write fails', async () => {
    const f = fixture();
    f.records.failPhase = 'committed';
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ code: 'JOURNAL_WRITE_FAILED' });
    expect(f.records.operations[0]?.phase).toBe('prepared');
    expect(f.git.published).toEqual([]);
    expect(f.transport.pushes).toEqual([]);
    f.records.failPhase = undefined;
    await f.usecase.execute(input);
    expect(f.host.createdPullRequests).toHaveLength(1);
  });
  it('recovers a lost push response by comparing the intended commit without pushing again', async () => {
    const f = fixture();
    f.transport.losePushResponse = true;
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ category: 'network' });
    expect(f.records.operations[0]?.phase).toBe('committed');
    f.transport.losePushResponse = false;
    await f.usecase.execute(input);
    expect(f.transport.pushes).toHaveLength(1);
    expect(f.host.createdPullRequests).toHaveLength(1);
  });
  it('never blindly repeats an uncertain PR create and accepts verified association', async () => {
    const f = fixture();
    const create = f.host.createPullRequest.bind(f.host);
    f.host.createPullRequest = async (request) => {
      await create(request);
      throw new DevkitError('network', 'NETWORK', 'Lost create response.');
    };
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ category: 'network' });
    expect(f.records.operations[0]?.phase).toBe('creating_pr');
    await expect(f.usecase.execute(input)).rejects.toMatchObject({
      code: 'SOURCE_PR_CONFIRM_REQUIRED',
    });
    expect(f.host.createdPullRequests).toHaveLength(1);
    expect(await f.usecase.execute({ ...input, prRef: '1' })).toMatchObject({
      action: 'associate',
      pull_request: { id: '1' },
    });
    expect(f.host.createdPullRequests).toHaveLength(1);
    expect(f.transport.pushes).toHaveLength(1);
    expect(f.records.operations[0]?.phase).toBe('open');
  });
  it('retires an already-pushed operation when its remote branch has disappeared', async () => {
    const f = fixture();
    f.records.failPhase = 'creating_pr';
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ code: 'JOURNAL_WRITE_FAILED' });
    const old = f.records.operations[0]!;
    expect(old.phase).toBe('pushed');
    f.transport.heads.delete(old.branch);
    f.records.failPhase = undefined;
    const result = await f.usecase.execute(input);
    expect(result.action).toBe('create');
    expect(result.retired).toEqual([old.id]);
    expect(f.records.operations).toHaveLength(1);
    expect(f.records.operations[0]?.id).not.toBe(old.id);
  });
  it('can associate an already-merged PR after its source branch was removed', async () => {
    const f = fixture();
    const create = f.host.createPullRequest.bind(f.host);
    f.host.createPullRequest = async (request) => {
      await create(request);
      throw new DevkitError('network', 'NETWORK', 'Lost create response.');
    };
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ category: 'network' });
    const operation = f.records.operations[0]!;
    f.transport.heads.delete(operation.branch);
    f.host.pullRequests.set('TEAM/manifest/1', {
      ...f.host.pullRequests.get('TEAM/manifest/1')!,
      state: 'merged',
    });
    expect(await f.usecase.execute({ ...input, prRef: '1' })).toMatchObject({
      action: 'associate',
      pull_request: { state: 'merged' },
    });
    expect(f.records.operations).toEqual([]);
    expect(f.host.createdPullRequests).toHaveLength(1);
  });
  it('reports a missing local baseline honestly and fetches only after the write gate', async () => {
    const f = fixture();
    f.git.available = false;
    expect(await f.usecase.execute({ ...input, dryRun: true })).toMatchObject({
      action: 'needs-fetch',
      validated: false,
      written: false,
    });
    expect(f.transport.fetches).toEqual([]);
    await f.usecase.execute(input);
    expect(f.transport.fetches).toHaveLength(1);
  });
  it('acquires identity, workspace and source leases only after confirmation', async () => {
    const f = fixture();
    f.prompter.confirm = async () => {
      expect(f.lock.requests).toEqual([]);
      return true;
    };
    await f.usecase.execute({ ...input, yes: false });
    expect(f.lock.requests.map((request) => request.key)).toEqual([
      'workspace-operation:test',
      'workspace:test',
      `source:${f.deps.source.dir}`,
    ]);
    expect(f.lock.unreleased()).toEqual([]);
  });

  it.each([
    { operation: 'unregister', registered: (): Record<string, Registration> => ({}) },
    {
      operation: 'relocate',
      registered: (entry: Registration) => ({ test: { ...entry, root: path.resolve('/moved') } }),
    },
    {
      operation: 'rebind',
      registered: (entry: Registration) => ({
        test: { ...entry, source: 'https://git.example.com/other/source.git' },
      }),
    },
  ])(
    'rejects a stale registration changed by $operation during confirmation',
    async ({ registered }) => {
      const f = fixture();
      f.prompter.confirm = async () => {
        await f.config.write({ workspaces: registered(f.deps.registration.expected) });
        return true;
      };
      await expect(f.usecase.execute({ ...input, yes: false })).rejects.toMatchObject({
        code: 'WORKSPACE_PLAN_CHANGED',
      });
      expect(f.git.prepared).toEqual([]);
      expect(f.git.published).toEqual([]);
      expect(f.transport.fetches).toEqual([]);
      expect(f.transport.pushes).toEqual([]);
      expect(f.records.writes).toEqual([]);
      expect(f.lock.unreleased()).toEqual([]);
    },
  );

  it('rejects a pending identity journal before dry-run preflight and again after confirmation', async () => {
    const f = fixture();
    const journal = path.join(path.dirname(f.deps.source.dir), 'workspace-operation.json');
    await f.fs.writeText(journal, '{}');
    await expect(f.usecase.execute({ ...input, dryRun: true })).rejects.toMatchObject({
      code: 'WORKSPACE_OPERATION_PENDING',
    });
    expect(f.git.captureCalls).toBe(0);
    expect(f.lock.requests).toEqual([]);
    await f.fs.remove(journal);
    f.prompter.confirm = async () => {
      await f.fs.writeText(journal, '{}');
      return true;
    };
    await expect(f.usecase.execute({ ...input, yes: false })).rejects.toMatchObject({
      code: 'WORKSPACE_OPERATION_PENDING',
    });
    expect(f.records.writes).toEqual([]);
    expect(f.git.prepared).toEqual([]);
    expect(f.transport.pushes).toEqual([]);
    expect(f.lock.unreleased()).toEqual([]);
  });
});
