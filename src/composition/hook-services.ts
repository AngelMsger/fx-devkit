// Automatic session services reuse the manifest, docs, Skill and verifier use
// cases. Wiring deliberately has no repository sync or platform query service;
// what the phases do with these ports is application policy.

import type { AutomaticSyncDeps } from '../application/hook/automatic-sync.js';
import { backgroundPhases, type BackgroundDeps } from '../application/hook/observe.js';
import { BACKGROUND_POSTURE } from '../application/safety/posture.js';
import { TrustGate } from '../application/safety/trust.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import { WorkspaceContext } from '../application/workspace-context.js';
import type { HookRequest } from '../domain/harness/request.js';
import type { ManifestSource } from '../ports/manifest-source.js';
import type { Reporter } from '../ports/reporter.js';

import { loginDeps, skillDeps, workspaceDeps, type Container } from './container.js';
import { harnessSession } from './harness.js';
import { hookDeps } from './hooks.js';
import { manifestSourceFor } from './manifest-sources.js';
import { configuredRegistry } from './registry-location.js';
import { updateChecks } from './update.js';

interface ServiceInput {
  readonly container: Container;
  readonly request: HookRequest;
  readonly env: NodeJS.ProcessEnv;
  readonly canWrite: () => Promise<boolean>;
}

export function createHookServices(input: ServiceInput): AutomaticSyncDeps {
  const { container } = input;
  return {
    clock: container.clock,
    state: hookDeps(container).state,
    lock: container.lock,
    canWrite: input.canWrite,
    ...backgroundPhases(phaseDeps(input)),
  };
}

function phaseDeps(input: ServiceInput): BackgroundDeps {
  const { container, request, env } = input;
  const reporter: Reporter = { notice: () => {}, progress: () => {} };
  const metadata = container.packageMetadata();
  const login = loginDeps({
    container,
    gate: new TrustGate(container.trust, container.prompter(true), container.clock),
    noInput: true,
    yes: false,
    posture: BACKGROUND_POSTURE,
  });
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
      source: () => manifestSourceOf(container, request.workspace),
      update: updates.manifest,
    },
    self: {
      packageName: metadata.name,
      version: metadata.version,
      registry: configuredRegistry(env, metadata.name),
      update: updates.fx,
    },
  };
}

function workspaceContextFor(
  input: ServiceInput,
  reporter: Reporter,
  cliVersion: string,
): () => Promise<WorkspaceDeps> {
  const { container, request } = input;
  let loaded: WorkspaceDeps | undefined;
  return async () => {
    loaded ??= workspaceDeps(
      container,
      await WorkspaceContext.locate({
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
      undefined,
    );
    return loaded;
  };
}

// A stdin source cannot be rebuilt without the text it was given, and the
// background has no one to ask for it; it reads as a source that cannot refresh.
async function manifestSourceOf(
  container: Container,
  workspace: string,
): Promise<ManifestSource | undefined> {
  const spec = (await container.config.read()).workspaces?.[workspace]?.source;
  return spec === undefined ? undefined : manifestSourceFor(spec, container, async () => '');
}
