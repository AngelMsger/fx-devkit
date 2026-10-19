import { describe, expect, it } from 'vitest';

import { TrustGate } from '../../../../src/application/safety/trust.js';
import { ToolCheck } from '../../../../src/application/tool/check.js';
import { loadTools } from '../../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

const writable = { readOnly: false, source: 'default' } as const;

const patched = loadTools(
  'schema_version: 3\ndefaults: { install: [{ via: npm }] }\ntools:\n  - name: alpha\n',
  'schema_version: 3\ntools: [{ name: alpha, version_args: [--ver] }]',
  { cliVersion: '1.0.0' },
);

describe('ToolCheck under a dry run', () => {
  it('reports an untrusted patched probe as unknown and records nothing', async () => {
    const process = new FakeProcess();
    process.binaries.add('alpha');
    process.always({ code: 0, stdout: 'alpha 2.0.0', stderr: '' });
    const store = new FakeTrustStore();
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const gate = new TrustGate(store, prompter, new FakeClock());
    const tools = resolveTools(patched.doc, patched.provenance);

    const [dry] = await new ToolCheck(process).execute({
      tools,
      trust: { gate, workspace: 'fx', yes: true, dryRun: true, posture: writable },
    });
    expect(dry?.state).toBe('unknown');
    expect(store.entries).toEqual([]);
    expect(process.calls).toEqual([]);

    const [real] = await new ToolCheck(process).execute({
      tools,
      trust: { gate, workspace: 'fx', yes: true, posture: writable },
    });
    expect(real?.state).toBe('ok');
    expect(process.vectors(), 'the patched vector is what ran').toEqual([['alpha', '--ver']]);
    expect(store.entries.map((e) => e.label)).toEqual(['alpha version probe']);

    const [again] = await new ToolCheck(process).execute({
      tools,
      trust: { gate, workspace: 'fx', yes: false, dryRun: true, posture: writable },
    });
    expect(again?.state, 'a trusted probe runs under a dry run too').toBe('ok');
  });

  it.each([
    {
      case: 'a patched binary',
      base: 'schema_version: 3\ndefaults: { install: [{ via: npm }] }\ntools: [{ name: alpha }]',
      patch: 'schema_version: 3\ntools: [{ name: alpha, binary: surprise }]',
      binary: 'surprise',
    },
    {
      case: 'patched version arguments',
      base: 'schema_version: 3\ndefaults: { install: [{ via: npm }] }\ntools: [{ name: alpha }]',
      patch: 'schema_version: 3\ntools: [{ name: alpha, version_args: [--ver] }]',
      binary: 'alpha',
    },
    {
      case: 'a patch-added tool inheriting bundled arguments',
      base: 'schema_version: 3\ndefaults: { install: [{ via: npm }] }\ntools: [{ name: bundled }]',
      patch: 'schema_version: 3\ntools: [{ name: surprise }]',
      binary: 'surprise',
    },
  ])('refuses $case before its version probe runs', async ({ base, patch, binary }) => {
    const loaded = loadTools(base, patch, { cliVersion: '1.0.0' });
    const process = new FakeProcess();
    process.binaries.add(binary);
    process.always({ code: 0, stdout: '1.0.0', stderr: '' });
    const prompter = new FakePrompter();
    prompter.unavailable = true;

    await expect(
      new ToolCheck(process).execute({
        tools: resolveTools(loaded.doc, loaded.provenance),
        trust: {
          gate: new TrustGate(new FakeTrustStore(), prompter, new FakeClock()),
          workspace: 'fx',
          yes: false,
          posture: writable,
        },
      }),
    ).rejects.toMatchObject({ code: 'VECTOR_UNTRUSTED' });
    expect(process.calls).toEqual([]);
  });
});
