// Tool preparation uses the same active requirements as doctor without enrolling unused catalog entries.

import { describe, expect, it } from 'vitest';

import { TrustGate } from '../../../src/application/safety/trust.js';
import { syncStages } from '../../../src/application/sync/stages.js';
import { hasPreparationIssue } from '../../../src/domain/preparation.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeLock } from '../../fakes/fake-lock.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../fakes/fake-trust-store.js';
import { harness, MANIFEST_DIR } from '../../fakes/workspace.js';

async function stage(
  options: { active?: boolean; patch?: string; unknown?: boolean; undeclared?: boolean } = {},
) {
  const h = await harness({
    workspace: `schema_version: 2\nproviders: {code-host: {provider: ${options.active ? 'hosted' : 'local'}, vars: {host: /host}}}\ndefaults: {branch: main, upstream_project: team}\nrepos: [{name: api}]\n`,
    files:
      options.patch === undefined
        ? {}
        : {
            [`${MANIFEST_DIR}/manifest/tools.yaml`]: `schema_version: 2\ntools: [{name: bitbucket-cli, ${options.patch}}]\n`,
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
  let providerTools = options.active ? ['bitbucket-cli'] : [];
  if (options.undeclared) providerTools = ['unconfigured-cli'];
  const stages = syncStages({
    deps: h.deps,
    process: h.process,
    posture,
    trust,
    dryRun: false,
    login: {
      describeProvider: (id) =>
        options.unknown
          ? undefined
          : {
              id,
              capability: 'code-host',
              tools: providerTools,
              recipes: [],
              vars: [],
              create: () => ({}),
            },
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
    expect(hasPreparationIssue(result)).toBe(false);
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
    expect(hasPreparationIssue(await s.run())).toBe(true);
  });

  it('keeps optional declared tool observations advisory and visible', async () => {
    const s = await stage({ patch: 'required: false' });
    const result = await s.run();
    expect(result).toMatchObject({
      summary: { missing: 0 },
      details: { items: [{ state: 'missing', preparation_required: false }] },
    });
    expect(hasPreparationIssue(result)).toBe(false);
  });
});
