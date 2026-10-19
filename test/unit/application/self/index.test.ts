import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NpmInstaller } from '../../../../src/adapters/installer/npm.js';
import { selfInfo } from '../../../../src/application/self/info.js';
import { isUpdated, SelfUpdate } from '../../../../src/application/self/update.js';
import { CachedProbe } from '../../../../src/application/update/check.js';
import { FxUpdateCheck } from '../../../../src/application/update/fx.js';
import { FX_UPDATE_TTL_MS } from '../../../../src/application/update/policy.js';
import { FakeCache } from '../../../fakes/fake-cache.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeRegistry } from '../../../fakes/fake-registry.js';

const base = {
  current: '0.1.0',
  packageName: '@fx/devkit',
  registry: 'https://npm.example.com/',
  dryRun: false,
  yes: false,
  posture: { readOnly: false, source: 'default' as const },
};

function updateCheck() {
  const cache = new FakeCache();
  const clock = new FakeClock();
  const registry = new FakeRegistry('0.2.0');
  const check = new FxUpdateCheck(new CachedProbe(cache, clock), () => registry);
  return { cache, clock, registry, check };
}

describe('SelfUpdate', () => {
  it('runs npm against the publish registry with isolated installer output, after asking', async () => {
    const process = new FakeProcess().always({ code: 0, stdout: '', stderr: '' });
    process.binaries.add('npm');
    const prompter = new FakePrompter();
    const out = await new SelfUpdate({
      process,
      prompter,
      installer: new NpmInstaller(process),
      check: updateCheck().check,
    }).execute(base);
    expect(out).toEqual({
      vector: [
        'npm',
        'install',
        '-g',
        '@fx/devkit@latest',
        '--@fx:registry=https://npm.example.com/',
      ],
      ran: true,
      code: 0,
      reason: null,
    });
    expect(process.soleCallTo(['npm']).options.interactive).toBe(false);
    expect(prompter.questions).toHaveLength(1);
  });

  it('returns a handoff instead of invoking a missing installer', async () => {
    const process = new FakeProcess();
    await expect(
      new SelfUpdate({
        process,
        prompter: new FakePrompter(),
        installer: new NpmInstaller(process),
        check: updateCheck().check,
      }).execute({
        ...base,
        yes: true,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_MISSING', handoff: expect.any(Object) });
    expect(process.calls).toEqual([]);
  });

  it('only prints under --dry-run, records a refusal, respects posture, and needs a registry', async () => {
    const process = new FakeProcess();
    process.binaries.add('npm');
    const prompter = new FakePrompter();
    expect(
      (
        await new SelfUpdate({
          process,
          prompter,
          installer: new NpmInstaller(process),
          check: updateCheck().check,
        }).execute({
          ...base,
          dryRun: true,
        })
      ).ran,
    ).toBe(false);
    prompter.confirmWith = false;
    expect(
      await new SelfUpdate({
        process,
        prompter,
        installer: new NpmInstaller(process),
        check: updateCheck().check,
      }).execute(base),
    ).toMatchObject({
      ran: false,
      reason: 'declined',
    });
    expect(process.calls).toEqual([]);
    await expect(
      new SelfUpdate({
        process,
        prompter,
        installer: new NpmInstaller(process),
        check: updateCheck().check,
      }).execute({
        ...base,
        posture: { readOnly: true, source: 'env' },
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    await expect(
      new SelfUpdate({
        process,
        prompter,
        installer: new NpmInstaller(process),
        check: updateCheck().check,
      }).execute({
        ...base,
        registry: null,
      }),
    ).rejects.toMatchObject({ code: 'REGISTRY_UNKNOWN' });
  });

  it('restarts the update-check window after a completed install and leaves it alone after a failed one', async () => {
    const process = new FakeProcess().always({ code: 0, stdout: '', stderr: '' });
    process.binaries.add('npm');
    const s = updateCheck();
    await s.check.execute(base);
    s.clock.advance(FX_UPDATE_TTL_MS - 1000);
    const out = await new SelfUpdate({
      process,
      prompter: new FakePrompter(),
      installer: new NpmInstaller(process),
      check: s.check,
    }).execute({ ...base, yes: true });
    expect(isUpdated(out)).toBe(true);
    s.clock.advance(2000);
    expect(await s.check.execute({ ...base, current: '0.2.0' })).toMatchObject({
      behind: false,
      latest: '0.2.0',
      source: 'cache',
    });
    expect(s.registry.calls).toBe(1);

    const failing = new FakeProcess().always({ code: 17, stdout: '', stderr: 'boom' });
    failing.binaries.add('npm');
    const f = updateCheck();
    const failed = await new SelfUpdate({
      process: failing,
      prompter: new FakePrompter(),
      installer: new NpmInstaller(failing),
      check: f.check,
    }).execute({ ...base, yes: true });
    expect(isUpdated(failed)).toBe(false);
    expect(f.registry.calls).toBe(0);
    expect(f.cache.entries.size).toBe(0);
  });
});

describe('selfInfo', () => {
  it('derives the personal directories from the fx home', () => {
    const info = selfInfo({
      name: '@fx/devkit',
      version: '1.0.0',
      runtime: 'node 22',
      fxHome: path.resolve('/home/me/.fx'),
      configPath: path.resolve('/home/me/.fx/config.yaml'),
      trustPath: path.resolve('/home/me/.fx/trust.yaml'),
      bundledTools: path.resolve('/pkg/defaults/tools.yaml'),
      bundledSkill: path.resolve('/pkg/skills/fx-workspace'),
      registry: null,
      workspace: {
        name: 'fx',
        root: path.resolve('/ws/fx'),
        manifest: path.resolve('/home/me/.fx/workspaces/fx/source'),
      },
    });
    expect(info).toMatchObject({
      cache: path.resolve('/home/me/.fx/cache'),
      workspaces: path.resolve('/home/me/.fx/workspaces'),
      registry: null,
      workspace: {
        name: 'fx',
        root: path.resolve('/ws/fx'),
        manifest: path.resolve('/home/me/.fx/workspaces/fx/source'),
      },
    });
  });
});
