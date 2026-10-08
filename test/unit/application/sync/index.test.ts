import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { BitbucketCodeHost } from '../../../../src/adapters/code-host/bitbucket-cli/provider.js';
import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { Sync } from '../../../../src/application/sync/index.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeGit } from '../../../fakes/fake-git.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { harness, MANIFEST_DIR, ROOT } from '../../../fakes/workspace.js';

const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };
const run = { dryRun: false, posture: writable, jobs: 4 };
const upstream = (name: string): string => `ssh://git@git.example.com:12345/fx/${name}.git`;

describe('Sync', () => {
  it('retains completed service preparation when a later requested stage fails', async () => {
    const h = await harness();
    await expect(
      new Sync(h.deps).execute({
        ...run,
        only: ['services', 'docs', 'tools'],
        stages: {
          services: async () => ({
            checks: [],
            summary: { configured: 1 },
            details: { items: [{ status: 'configured' }] },
          }),
          docs: async () => ({ checks: [], summary: { created: 2 } }),
          tools: async () => {
            throw new DevkitError('config', 'VECTOR_UNTRUSTED', 'review the tool probe');
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'VECTOR_UNTRUSTED',
      partialResult: {
        operation: 'apply',
        preparation: { state: 'incomplete' },
        stages: { services: { configured: 1 }, docs: { created: 2 }, tools: { status: 'failed' } },
      },
    });
  });
  it('reports preflight while a bounded optional probe waits, then clones after timeout', async () => {
    const h = await harness({ user: 'test' });
    const proc = new FakeProcess();
    proc.run = async (_vector, options) => {
      expect(options?.timeoutMs).toBe(5000);
      await new Promise((resolve) => setTimeout(resolve, options!.timeoutMs));
      throw new DevkitError('internal', 'PROCESS_TIMEOUT', 'optional probe timed out');
    };
    const host = new BitbucketCodeHost(
      { process: proc, fs: h.fs, clock: new FakeClock() },
      { host: 'ssh://git@git.example.com' },
    );
    vi.useFakeTimers();
    try {
      const pending = new Sync({ ...h.deps, codeHost: () => host }).execute(run);
      await vi.advanceTimersByTimeAsync(4999);
      expect(h.git.calls).toEqual([]);
      expect(h.reporter.progress_).toEqual(
        expect.arrayContaining([expect.objectContaining({ phase: 'preflight' })]),
      );
      await vi.advanceTimersByTimeAsync(1);
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

  it.each(['canRead', 'whoami'] as const)(
    'propagates cancellation and programming failures from %s before cloning',
    async (method) => {
      for (const failure of [
        new DevkitError('internal', 'PROCESS_ABORTED', 'cancelled'),
        new TypeError('programming failure'),
      ]) {
        const h = await harness();
        h.codeHost[method] = async () => {
          throw failure;
        };
        await expect(new Sync(h.deps).execute(run)).rejects.toBe(failure);
        expect(h.git.calls).toEqual([]);
      }
    },
  );

  it('keeps explicit Git upstreams usable without an API binding', async () => {
    const h = await harness({
      workspace:
        'schema_version: 2\nrepos: [{name: sample, upstream: "ssh://git@git.example.com/team/sample.git", branch: main}]',
    });
    const codeHost = () => {
      throw new DevkitError('config', 'PROVIDER_UNBOUND', 'no API binding');
    };
    expect((await new Sync({ ...h.deps, codeHost }).execute(run)).summary.done).toBe(1);
    expect(h.reporter.codes()).not.toContain('CODE_HOST_USER_UNKNOWN');
  });

  it('does not disguise provider construction errors as missing optional configuration', async () => {
    const h = await harness({ user: 'test' });
    const failure = new TypeError('broken provider');
    await expect(
      new Sync({
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
    const result = await new Sync(h.deps).execute(run);
    expect(result.summary.failed).toBe(0);
    expect(h.git.calls.some((call) => call.startsWith('clone '))).toBe(true);
  });
  it('retains repository and completed stage results on a later failure', async () => {
    const h = await harness();
    await expect(
      new Sync(h.deps).execute({
        ...run,
        stages: {
          docs: async () => ({ checks: [], summary: { created: 1 } }),
          skills: async () => {
            throw new DevkitError('config', 'VECTOR_UNTRUSTED', 'approval missing');
          },
          hooks: async () => ({ checks: [], summary: { created: 1 } }),
        },
      }),
    ).rejects.toMatchObject({
      code: 'VECTOR_UNTRUSTED',
      partialResult: {
        summary: { failed: 0 },
        stages: {
          docs: { created: 1 },
          skills: { status: 'failed' },
          hooks: { status: 'not_started' },
        },
      },
    });
  });

  it('keeps stage details separate from compatible summary counts', async () => {
    const h = await harness();
    const details = { tools: [{ tool: 'example', code: 5, failure: { code: 'DENIED' } }] };
    const out = await new Sync(h.deps).execute({
      ...run,
      only: 'skills',
      stages: {
        skills: async () => ({ checks: [], summary: { tools_failed: 1 }, details }),
      },
    });
    expect(out.stages).toEqual({ skills: { tools_failed: 1 } });
    expect(out.stage_details).toEqual({ skills: details });
  });

  it('runs registered stages in order without touching repositories for a selected subset', async () => {
    const h = await harness();
    const calls: string[] = [];
    const out = await new Sync(h.deps).execute({
      ...run,
      only: ['sample', 'docs'],
      stages: {
        docs: async () => {
          calls.push('docs');
          return { checks: [], summary: { ok: 1 } };
        },
        sample: async () => {
          calls.push('sample');
          return { checks: [], summary: { ok: 2 } };
        },
        tools: async () => {
          throw new Error('unselected');
        },
      },
    });
    expect(calls).toEqual(['docs', 'sample']);
    expect(h.git.calls).toEqual([]);
    expect(out.items).toEqual([]);
    expect(out.stages).toEqual({ docs: { ok: 1 }, sample: { ok: 2 } });
  });
  it('plans sixty checkouts concurrently up to --jobs without reordering them', async () => {
    const names = Array.from({ length: 60 }, (_, index) => `repo-${index}`);
    const workspace = [
      'schema_version: 2',
      'providers: { code-host: { provider: local-git, vars: { host: /host } } }',
      'defaults: { upstream_project: fx, branch: main }',
      'repos:',
      ...names.map((name) => `  - { name: ${name} }`),
    ].join('\n');
    const h = await harness({ workspace });
    let inFlight = 0;
    let peak = 0;
    const git = new (class extends FakeGit {
      override async status(dir: string) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return super.status(dir);
      }
    })();
    for (const name of names) {
      const dir = path.join(ROOT, name);
      h.git.add(dir, { remotes: { upstream: upstream(name), origin: `/fork/${name}` } });
      git.add(dir, { remotes: { upstream: upstream(name), origin: `/fork/${name}` } });
    }

    const out = await new Sync({ ...h.deps, git }).execute({
      dryRun: true,
      posture: locked,
      jobs: 6,
    });

    expect(peak).toBe(6);
    expect(out.items.map((item) => item.name)).toEqual(names);
  });

  it('clones what is missing with both remotes and fast-forwards what is there', async () => {
    const h = await harness();
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
      fastForward: 'updated',
    });
    const out = await new Sync(h.deps).execute(run);
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
    const out = await new Sync(h.deps).execute({ ...run, dryRun: true, posture: locked });
    expect(out.items.every((i) => i.result === 'planned')).toBe(true);
    expect(h.git.calls).toEqual([]);
  });

  it('keeps an empty selection dry-run a preview with unknown preparation completeness', async () => {
    const h = await harness({
      local: { scope: { repos: [] } },
    });
    const result = await new Sync(h.deps).execute({ ...run, dryRun: true, posture: locked });
    expect(result).toMatchObject({ operation: 'preview', preparation: { state: 'planned' } });
    expect(result.items.every((item) => item.action === 'skip_unpicked')).toBe(true);
    expect(h.git.calls).toEqual([]);
    expect(h.codeHost.probes).toEqual([]);
  });

  it('previews and applies an origin-only upstream addition without rewriting origin', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    const dir = path.join(ROOT, 'fx-example-api');
    h.git.add(dir, { remotes: { origin: upstream('fx-example-api') } });
    const preview = await new Sync(h.deps).execute({ ...run, dryRun: true });
    expect(preview.items[0]).toMatchObject({
      upstream_to_add: upstream('fx-example-api'),
      result: 'planned',
    });
    expect(h.git.calls).toEqual([]);
    await expect(new Sync(h.deps).execute({ ...run, posture: locked })).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    expect(h.git.calls).toEqual([]);
    const applied = await new Sync(h.deps).execute(run);
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
    const read = h.git.remotes.bind(h.git);
    let calls = 0;
    h.git.remotes = async (target) => {
      const value = await read(target);
      return ++calls > 1
        ? { ...value, origin: 'ssh://git@elsewhere.example.com/p/api.git' }
        : value;
    };
    const out = await new Sync(h.deps).execute(run);
    expect(out.items[0]).toMatchObject({
      result: 'failed',
      failure: { code: 'REPO_REMOTES_CHANGED' },
    });
    expect(h.git.calls).toEqual([]);
  });

  it('refuses under read-only posture when there is something to do', async () => {
    const h = await harness();
    await expect(new Sync(h.deps).execute({ ...run, posture: locked })).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    expect(h.git.calls).toEqual([]);
  });

  it('still fetches a dirty checkout but leaves it, and reports a refused fast-forward as skipped', async () => {
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
    const out = await new Sync(h.deps).execute(run);
    expect(out.items.map((i) => [i.name, i.action, i.result, i.outcome ?? null])).toEqual([
      ['fx-example-api', 'skip_dirty', 'skipped', null],
      ['fx-example-auth', 'fast_forward', 'skipped', 'diverged'],
      ['fx-example-docs', 'skip_unpicked', 'skipped', null],
    ]);
    expect(h.git.calls).toEqual([
      `remote add ${path.join(ROOT, 'fx-example-api')} origin ssh://git@git.example.com:12345/~alice/fx-example-api.git`,
      `remote add ${path.join(ROOT, 'fx-example-auth')} origin ssh://git@git.example.com:12345/~alice/fx-example-auth.git`,
      `fetch ${path.join(ROOT, 'fx-example-api')} upstream`,
      `fetch ${path.join(ROOT, 'fx-example-auth')} upstream`,
      `fast-forward ${path.join(ROOT, 'fx-example-auth')} upstream/main`,
    ]);
  });

  it('clones without origin and says so when the code host does not know the user', async () => {
    const h = await harness();
    h.codeHost.user = undefined;
    const out = await new Sync(h.deps).execute(run);
    expect(out.items[0]?.result).toBe('done');
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-api'))?.remotes).toEqual({
      upstream: upstream('fx-example-api'),
    });
    expect(h.reporter.codes()).toContain('CODE_HOST_USER_UNKNOWN');
  });

  it('lists unreadable repositories with their contact instead of failing', async () => {
    const h = await harness();
    h.codeHost.readability.set('fx/fx-example-docs', 'forbidden');
    const out = await new Sync(h.deps).execute(run);
    expect(out.items.find((i) => i.name === 'fx-example-docs')).toMatchObject({
      action: 'unreadable',
      result: 'skipped',
      contact: '#platform',
    });
    expect(out.summary.unreadable).toBe(1);
  });

  it.each(['missing', 'forbidden', 'readable'] as const)(
    'ignores legacy cached %s and probes each absent repository once per retry',
    async (cached) => {
      const h = await harness();
      await h.cache.set('readability/fx/fx/fx-example-docs', cached);
      h.codeHost.readability.set('fx/fx-example-docs', 'missing');
      const first = await new Sync(h.deps).execute(run);
      expect(first.items.find((item) => item.name === 'fx-example-docs')?.action).toBe(
        'unreadable',
      );
      h.codeHost.readability.set('fx/fx-example-docs', 'readable');
      const second = await new Sync(h.deps).execute(run);
      expect(second.items.find((item) => item.name === 'fx-example-docs')).toMatchObject({
        action: 'clone',
        result: 'done',
      });
      expect(h.codeHost.probes.filter((repo) => repo === 'fx/fx-example-docs')).toHaveLength(2);
      expect(h.codeHost.probes.filter((repo) => repo === 'fx/fx-example-api')).toHaveLength(1);
      expect(await h.cache.get('readability/fx/fx/fx-example-docs')).toBe(cached);
    },
  );

  it('keeps going after one repository fails and reports the partial result', async () => {
    const h = await harness();
    h.git.clone = async (req) => {
      if (req.dir.endsWith('fx-example-auth'))
        throw new DevkitError('network', 'GIT_OFFLINE', 'remote hung up', {
          nextSteps: ['Retry fx sync.'],
        });
      h.git.calls.push(`clone ${req.dir}`);
    };
    const out = await new Sync(h.deps).execute(run);
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

  it('never runs more than --jobs operations at once', async () => {
    const h = await harness();
    let inFlight = 0;
    let peak = 0;
    const git = new (class extends FakeGit {
      override async clone(req: Parameters<FakeGit['clone']>[0]): Promise<void> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return super.clone(req);
      }
    })();
    await new Sync({ ...h.deps, git }).execute({ ...run, jobs: 2 });
    expect(peak).toBe(2);
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
    const out = await new Sync(h.deps).execute(run);
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
    const again = await new Sync(h.deps).execute(run);
    expect(again.items.some((i) => i.origin_added)).toBe(false);
  });

  it('leaves a checkout without origin alone when nobody knows the user, and says so', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    h.codeHost.user = undefined;
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    const out = await new Sync(h.deps).execute(run);
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
    await expect(new Sync(h.deps).execute({ ...run, posture: locked })).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    expect(h.git.calls).toEqual([]);
  });

  it('still reports the origin it added when a later step fails', async () => {
    const h = await harness({ local: { scope: { repos: ['fx-example-api'] } } });
    h.git.add(path.join(ROOT, 'fx-example-api'), {
      remotes: { upstream: upstream('fx-example-api') },
    });
    h.git.fetch = async () => {
      throw new Error('network down');
    };
    const out = await new Sync(h.deps).execute(run);
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
    const out = await new Sync(h.deps).execute(run);
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
    await new Sync(h.deps).execute(run);
    expect(h.git.checkouts.get(path.join(ROOT, 'fx-example-api'))?.remotes['origin']).toBe(
      'ssh://git@git.example.com:12345/~bob/fx-example-api.git',
    );
    expect(h.reporter.codes()).not.toContain('CODE_HOST_USER_UNKNOWN');
  });
});
