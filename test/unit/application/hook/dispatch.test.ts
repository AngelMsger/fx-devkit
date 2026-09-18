import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DispatchHook } from '../../../../src/application/hook/dispatch.js';
import { createAgentHosts, hookProtocolFor } from '../../../../src/composition/registry.js';
import { fingerprint } from '../../../../src/domain/toolchain/trust.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLocalStore } from '../../../fakes/fake-local-store.js';
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
      lock: { acquire: async () => null },
      files: { read: async () => ({ kind: 'absent', text: null }), write: async () => 'unchanged' },
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
