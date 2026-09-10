import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NpmInstaller } from '../../../src/adapters/installer/npm.js';
import { selfInfo } from '../../../src/application/self/info.js';
import { SelfUpdate } from '../../../src/application/self/update.js';
import { FakeProcess } from '../../fakes/fake-process.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';

const base = {
  packageName: '@angelmsger/fx',
  registry: 'https://npm.example.com/',
  dryRun: false,
  yes: false,
  posture: { readOnly: false, source: 'default' as const },
};

describe('SelfUpdate', () => {
  it('runs npm against the publish registry with the terminal attached, after asking', async () => {
    const process = new FakeProcess().always({ code: 0, stdout: '', stderr: '' });
    process.binaries.add('npm');
    const prompter = new FakePrompter();
    const out = await new SelfUpdate(process, prompter, new NpmInstaller(process)).execute(base);
    expect(out).toEqual({
      vector: [
        'npm',
        'install',
        '-g',
        '@angelmsger/fx@latest',
        '--registry',
        'https://npm.example.com/',
        '--@angelmsger:registry=https://npm.example.com/',
      ],
      ran: true,
      code: 0,
      reason: null,
    });
    expect(process.calls[0]?.options.interactive).toBe(true);
    expect(prompter.questions).toHaveLength(1);
  });

  it('returns a handoff instead of invoking a missing installer', async () => {
    const process = new FakeProcess();
    await expect(
      new SelfUpdate(process, new FakePrompter(), new NpmInstaller(process)).execute({
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
        await new SelfUpdate(process, prompter, new NpmInstaller(process)).execute({
          ...base,
          dryRun: true,
        })
      ).ran,
    ).toBe(false);
    prompter.confirmWith = false;
    expect(
      await new SelfUpdate(process, prompter, new NpmInstaller(process)).execute(base),
    ).toMatchObject({
      ran: false,
      reason: 'declined',
    });
    expect(process.calls).toEqual([]);
    await expect(
      new SelfUpdate(process, prompter, new NpmInstaller(process)).execute({
        ...base,
        posture: { readOnly: true, source: 'env' },
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    await expect(
      new SelfUpdate(process, prompter, new NpmInstaller(process)).execute({
        ...base,
        registry: null,
      }),
    ).rejects.toMatchObject({ code: 'REGISTRY_UNKNOWN' });
  });
});

describe('selfInfo', () => {
  it('derives the personal directories from the fx home', () => {
    const info = selfInfo({
      name: '@angelmsger/fx',
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
