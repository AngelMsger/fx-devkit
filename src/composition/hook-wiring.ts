// Automatic session work reuses the manifest, docs, Skill and verifier use
// cases. Wiring deliberately has no repository sync or platform query service;
// what the phases do with these ports is application policy.

import type { AutomaticSyncDeps } from '../application/hook/automatic-sync.js';
import { backgroundPhases, type BackgroundDeps } from '../application/hook/observe.js';
import { BACKGROUND_POSTURE } from '../application/safety/posture.js';
import { WorkspaceContext } from '../application/workspace/context.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { HookRequest } from '../domain/harness/request.js';
import type { Reporter } from '../ports/reporter.js';

import { loginDeps, skillDeps, workspaceDeps, type Container } from './container.js';
import { harnessSession } from './harness.js';
import { hookStateStore } from './hooks.js';
import { manifestSourceFor } from './manifest-sources.js';
import { updateChecks } from './update.js';

interface HookWiringInput {
  readonly container: Container;
  readonly request: HookRequest;
  readonly env: NodeJS.ProcessEnv;
  readonly canWrite: () => Promise<boolean>;
}

export function automaticSyncWiring(input: HookWiringInput): AutomaticSyncDeps {
  const { container } = input;
  return {
    clock: container.clock,
    state: hookStateStore(container),
    lock: container.lock,
    canWrite: input.canWrite,
    ...backgroundPhases(phaseDeps(input)),
  };
}

function phaseDeps(input: HookWiringInput): BackgroundDeps {
  const { container, request, env } = input;
  const reporter: Reporter = { notice: () => {}, progress: () => {} };
  const metadata = container.packageMetadata();
  const login = loginDeps({ container, noInput: true });
  const updates = updateChecks(container);
  return {
    clock: container.clock,
    config: container.config,
    env,
    workspace: request.workspace,
    root: request.root,
    reporter,
    login,
    context: workspaceContextFor(input, reporter, metadata.version),
    harness: harnessSession({
      container,
      resolve: {
        cwd: request.root,
        name: request.workspace,
        config: container.config,
        fs: container.fs,
        reporter,
        manifestDirFor: container.manifestDirFor,
      },
      env,
      cliVersion: metadata.version,
      noInput: true,
      yes: false,
      posture: BACKGROUND_POSTURE,
    }),
    skills: (agents) => skillDeps(container, agents),
    manifest: {
      dir: container.manifestDirFor(request.workspace),
      // A stdin source cannot be rebuilt without the text it was given, and the
      // background has no one to ask for it; it reads as a source that cannot refresh.
      sourceFor: (spec) => manifestSourceFor(spec, container, async () => ''),
      update: updates.manifest,
    },
    self: {
      packageName: metadata.name,
      version: metadata.version,
      registry: async () => (await container.registryLocator.resolve(metadata.name)).registry,
      update: updates.fx,
    },
  };
}

function workspaceContextFor(
  input: HookWiringInput,
  reporter: Reporter,
  cliVersion: string,
): () => Promise<WorkspaceDeps> {
  const { container, request } = input;
  let loaded: WorkspaceDeps | undefined;
  return async () => {
    loaded ??= workspaceDeps(container, {
      ctx: await WorkspaceContext.locate({
        cwd: request.root,
        name: request.workspace,
        config: container.config,
        fs: container.fs,
        git: container.git,
        localStore: container.localStore,
        reporter,
        bundledTools: container.bundledTools,
        providers: container.providers,
        cliVersion,
        manifestDirFor: container.manifestDirFor,
      }),
      reporter,
      cliVersion,
      user: undefined,
      commandShell: undefined,
      noInput: true,
      yes: false,
      posture: BACKGROUND_POSTURE,
    });
    return loaded;
  };
}
