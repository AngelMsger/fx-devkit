import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadHarnessCommand,
  type HarnessSession,
} from '../../../../src/application/harness/session.js';
import { harnessDoctor } from '../../../../src/application/harness/stages.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { createAgentHosts, mcpCodecFor } from '../../../../src/composition/registry.js';
import { MANIFEST_FILES } from '../../../../src/domain/manifest/files.js';
import { report } from '../../../../src/domain/report.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFileProjection } from '../../../fakes/fake-file-projection.js';
import { FakeHarnessState } from '../../../fakes/fake-harness.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';
import { harness, MANIFEST_DIR, ROOT, manifestDirFor } from '../../../fakes/workspace.js';

async function fixture() {
  const h = await harness();
  const files = new FakeFileProjection(h.fs);
  const config = new FakeConfigStore({
    agents: ['claude-code'],
    workspaces: { fx: { root: ROOT } },
  });
  const input: HarnessSession = {
    deps: {
      files,
      hosts: createAgentHosts({ fs: h.fs, process: h.process, home: path.resolve('/home') }),
      state: new FakeHarnessState(),
      trust: new TrustGate(new FakeTrustStore(), new FakePrompter()),
      env: {},
      codec: mcpCodecFor,
      lock: new FakeLock(),
    },
    config,
    process: h.process,
    resolve: { cwd: ROOT, config, fs: h.fs, reporter: h.reporter, manifestDirFor },
    env: { FX_AGENTS: 'codex' },
    cliVersion: '1.0.0',
    yes: false,
    posture: { readOnly: false, source: 'default' },
  };
  return { input, files, fs: h.fs };
}

describe('harness workspace workflow', () => {
  it('selects hosts from the resolved settings and tolerates an absent optional source', async () => {
    const f = await fixture();
    const loaded = await loadHarnessCommand(f.input);
    expect(loaded.input.selected).toEqual(['codex']);
    expect(loaded.input.harness).toBeUndefined();
    expect(f.files.writes).toBe(0);
  });

  it('reports incomplete inspection and propagates repair failure for a foreign source', async () => {
    const f = await fixture();
    f.fs.mkdir(path.join(MANIFEST_DIR, MANIFEST_FILES.harness));
    const extension = harnessDoctor(f.input, 'mcp');
    const result = report(['mcp'], await extension.check());
    expect(result).toMatchObject({ ok: true, complete: false });
    expect(result.findings[0]?.coverage).toBe('incomplete');
    await expect(extension.fix!({ dryRun: false, posture: f.input.posture })).rejects.toMatchObject(
      { code: 'HARNESS_SOURCE_FOREIGN' },
    );
    expect(f.files.writes).toBe(0);
  });
});
