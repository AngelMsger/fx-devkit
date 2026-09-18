// Builds a WorkspaceContext plus every workspace port as a fake, from a
// manifest text and a personal layer, so use-case tests assert decisions
// instead of wiring.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { WorkspaceDeps } from '../../src/application/workspace/deps.js';
import { WorkspaceContext } from '../../src/application/workspace-context.js';
import type { LocalLayer } from '../../src/domain/manifest/types.js';
import type { Platform } from '../../src/ports/platform.js';

import { FakeCache } from './fake-cache.js';
import { FakeCodeHost } from './fake-code-host.js';
import { FakeConfigStore } from './fake-config-store.js';
import { FakeFs } from './fake-fs.js';
import { FakeGit } from './fake-git.js';
import { FakeLocalStore } from './fake-local-store.js';
import { FakeProcess } from './fake-process.js';
import { FakeReporter } from './fake-reporter.js';

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
  readonly cache: FakeCache;
  readonly reporter: FakeReporter;
  readonly process: FakeProcess;
}

export interface HarnessOptions {
  readonly workspace?: string;
  readonly local?: LocalLayer;
  readonly files?: Record<string, string>;
  readonly codeHost?: FakeCodeHost | null;
  readonly user?: string | undefined;
  readonly platforms?: Record<string, Platform>;
  readonly source?: string;
}

const bundled = (): string => readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');

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
  const cache = new FakeCache();
  const reporter = new FakeReporter();
  const process = new FakeProcess();
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
    bundledTools: bundled,
    cliVersion: '1.0.0',
    reporter,
    manifestDirFor,
  });
  const deps: WorkspaceDeps = {
    ctx,
    git,
    fs,
    localStore,
    cache,
    reporter,
    cliVersion: '1.0.0',
    user: options.user,
    processRun: (vector, opts) => process.run(vector, opts),
    processWhich: (binary) => process.which(binary),
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
    cache,
    reporter,
    process,
  };
}
