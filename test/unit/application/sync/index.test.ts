import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { WritePosture } from '../../../../src/application/safety/posture.js';
import type { SkillDeps } from '../../../../src/application/skill/targets.js';
import { Sync } from '../../../../src/application/sync/index.js';
import type { WorkspaceDeps } from '../../../../src/application/workspace/deps.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness, MANIFEST_DIR, ROOT, withTrust } from '../../../fakes/workspace.js';
import { HeldWork } from '../../../held-work.js';

const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };
const everyStage = { dryRun: false, posture: writable, jobs: 4 };
// Most cases are about repositories and ask for that stage alone.
const run = { ...everyStage, only: 'repos' };
const upstream = (name: string): string => `ssh://git@git.example.com:12345/fx/${name}.git`;
const bundledSkill = path.resolve('/pkg/skills/fx-workspace');

// No provider recipe and no agent host unless a case selects one.
function sync(deps: WorkspaceDeps, hosts: SkillDeps['hosts'] = []): Sync {
  return new Sync(deps, {
    login: fakeLoginDeps({}),
    skills: {
      hosts,
      configured: undefined,
      bundledSkillDir: bundledSkill,
      globalLock: new FakeLock(),
    },
  });
}

describe('Sync', () => {
  it('reports preflight while an optional probe is pending, then clones once it times out', async () => {
    const h = await harness();
    // The readability probe stays open until the case lets it reach its deadline.
    const probing = new HeldWork<string>();
    h.codeHost.canRead = async (ref) => {
      await probing.hold(ref.name);
      throw new DevkitError('internal', 'PROCESS_TIMEOUT', 'optional probe timed out');
    };
    vi.useFakeTimers();
    try {
      const pending = sync(h.deps).execute(run);
      await vi.advanceTimersByTimeAsync(4999);
      expect(h.git.calls).toEqual([]);
      expect(h.reporter.progress_).toEqual(
        expect.arrayContaining([expect.objectContaining({ phase: 'preflight' })]),
      );
      // One more millisecond brings the record a program reads every five seconds.
      await vi.advanceTimersByTimeAsync(1);
      probing.releaseAll();
      expect((await pending).summary.done).toBe(3);
      expect(h.reporter.progress_).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ phase: 'preflight', elapsed_ms: 5000 }),
          expect.objectContaining({ phase: 'apply' }),
        ]),
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['a cancellation', 'canRead', new DevkitError('internal', 'PROCESS_ABORTED', 'cancelled')],
    ['a programming failure', 'canRead', new TypeError('programming failure')],
    ['a cancellation', 'whoami', new DevkitError('internal', 'PROCESS_ABORTED', 'cancelled')],
    ['a programming failure', 'whoami', new TypeError('programming failure')],
  ] as const)('propagates %s from %s before cloning', async (_failed, probe, failure) => {
    const h = await harness();
    h.codeHost[probe] = async () => {
      throw failure;
    };
    await expect(sync(h.deps).execute(run)).rejects.toBe(failure);
    expect(h.git.calls).toEqual([]);
  });

  it('keeps explicit Git upstreams usable without an API binding', async () => {
    const h = await harness({
      workspace:
        'schema_version: 2\nrepos: [{name: sample, upstream: "ssh://git@git.example.com/team/sample.git", branch: main}]',
    });
    const codeHost = () => {
      throw new DevkitError('config', 'PROVIDER_UNBOUND', 'no API binding');
    };
    expect((await sync({ ...h.deps, codeHost }).execute(run)).summary.done).toBe(1);
    expect(h.reporter.codes()).not.toContain('CODE_HOST_USER_UNKNOWN');
  });

  it('does not disguise provider construction errors as missing optional configuration', async () => {
    const h = await harness({ user: 'test' });
    const failure = new TypeError('broken provider');
    await expect(
      sync({
        ...h.deps,
        codeHost: () => {
          throw failure;
        },
      }).execute(run),
    ).rejects.toBe(failure);
    expect(h.git.calls).toEqual([]);
  });

  it('clones over Git when the optional code-host CLI is missing', async () => {
    const h = await harness();
    h.deps.codeHost().canRead = async () => {
      throw new DevkitError('config', 'TOOL_MISSING', 'optional API unavailable');
    };
    const result = await sync(h.deps).execute(run);
    expect(result.summary.failed).toBe(0);
    expect(h.git.calls.some((call) => call.startsWith('clone '))).toBe(true);
  });
  it('inspects no more than --jobs checkouts at once while planning', async () => {
    const h = await harness();
    const inspecting = new HeldWork<string>();
    h.git.before('status', (dir) => inspecting.hold(dir));
    for (const name of ['fx-example-api', 'fx-example-auth', 'fx-example-docs'])
      h.git.add(path.join(ROOT, name), { remotes: { upstream: upstream(name) } });

    const planned = sync(h.deps).execute({
      ...run,
      dryRun: true,
      posture: locked,
      jobs: 2,
    });
    await inspecting.reached(2);
    expect(inspecting.started).toHaveLength(2);
    inspecting.releaseAll();
    expect((await planned).items).toHaveLength(3);
  });

  it('clones what is missing with both remotes and fast-forwards what is there', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
      fastForward: 'updated',
    });
    const out = await sync(h.deps).execute(run);
    expect(out.items.map((i) => [i.name, i.action, i.result, i.outcome ?? null])).toEqual([
      ['fx-example-api', 'fast_forward', 'done', 'updated'],
      ['fx-example-auth', 'clone', 'done', null],
      ['fx-example-docs', 'clone', 'done', null],
    ]);
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-auth'))?.remotes).toEqual({
      upstream: upstream('fx-example-auth'),
      origin: 'ssh://git@git.example.com:12345/~alice/fx-example-auth.git',
    });
    expect(out.summary).toEqual({ done: 3, skipped: 0, failed: 0, unreadable: 0 });
  });

  it('touches nothing under dry-run and reports the plan', async () => {
    const h = await harness();
    const out = await sync(h.deps).execute({ ...run, dryRun: true, posture: locked });
    expect(out.items.every((i) => i.result === 'planned')).toBe(true);
    expect(h.git.calls).toEqual([]);
  });

  it('keeps an empty selection dry-run a preview with unknown preparation completeness', async () => {
    const h = await harness({
      local: { scope: { repos: [] } },
    });
    const result = await sync(h.deps).execute({ ...run, dryRun: true, posture: locked });
    expect(result).toMatchObject({ operation: 'preview', preparation: { state: 'planned' } });
    expect(result.items.every((item) => item.action === 'skip_unpicked')).toBe(true);
    expect(h.git.calls).toEqual([]);
    expect(h.codeHost.probes).toEqual([]);
  });

  it('previews and applies an origin-only upstream addition without rewriting origin', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    const dir = path.join(ROOT, 'fx-example-api');
    h.git.add(dir, { remotes: { origin: upstream('fx-example-api') } });
    const preview = await sync(h.deps).execute({ ...run, dryRun: true });
    expect(preview.items[0]).toMatchObject({
      upstream_to_add: upstream('fx-example-api'),
      result: 'planned',
    });
    expect(h.git.calls).toEqual([]);
    await expect(sync(h.deps).execute({ ...run, posture: locked })).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    expect(h.git.calls).toEqual([]);
    const applied = await sync(h.deps).execute(run);
    expect(applied.items[0]).toMatchObject({ upstream_added: true });
    expect(h.git.checkouts.get(dir)?.remotes).toEqual({
      origin: upstream('fx-example-api'),
      upstream: upstream('fx-example-api'),
    });
  });

  it('preserves changed remotes instead of applying stale adoption evidence', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    const dir = path.join(ROOT, 'fx-example-api');
    h.git.add(dir, { remotes: { origin: upstream('fx-example-api') } });
    // Someone repoints origin after the plan read the remotes and before adoption reads them.
    let reads = 0;
    h.git.before('remotes', () => {
      if (++reads > 1)
        h.git.add(dir, { remotes: { origin: 'ssh://git@elsewhere.example.com/p/api.git' } });
    });
    const out = await sync(h.deps).execute(run);
    expect(out.items[0]).toMatchObject({
      result: 'failed',
      failure: { code: 'REPO_REMOTES_CHANGED' },
    });
    expect(h.git.calls).toEqual([]);
  });

  it('refuses under read-only posture when there is something to do', async () => {
    const h = await harness();
    await expect(sync(h.deps).execute({ ...run, posture: locked })).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    expect(h.git.calls).toEqual([]);
  });

  // One dirty checkout, one whose fast-forward git refuses, and one repository left unpicked.
  async function dirtyAndRefused() {
    const h = await harness({ local: { scope: { repos: ['fx-example-api', 'fx-example-auth'] } } });
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
      state: { branch: 'dev', dirty: true, untracked: 0, ahead: 0, behind: 0 },
    });
    h.git.add(path.join(ROOT, 'fx-example-auth'), {
      remotes: { upstream: upstream('fx-example-auth') },
      state: { branch: 'main', dirty: false, untracked: 0, ahead: 0, behind: 0 },
      fastForward: 'diverged',
    });
    return h;
  }

  it('still fetches a dirty checkout but leaves it, and reports a refused fast-forward as skipped', async () => {
    const h = await dirtyAndRefused();
    const out = await sync(h.deps).execute(run);
    expect(out.items.map((i) => [i.name, i.action, i.result, i.outcome ?? null])).toEqual([
      ['fx-example-api', 'skip_dirty', 'skipped', null],
      ['fx-example-auth', 'fast_forward', 'skipped', 'diverged'],
      ['fx-example-docs', 'skip_unpicked', 'skipped', null],
    ]);
    const dirty = path.join(ROOT, 'fx-example-api');
    expect(h.git.calls).toContain(`fetch ${dirty} upstream`);
    expect(h.git.calls.filter((call) => call.startsWith(`fast-forward ${dirty} `))).toEqual([]);
    expect(h.git.calls).toContain(
      `fast-forward ${path.join(ROOT, 'fx-example-auth')} upstream/main`,
    );
  });

  it('counts the picked repositories through each phase for a watcher, never the one left out', async () => {
    const h = await dirtyAndRefused();
    await sync(h.deps).execute(run);
    const counts = h.activity.of('repos');
    expect(counts.filter((count) => count.phase === 'preflight').at(-1)).toMatchObject({
      total: 2,
      completed: 2,
    });
    expect(counts.at(-1)).toEqual({ phase: 'apply', total: 2, completed: 2, active: [] });
    expect(h.activity.counts.at(-1)).toEqual({ id: 'repos', count: undefined });
  });

  it('clones without origin and says so when the code host does not know the user', async () => {
    const h = await harness();
    h.codeHost.user = undefined;
    const out = await sync(h.deps).execute(run);
    expect(out.items[0]?.result).toBe('done');
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-api'))?.remotes).toEqual({
      upstream: upstream('fx-example-api'),
    });
    expect(h.reporter.codes()).toContain('CODE_HOST_USER_UNKNOWN');
  });

  it('lists unreadable repositories with their contact instead of failing', async () => {
    const h = await harness();
    h.codeHost.readability.set('fx/fx-example-docs', 'forbidden');
    const out = await sync(h.deps).execute(run);
    expect(out.items.find((i) => i.name === 'fx-example-docs')).toMatchObject({
      action: 'unreadable',
      result: 'skipped',
      contact: '#platform',
    });
    expect(out.summary.unreadable).toBe(1);
  });

  it('probes an absent repository again on every run', async () => {
    const h = await harness();
    h.codeHost.readability.set('fx/fx-example-docs', 'missing');
    const first = await sync(h.deps).execute(run);
    expect(first.items.find((item) => item.name === 'fx-example-docs')?.action).toBe('unreadable');
    h.codeHost.readability.set('fx/fx-example-docs', 'readable');
    const second = await sync(h.deps).execute(run);
    expect(second.items.find((item) => item.name === 'fx-example-docs')).toMatchObject({
      action: 'clone',
      result: 'done',
    });
    expect(h.codeHost.probes.filter((repo) => repo === 'fx/fx-example-docs')).toHaveLength(2);
    expect(h.codeHost.probes.filter((repo) => repo === 'fx/fx-example-api')).toHaveLength(1);
  });

  it('keeps going after one repository fails and reports the partial result', async () => {
    const h = await harness();
    h.git.before('clone', (req) => {
      if (req.dir.endsWith('fx-example-auth'))
        throw new DevkitError('network', 'GIT_OFFLINE', 'remote hung up', {
          nextSteps: ['Retry fx sync.'],
        });
    });
    const out = await sync(h.deps).execute(run);
    expect(out.items.map((i) => [i.name, i.result])).toEqual([
      ['fx-example-api', 'done'],
      ['fx-example-auth', 'failed'],
      ['fx-example-docs', 'done'],
    ]);
    expect(out.items[1]?.error).toContain('remote hung up');
    expect(out.items[1]?.failure).toMatchObject({
      code: 'GIT_OFFLINE',
      category: 'network',
      retryable: true,
      next_steps: ['Retry fx sync.'],
    });
    expect(out.summary.failed).toBe(1);
    expect(h.reporter.codes()).toContain('SYNC_PARTIAL');
  });

  it('clones no more than --jobs repositories at once', async () => {
    const h = await harness();
    const cloning = new HeldWork<string>();
    h.git.before('clone', (req) => cloning.hold(req.dir));

    const synced = sync(h.deps).execute({ ...run, jobs: 2 });
    await cloning.reached(2);
    expect(cloning.started).toHaveLength(2);
    cloning.releaseAll();
    expect((await synced).summary.done).toBe(3);
  });
});

// Stage orchestration: which stages run, in what order, and what a failure keeps.
// The stages are stubs here; each real stage is tested in its own suite.
describe('Sync stages', () => {
  describe('selection and order', () => {
    it('runs only the selected stages, in registration order, without touching repositories', async () => {
      const h = await harness();
      const out = await sync(h.deps).execute({ ...everyStage, only: ['tools', 'docs'] });
      expect(Object.keys(out.stages)).toEqual(['docs', 'tools']);
      expect(h.git.calls).toEqual([]);
      expect(out.items).toEqual([]);
      expect(out.stages).toEqual({
        docs: expect.objectContaining({ created: 1 }),
        tools: expect.objectContaining({ missing: 1 }),
      });
    });
  });

  describe('a failure', () => {
    it('in a later stage keeps repository and completed stage results and starts nothing after it', async () => {
      const h = await harness();
      // The Skill stage is the first to ask which agent hosts are present.
      const host = new FakeAgentHost('claude-code', true);
      host.detect = async () => {
        throw new DevkitError('config', 'VECTOR_UNTRUSTED', 'approval missing');
      };
      await expect(sync(h.deps, [host]).execute(everyStage)).rejects.toMatchObject({
        code: 'VECTOR_UNTRUSTED',
        partialResult: {
          operation: 'apply',
          preparation: { state: 'incomplete' },
          summary: { done: 3, failed: 0 },
          stages: {
            services: { configured: 0 },
            docs: { created: 1 },
            skills: { status: 'failed' },
            hooks: { status: 'not_started' },
          },
        },
      });
    });
  });

  it('keeps stage details separate from compatible summary counts', async () => {
    const h = await harness({
      files: {
        [path.join(bundledSkill, 'SKILL.md')]: '---\nname: fx-workspace\nversion: 1.0.0\n---\n',
        [`${MANIFEST_DIR}/manifest/tools.yaml`]:
          'schema_version: 3\ntools: [{name: example, install: [{via: manual}], skill: {command: [skill, install]}}]',
      },
    });
    h.process.binaries.add('example');
    h.process.on(['example', 'skill', 'install'], {
      code: 5,
      stdout: '',
      stderr: '{"error": {"code": "DENIED", "message": "denied"}}',
    });
    const out = await sync(withTrust(h.deps, { yes: true }), [
      new FakeAgentHost('claude-code', true),
    ]).execute({ ...everyStage, only: 'skills' });
    expect(out.stages).toEqual({ skills: expect.objectContaining({ tools_failed: 1 }) });
    expect(out.stage_details).toEqual({
      skills: {
        links: expect.any(Array),
        fx: expect.any(Array),
        tools: expect.arrayContaining([
          expect.objectContaining({
            tool: 'example',
            code: 5,
            failure: expect.objectContaining({ code: 'DENIED' }),
          }),
        ]),
      },
    });
  });
});

describe('Sync and the fork remote', () => {
  it('adds origin to a checkout that has none, once, and leaves one that points elsewhere', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api', 'fx-example-auth'] } } });
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    h.git.add(path.join(ROOT, 'fx-example-auth'), {
      remotes: {
        upstream: upstream('fx-example-auth'),
        origin: 'ssh://git@elsewhere.example.com/me/fx-example-auth.git',
      },
    });
    const out = await sync(h.deps).execute(run);
    expect(out.items.map((i) => [i.name, i.origin_added ?? false])).toEqual([
      ['fx-example-api', true],
      ['fx-example-auth', false],
      ['fx-example-docs', false],
    ]);
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-api'))?.remotes['origin']).toBe(
      'ssh://git@git.example.com:12345/~alice/fx-example-api.git',
    );
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-auth'))?.remotes['origin']).toBe(
      'ssh://git@elsewhere.example.com/me/fx-example-auth.git',
    );
    const again = await sync(h.deps).execute(run);
    expect(again.items.some((i) => i.origin_added)).toBe(false);
  });

  it('leaves a checkout without origin alone when nobody knows the user, and says so', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    h.codeHost.user = undefined;
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    const out = await sync(h.deps).execute(run);
    expect(out.items[0]).not.toHaveProperty('origin_added');
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-api'))?.remotes).toEqual({
      upstream: upstream('fx-example-api'),
    });
    expect(h.reporter.codes()).toContain('CODE_HOST_USER_UNKNOWN');
  });

  it('refuses under read-only posture when the only write would be an origin remote', async () => {
    const source = 'ssh://git@git.example.com:12345/fx/fx-workspace.git';
    const h = await harness({
      source,
      local: { scope: { repos: [] } },
      files: { [`${MANIFEST_DIR}/.git/HEAD`]: 'ref: refs/heads/main\n' },
    });
    h.git.add(MANIFEST_DIR, { remotes: { upstream: source } });
    await expect(sync(h.deps).execute({ ...run, posture: locked })).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    expect(h.git.calls).toEqual([]);
  });

  it('still reports the origin it added when a later step fails', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    h.git.before('fetch', () => {
      throw new Error('network down');
    });
    const out = await sync(h.deps).execute(run);
    expect(out.items[0]).toMatchObject({
      name: 'fx-example-api',
      result: 'failed',
      origin_added: true,
      error: 'network down',
    });
  });

  it('lists the manifest checkout, gives it its fork, and leaves the pull to the refresh', async () => {
    const source = 'ssh://git@git.example.com:12345/fx/fx-workspace.git';
    const h = await harness({
      source,
      local: { scope: { repos: ['fx-example-api'] } },
      files: { [`${MANIFEST_DIR}/.git/HEAD`]: 'ref: refs/heads/main\n' },
    });
    h.git.add(MANIFEST_DIR, {
      remotes: { upstream: source },
      state: { branch: 'main', dirty: false, untracked: 0, ahead: 0, behind: 0 },
    });
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    const out = await sync(h.deps).execute(run);
    expect(
      out.items.map((i) => [i.name, i.action, i.outcome ?? null, i.origin_added ?? false]),
    ).toEqual([
      ['fx-example-api', 'fast_forward', 'up_to_date', true],
      ['fx-workspace', 'skip_manifest', null, true],
      ['fx-example-auth', 'skip_unpicked', null, false],
      ['fx-example-docs', 'skip_unpicked', null, false],
    ]);
    expect(h.git.calls.filter((c) => c.includes(MANIFEST_DIR))).toEqual([
      `remote add ${MANIFEST_DIR} origin ssh://git@git.example.com:12345/~alice/fx-workspace.git`,
    ]);
    expect(h.git.checkouts.get(MANIFEST_DIR)?.remotes['origin']).toBe(
      'ssh://git@git.example.com:12345/~alice/fx-workspace.git',
    );
  });
});

describe('Sync with a configured user', () => {
  it('uses config.user for origin without asking the code host', async () => {
    const h = await harness({ user: 'bob' });
    h.codeHost.user = undefined;
    await sync(h.deps).execute(run);
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-api'))?.remotes['origin']).toBe(
      'ssh://git@git.example.com:12345/~bob/fx-example-api.git',
    );
    expect(h.reporter.codes()).not.toContain('CODE_HOST_USER_UNKNOWN');
  });
});
