import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SuppliedContributionInput } from '../../../../src/application/contribution/collect-input.js';
import { PushRegisteredSource } from '../../../../src/application/contribution/push-registered.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import type { Binding, ProviderCatalog } from '../../../../src/domain/manifest/providers.js';
import type { ManifestSource } from '../../../../src/ports/manifest-source.js';
import type { WorkspaceEntry } from '../../../../src/ports/stores.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeCodeHost } from '../../../fakes/fake-code-host.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import {
  SETTINGS,
  SOURCE,
  TARGET,
  FakeContributionGit,
  FakeContributionStore,
  FakeContributionTransport,
} from '../../../fakes/fake-contribution.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeGit } from '../../../fakes/fake-git.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';

const ROOT = path.resolve('/workspace');
const MANAGED = path.resolve('/fx-home/workspaces/test/source');
const COMMITTED = readFileSync(
  path.resolve('test/fixtures/manifest/v1-minimal/workspace.yaml'),
  'utf8',
);
const COMMITTED_HOST = 'ssh://git@git.example.com:12345';
const providers: ProviderCatalog = [
  { id: 'committed-host', capability: 'code-host', tools: [], impliedByDefaultHost: true },
];
const supplied: SuppliedContributionInput = {
  paths: ['a.md'],
  issue: 'g-1',
  title: 'Reviewed change',
  cliVersion: '1.0.0',
  dryRun: true,
  yes: true,
  forceNew: false,
  posture: { readOnly: false, source: 'default' },
};
const notOwnCheckout = {
  category: 'config',
  code: 'SOURCE_NOT_GIT',
  message:
    'The registered source must be its own Git checkout, not a directory source or foreign link',
};

interface Scene {
  readonly entry?: WorkspaceEntry;
  readonly kind?: ManifestSource['kind'];
  readonly checkout?: string | null;
  readonly base?: Readonly<Record<string, string>>;
  readonly providerRefusal?: DevkitError;
}

function fixture(scene: Scene = {}) {
  const entry = scene.entry ?? { root: ROOT, source: SETTINGS.upstreamUrls[0]! };
  const fs = new FakeFs();
  const checkouts = new FakeGit();
  if (scene.checkout !== null) checkouts.add(scene.checkout ?? MANAGED, {});
  const git = new FakeContributionGit();
  git.readBase = async () => scene.base ?? { 'manifest/workspace.yaml': COMMITTED };
  const host = new FakeCodeHost();
  host.identities.set('~alice/manifest', {
    ref: SOURCE,
    cloneUrls: SETTINGS.originUrls,
    defaultBranch: 'main',
    personalOwner: 'alice',
    parent: TARGET,
  });
  host.identities.set('TEAM/manifest', {
    ref: TARGET,
    cloneUrls: SETTINGS.upstreamUrls,
    defaultBranch: 'main',
    personalOwner: null,
    parent: null,
  });
  const prompter = new FakePrompter();
  const bound: Binding[] = [];
  const validatedAt: string[] = [];
  const usecase = new PushRegisteredSource({
    resolve: {
      cwd: ROOT,
      name: 'test',
      config: new FakeConfigStore({ workspaces: { test: entry } }),
      fs,
      reporter: new FakeReporter(),
      manifestDirFor: () => MANAGED,
    },
    git: checkouts,
    sourceFor: async () => ({ kind: scene.kind ?? 'repo' }),
    providers,
    codeHost: (binding) => {
      if (scene.providerRefusal) throw scene.providerRefusal;
      bound.push(binding);
      return host;
    },
    validatorAt: (dir) => {
      validatedAt.push(dir);
      return { execute: async () => ({ ok: true, findings: [] }) };
    },
    push: {
      user: undefined,
      prompter,
      git,
      transport: new FakeContributionTransport(),
      records: new FakeContributionStore(),
      ids: { next: () => 'operation-1' },
      clock: new FakeClock(),
      lock: new FakeLock(),
    },
  });
  return { usecase, fs, prompter, bound, validatedAt };
}

describe('pushing the registered source', () => {
  it('previews against the code host the committed manifest binds', async () => {
    const f = fixture();
    expect(await f.usecase.execute(supplied)).toMatchObject({
      workspace: 'test',
      action: 'create',
      source: SOURCE,
      target: TARGET,
      validated: true,
      written: false,
    });
    expect(f.bound).toEqual([
      {
        capability: 'code-host',
        provider: 'committed-host',
        source: 'default',
        vars: { host: COMMITTED_HOST },
      },
    ]);
  });

  it('pushes what a person answered for the inputs the command line left out', async () => {
    const f = fixture();
    f.prompter.answers = ['a.md', 'g-7', 'Asked title'];
    expect(
      await f.usecase.execute({ ...supplied, paths: [], issue: undefined, title: undefined }),
    ).toMatchObject({
      title: 'Asked title',
      message: 'docs: g-7 update selected workspace resources',
    });
  });

  it('asks for missing input before it judges the registration', async () => {
    const f = fixture({ kind: 'file' });
    f.prompter.unavailable = true;
    await expect(f.usecase.execute({ ...supplied, title: undefined })).rejects.toMatchObject({
      code: 'INPUT_REQUIRED',
    });
  });

  it.each<[string, Scene]>([
    ['has no recorded source', { entry: { root: ROOT } }],
    ['was copied from a directory', { kind: 'file' }],
    ['came from stdin', { kind: 'stdin' }],
    ['is not the top of a checkout', { checkout: null }],
  ])('refuses a registration that %s', async (_name, scene) => {
    const f = fixture(scene);
    await expect(f.usecase.execute(supplied)).rejects.toMatchObject(notOwnCheckout);
    expect(f.bound).toEqual([]);
  });

  it('refuses a managed directory that links to another repository', async () => {
    const f = fixture();
    await f.fs.link(path.resolve('/elsewhere/manifest'), MANAGED);
    await expect(f.usecase.execute(supplied)).rejects.toMatchObject(notOwnCheckout);
  });

  it('validates and plans in the physical checkout behind the registered directory', async () => {
    const physical = path.resolve('/volumes/data/source');
    const f = fixture({ checkout: physical });
    f.fs.mkdir(physical);
    await f.fs.link(path.dirname(physical), path.dirname(MANAGED));
    await f.usecase.execute(supplied);
    expect(f.validatedAt).toEqual([physical]);
  });

  it.each<[string, Readonly<Record<string, string>>]>([
    ['is absent', {}],
    ['is not a manifest this fx reads', { 'manifest/workspace.yaml': 'schema_version: 999' }],
  ])('refuses a committed manifest that %s', async (_name, base) => {
    const f = fixture({ base });
    await expect(f.usecase.execute(supplied)).rejects.toMatchObject({
      category: 'config',
      code: 'SOURCE_BASE_MANIFEST_INVALID',
    });
    expect(f.bound).toEqual([]);
  });

  it('reports a provider that cannot be resolved as itself, not as a broken manifest', async () => {
    const providerRefusal = new DevkitError('config', 'PROVIDER_UNBOUND', 'No provider is bound');
    const f = fixture({ providerRefusal });
    await expect(f.usecase.execute(supplied)).rejects.toBe(providerRefusal);
  });
});
