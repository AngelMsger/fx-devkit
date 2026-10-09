// Tool preparation uses the same active requirements as doctor without enrolling unused catalog entries.

import { describe, expect, it } from 'vitest';

import { FamilyServiceProtocol } from '../../../../src/adapters/family/service-protocol.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { syncStages } from '../../../../src/application/sync/stages.js';
import type { StageResult } from '../../../../src/application/sync/types.js';
import { describeProvider } from '../../../../src/composition/registry.js';
const blocked = (result: StageResult) =>
  result.checks.some((check) => check.required && ['blocked', 'unknown'].includes(check.state));
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';
import { harness, MANIFEST_DIR } from '../../../fakes/workspace.js';

interface StageOptions {
  readonly active?: boolean;
  readonly patch?: string;
  readonly unknown?: boolean;
  readonly undeclared?: boolean;
}

// The toolchain follows the binding, so each case picks the provider that produces the
// requirement it is about: none, one fx drives, one fx does not know, or one whose tool no
// document describes.
function providerOf(options: StageOptions): string {
  if (options.unknown) return 'nonesuch';
  if (options.undeclared) return 'unconfigured-host';
  return options.active ? 'bitbucket-cli' : 'local-git';
}

// A provider whose tool no document describes can only come from fx itself, so the case
// supplies the catalog rather than pretending a manifest could produce it.
const UNDECLARED_CATALOG = [
  { id: 'unconfigured-host', capability: 'code-host' as const, tools: ['unconfigured-cli'] },
];

async function stage(options: StageOptions = {}) {
  const h = await harness({
    ...(options.undeclared ? { providers: UNDECLARED_CATALOG } : {}),
    workspace: `schema_version: 2\nproviders: {code-host: {provider: ${providerOf(options)}, vars: {host: /host}}}\ndefaults: {branch: main, upstream_project: team}\nrepos: [{name: api}]\n`,
    files:
      options.patch === undefined
        ? {}
        : {
            [`${MANIFEST_DIR}/manifest/tools.yaml`]: `schema_version: 3\ntools: [{name: bitbucket-cli, ${options.patch}}]\n`,
          },
  });
  const prompter = new FakePrompter();
  const clock = new FakeClock();
  const posture = { readOnly: false, source: 'default' as const };
  const trust = {
    gate: new TrustGate(new FakeTrustStore(), prompter, clock),
    yes: false,
    posture,
    workspace: h.ctx.name,
  };
  const stages = syncStages({
    deps: h.deps,
    process: h.process,
    posture,
    trust,
    dryRun: false,
    login: {
      serviceProtocol: new FamilyServiceProtocol(),
      describeProvider: (id) => describeProvider(id),
      prompter,
      clock,
      home: '/home',
      trust,
    },
    skills: { hosts: [], configured: [], bundledSkillDir: '/skills', globalLock: new FakeLock() },
  });
  return { h, run: stages['tools']! };
}

describe('sync tool preparation', () => {
  it('does not check unused baseline companions for a zero-tool provider', async () => {
    const s = await stage();
    const result = await s.run();
    expect(result).toMatchObject({ summary: { missing: 0, problems: 0 }, details: { items: [] } });
    expect(blocked(result)).toBe(false);
    expect(s.h.process.calls).toEqual([]);
  });

  it.each([
    { active: true },
    { patch: 'install_on_init: true, required: false' },
    { active: true, patch: 'enabled: false' },
    { unknown: true },
    { undeclared: true },
  ])('retains missing declared preparation or provider requirements: %j', async (options) => {
    const s = await stage(options);
    expect(blocked(await s.run())).toBe(true);
  });

  it('keeps optional declared tool observations advisory and visible', async () => {
    const s = await stage({ patch: 'required: false' });
    const result = await s.run();
    expect(result).toMatchObject({
      summary: { missing: 0 },
      details: { items: [{ state: 'missing', preparation_required: false }] },
    });
    expect(blocked(result)).toBe(false);
  });
});
