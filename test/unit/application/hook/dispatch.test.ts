import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { acceptBackground, DispatchHook } from '../../../../src/application/hook/dispatch.js';
import { createAgentHosts, hookProtocolFor } from '../../../../src/composition/registry.js';
import type { HookRequest } from '../../../../src/domain/harness/request.js';
import type { LocalLayer } from '../../../../src/domain/manifest/types.js';
import { fingerprint } from '../../../../src/domain/toolchain/trust.js';
import type { ConfigFile } from '../../../../src/ports/stores.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFileProjection } from '../../../fakes/fake-file-projection.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLocalStore } from '../../../fakes/fake-local-store.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakeProcess } from '../../../fakes/fake-process.js';

describe('registered lifecycle behavior', () => {
  it('uses an injected handler without changing host validation or dispatch', async () => {
    const fs = new FakeFs();
    let starts = 0;
    const app = new DispatchHook({
      fs,
      clock: new FakeClock(),
      config: new FakeConfigStore({
        agents: ['codex'],
        workspaces: { test: { root: path.resolve('/workspace') } },
      }),
      hosts: createAgentHosts({ fs, process: new FakeProcess(), home: path.resolve('/home/test') }),
      local: new FakeLocalStore(),
      state: { read: async () => null, write: async () => {} },
      lock: new FakeLock().busy(),
      files: new FakeFileProjection(fs),
      protocol: hookProtocolFor,
      executable: ['fx'],
      home: path.resolve('/home/fx'),
      tasks: {
        start: async () => {
          starts++;
        },
      },
      handlers: {
        'session-start': { shouldSchedule: () => false, describe: () => 'Custom status' },
      },
    });
    const result = await app.execute({
      request: {
        event: 'session-start',
        workspace: 'test',
        root: path.resolve('/workspace'),
        home: path.resolve('/home/fx'),
        agent: 'codex',
        owner: `fx:${fingerprint(['test', path.resolve('/workspace'), 'codex', 'session-start']).slice(0, 24)}`,
      },
      raw: '{"cwd":"/workspace"}',
      env: {},
    });
    expect(JSON.parse(result).hookSpecificOutput.additionalContext).toBe('Custom status');
    expect(starts).toBe(0);
  });
});

const ROOT = path.resolve('/workspace');
const RELATIVE_ROOT = 'relative-workspace';
const registered: ConfigFile = { agents: ['codex'], workspaces: { test: { root: ROOT } } };
const ownerOf = (root: string): string =>
  `fx:${fingerprint(['test', root, 'codex', 'session-start']).slice(0, 24)}`;
const request: HookRequest = {
  event: 'session-start',
  workspace: 'test',
  root: ROOT,
  home: path.resolve('/home/fx'),
  agent: 'codex',
  owner: ownerOf(ROOT),
};

interface BackgroundScene {
  readonly config?: ConfigFile;
  readonly local?: LocalLayer;
  readonly request?: Partial<HookRequest>;
  readonly env?: NodeJS.ProcessEnv;
}

function acceptsBackground(scene: BackgroundScene = {}): Promise<boolean> {
  const fs = new FakeFs();
  return acceptBackground({
    deps: {
      fs,
      config: new FakeConfigStore(scene.config ?? registered),
      hosts: createAgentHosts({ fs, process: new FakeProcess(), home: path.resolve('/home/test') }),
      local: scene.local ? FakeLocalStore.with('test', scene.local) : new FakeLocalStore(),
    },
    request: { ...request, ...scene.request },
    env: scene.env ?? {},
  });
}

describe('background write acceptance', () => {
  it('lets a writable session bound to its registration write', async () => {
    expect(await acceptsBackground()).toBe(true);
  });

  it('judges the session at the workspace root, whatever is registered below it', async () => {
    const nested = { ...registered.workspaces, inner: { root: path.join(ROOT, 'inner') } };
    expect(await acceptsBackground({ config: { ...registered, workspaces: nested } })).toBe(true);
  });

  it.each<[string, BackgroundScene]>([
    ['the environment makes the session read-only', { env: { FX_READ_ONLY: '1' } }],
    ['the configuration is read-only', { config: { ...registered, read_only: true } }],
    ['the workspace is no longer registered', { config: { ...registered, workspaces: {} } }],
    [
      'the registration moved to another root',
      { config: { ...registered, workspaces: { test: { root: path.resolve('/moved') } } } },
    ],
    ['the entry carries another owner', { request: { owner: `fx:${'0'.repeat(24)}` } }],
    [
      'the entry names its registered root relatively',
      {
        config: { ...registered, workspaces: { test: { root: path.resolve(RELATIVE_ROOT) } } },
        request: { root: RELATIVE_ROOT, owner: ownerOf(path.resolve(RELATIVE_ROOT)) },
      },
    ],
    ['the agent is not among the selected ones', { config: { ...registered, agents: [] } }],
    ['hooks are switched off', { config: { ...registered, hooks: false } }],
    ['the workspace opted out of hooks', { local: { hooks: { enabled: false } } }],
  ])('refuses when %s', async (_name, scene) => {
    expect(await acceptsBackground(scene)).toBe(false);
  });
});
