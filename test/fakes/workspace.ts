// Builds a WorkspaceContext plus every workspace port as a fake, from a
// manifest text and a personal layer, so use-case tests assert decisions
// instead of wiring.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TrustGate, type TrustContext } from '../../src/application/safety/trust.js';
import { WorkspaceContext } from '../../src/application/workspace/context.js';
import type { WorkspaceDeps } from '../../src/application/workspace/deps.js';
import { providerCatalog } from '../../src/composition/registry.js';
import type { ProviderCatalog } from '../../src/domain/manifest/providers.js';
import type { LocalLayer } from '../../src/domain/manifest/types.js';
import type { Platform } from '../../src/ports/platform.js';
import { bundledTools } from '../bundled-tools.js';

import { FakeActivity } from './fake-activity.js';
import { FakeCodeHost } from './fake-code-host.js';
import { FakeConfigStore } from './fake-config-store.js';
import { FakeFileProjection } from './fake-file-projection.js';
import { FakeFs } from './fake-fs.js';
import { FakeGit } from './fake-git.js';
import { FakeLocalStore } from './fake-local-store.js';
import { FakeProcess } from './fake-process.js';
import { FakePrompter } from './fake-prompter.js';
import { FakeReporter } from './fake-reporter.js';
import { FakeTrustStore } from './fake-trust-store.js';

export const ROOT = path.normalize(path.resolve('/ws/fx'));
export const manifestDirFor = (name: string): string =>
  path.resolve(`/fake/.fx/workspaces/${name}/source`);
export const MANIFEST_DIR = manifestDirFor('fx');

export interface Harness {
  readonly ctx: WorkspaceContext;
  readonly deps: WorkspaceDeps;
  readonly git: FakeGit;
  readonly fs: FakeFs;
  readonly codeHost: FakeCodeHost;
  readonly localStore: FakeLocalStore;
  readonly reporter: FakeReporter;
  readonly activity: FakeActivity;
  readonly process: FakeProcess;
  // What the bundle's trust gate remembers and whom it asks: nothing is trusted and
  // nobody answers until a case says otherwise.
  readonly trusted: FakeTrustStore;
  readonly prompter: FakePrompter;
}

export interface HarnessOptions {
  readonly workspace?: string;
  readonly local?: LocalLayer;
  readonly files?: Record<string, string>;
  readonly codeHost?: FakeCodeHost | null;
  readonly user?: string | undefined;
  readonly platforms?: Record<string, Platform>;
  readonly source?: string;
  // The providers the manifest is read against; the registry unless a case needs otherwise.
  readonly providers?: ProviderCatalog;
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const workspace =
    options.workspace ??
    readFileSync(path.resolve('test/fixtures/manifest/v1-minimal/workspace.yaml'), 'utf8');
  const fs = FakeFs.from({
    [`${MANIFEST_DIR}/manifest/workspace.yaml`]: workspace,
    ...(options.files ?? {}),
  });
  fs.mkdir(ROOT);
  const git = new FakeGit((dir) => fs.mkdir(dir));
  const codeHost = options.codeHost === undefined ? new FakeCodeHost() : options.codeHost;
  const localStore = FakeLocalStore.with('fx', options.local ?? {});
  const reporter = new FakeReporter();
  const activity = new FakeActivity();
  const process = new FakeProcess();
  const trusted = new FakeTrustStore();
  const prompter = new FakePrompter();
  prompter.unavailable = true;
  const ctx = await WorkspaceContext.locate({
    cwd: ROOT,
    config: new FakeConfigStore({
      default_workspace: 'fx',
      workspaces: {
        fx: { root: ROOT, ...(options.source === undefined ? {} : { source: options.source }) },
      },
    }),
    fs,
    git,
    localStore,
    bundledTools,
    providers: options.providers ?? providerCatalog(),
    cliVersion: '1.0.0',
    reporter,
    manifestDirFor,
  });
  const deps: WorkspaceDeps = {
    ctx,
    git,
    fs,
    projections: new FakeFileProjection(fs),
    localStore,
    reporter,
    activity,
    cliVersion: '1.0.0',
    user: options.user,
    process,
    trust: {
      gate: new TrustGate(trusted, prompter),
      workspace: ctx.name,
      yes: false,
      posture: { readOnly: false, source: 'default' },
    },
    codeHost: () => {
      if (codeHost === null) throw new Error('no code host bound');
      return codeHost;
    },
    platform: (binding) =>
      binding.provider === null ? undefined : options.platforms?.[binding.provider],
    reference: () => {
      throw new Error('reference provider not configured in this fake');
    },
  };
  return {
    ctx,
    deps,
    git,
    fs,
    codeHost: codeHost ?? new FakeCodeHost(),
    localStore,
    reporter,
    activity,
    process,
    trusted,
    prompter,
  };
}

// The same bundle answering manifest-supplied commands differently: another gate, --yes,
// posture or a preview.
export function withTrust(deps: WorkspaceDeps, trust: Partial<TrustContext>): WorkspaceDeps {
  return { ...deps, trust: { ...deps.trust, ...trust } };
}

// The same bundle over a context that differs in what its manifest bound. The result is
// still a WorkspaceContext, so its accessors answer as they do on the one it started from.
export function withContext(
  deps: WorkspaceDeps,
  bound: Partial<Pick<WorkspaceContext, 'manifest' | 'bindings' | 'platforms'>>,
): WorkspaceDeps {
  const ctx = Object.create(WorkspaceContext.prototype) as WorkspaceContext;
  return { ...deps, ctx: Object.assign(ctx, deps.ctx, bound) };
}
