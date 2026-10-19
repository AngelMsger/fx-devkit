// The one place that sees every layer: it picks concrete implementations
// for the ports and hands them to command wiring.

import os from 'node:os';
import path from 'node:path';

import { SystemClock } from '../adapters/clock/system-clock.js';
import { FamilyServiceProtocol } from '../adapters/family/service-protocol.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { SystemGit } from '../adapters/git/system-git.js';
import { BrewInstaller } from '../adapters/installer/brew.js';
import { GoInstaller } from '../adapters/installer/go.js';
import { ManualInstaller } from '../adapters/installer/manual.js';
import { NpmInstaller } from '../adapters/installer/npm.js';
import { DiagnosticProcess } from '../adapters/process/diagnostic-process.js';
import { NodeProcess } from '../adapters/process/node-process.js';
import { SystemUrlOpener } from '../adapters/process/url-opener.js';
import { WatchedProcess } from '../adapters/process/watched-process.js';
import { TerminalPrompter } from '../adapters/prompter/terminal.js';
import { NpmRegistryLocator } from '../adapters/registry/npm-config.js';
import { NpmRegistry } from '../adapters/registry/npm-registry.js';
import type { LoginDeps } from '../application/login/deps.js';
import type { WritePosture } from '../application/safety/posture.js';
import type { TrustGate } from '../application/safety/trust.js';
import type { SkillDeps } from '../application/skill/targets.js';
import type { WorkspaceContext } from '../application/workspace/context.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import { CAPABILITIES } from '../domain/capability.js';
import { codeHostBinding, type ProviderCatalog } from '../domain/manifest/providers.js';
import type { ResolvedShell } from '../domain/shell.js';
import { FileCache } from '../infra/cache.js';
import { FileConfigStore } from '../infra/config-store.js';
import { fxHome } from '../infra/home.js';
import { FileLocalLayerStore } from '../infra/local-store.js';
import { FileLock } from '../infra/lock.js';
import { FileProjectionStore } from '../infra/projection-store.js';
import { FileToolHistoryStore } from '../infra/tool-history.js';
import { FileTrustStore } from '../infra/trust-store.js';
import { manifestSourceDir } from '../infra/workspace-home.js';
import type { AgentHost } from '../ports/agent-host.js';
import type { Clock } from '../ports/clock.js';
import type { CodeHost } from '../ports/code-host.js';
import type { FileSystem } from '../ports/fs.js';
import type { Git } from '../ports/git.js';
import type { Installer } from '../ports/installer.js';
import type { Lock } from '../ports/lock.js';
import type { Platform } from '../ports/platform.js';
import type { Process } from '../ports/process.js';
import type { ProjectionStore } from '../ports/projection.js';
import type { Prompter } from '../ports/prompter.js';
import type { AdapterDeps, ProviderDescriptor } from '../ports/provider.js';
import type { Registry, RegistryLocator } from '../ports/registry.js';
import type { Reporter } from '../ports/reporter.js';
import type { Cache, ConfigStore, LocalLayerStore, TrustStore } from '../ports/stores.js';
import type { ToolHistoryStore } from '../ports/tool-history.js';

import { ActivityChannel } from './activity.js';
import {
  bundledPackage,
  bundledSkillDir,
  bundledToolsText,
  type PackageMetadata,
} from './bundled.js';
import { DiagnosticChannel } from './diagnostics.js';
import {
  createAgentHosts,
  describeProvider,
  providerCatalog,
  providersFor,
  resolveProvider,
} from './registry.js';

export interface Container {
  readonly openUrl: (url: string) => Promise<boolean>;
  readonly config: ConfigStore;
  readonly localStore: LocalLayerStore;
  readonly cache: Cache;
  readonly trust: TrustStore;
  readonly toolHistory: ToolHistoryStore;
  readonly lock: Lock;
  readonly fs: FileSystem;
  readonly projections: ProjectionStore;
  readonly process: Process;
  readonly git: Git;
  readonly clock: Clock;
  readonly bundledTools: () => string;
  readonly packageMetadata: () => PackageMetadata;
  readonly prompter: (noInput: boolean) => Prompter;
  readonly installers: readonly Installer[];
  readonly agents: readonly AgentHost[];
  readonly userHome: string;
  readonly fxHome: string;
  readonly manifestDirFor: (name: string) => string;
  readonly describeProvider: (id: string) => ProviderDescriptor<unknown> | undefined;
  readonly providers: ProviderCatalog;
  readonly registryLocator: RegistryLocator;
  readonly registryAt: (url: string, timeoutMs: number) => Registry;
  readonly diagnostics: DiagnosticChannel;
  readonly activity: ActivityChannel;
}

export interface ContainerOptions {
  // Wraps the one subprocess port before anything is built on it, so every member
  // that starts a process obeys the wrapper.
  readonly decorateProcess?: (process: Process) => Process;
}

export function createContainer(env: NodeJS.ProcessEnv, options: ContainerOptions = {}): Container {
  const home = fxHome(env);
  const clock = new SystemClock();
  const diagnostics = new DiagnosticChannel();
  const activity = new ActivityChannel();
  const watched = new WatchedProcess(
    new DiagnosticProcess(new NodeProcess(), diagnostics),
    activity,
  );
  const process = options.decorateProcess?.(watched) ?? watched;
  const lock = new FileLock(home);
  const fs = new NodeFs(lock);
  return {
    openUrl: (url) => new SystemUrlOpener(process).open(url),
    config: new FileConfigStore(home),
    localStore: new FileLocalLayerStore(home),
    cache: new FileCache(home, clock),
    trust: new FileTrustStore(home, clock, lock),
    toolHistory: new FileToolHistoryStore(home, lock),
    lock,
    fs,
    projections: new FileProjectionStore(lock),
    process,
    git: new SystemGit(process),
    clock,
    bundledTools: bundledToolsText,
    packageMetadata: bundledPackage,
    prompter: (noInput) => new TerminalPrompter(noInput, activity),
    installers: [
      new NpmInstaller(process),
      new BrewInstaller(process),
      new GoInstaller(process),
      new ManualInstaller(),
    ],
    agents: createAgentHosts({ fs, process, home: os.homedir() }),
    userHome: os.homedir(),
    fxHome: home,
    manifestDirFor: (name) => manifestSourceDir(home, name),
    describeProvider,
    providers: providerCatalog(),
    registryLocator: new NpmRegistryLocator(process, env, os.homedir()),
    registryAt: (registry, timeoutMs) =>
      new NpmRegistry(process, { registry, timeoutMs, env, userHome: os.homedir() }),
    diagnostics,
    activity,
  };
}

export function toolDependants(): Record<string, string[]> {
  const byTool: Record<string, string[]> = {};
  for (const capability of CAPABILITIES) {
    for (const provider of providersFor(capability)) {
      for (const tool of provider.tools) byTool[tool] = [...(byTool[tool] ?? []), provider.id];
    }
  }
  return byTool;
}

// Keeps the outcome of the first attempt, a refusal included: a binding cannot
// change inside one process, so a provider that will not build must not be
// rebuilt, and re-reported, at every caller.
function once<T>(build: () => T): () => T {
  let settled: { readonly value: T } | { readonly error: unknown } | undefined;
  return () => {
    settled ??= attempt(build);
    if ('error' in settled) throw settled.error;
    return settled.value;
  };
}

function attempt<T>(build: () => T): { readonly value: T } | { readonly error: unknown } {
  try {
    return { value: build() };
  } catch (error) {
    return { error };
  }
}

// The effects every provider is given, whatever resolves it.
function adaptersOf(container: Container): AdapterDeps {
  return { process: container.process, fs: container.fs, clock: container.clock };
}

// The bundle every workspace use case receives. The code host is resolved
// lazily from the workspace's own binding, and only once.
interface WorkspaceInvocation {
  readonly ctx: WorkspaceContext;
  readonly reporter: Reporter;
  readonly cliVersion: string;
  readonly user: string | undefined;
  readonly commandShell: ResolvedShell | undefined;
}

export function workspaceDeps(container: Container, input: WorkspaceInvocation): WorkspaceDeps {
  const { commandShell, ...invocation } = input;
  const { ctx } = invocation;
  const adapters = adaptersOf(container);
  return {
    ...invocation,
    ...(commandShell === undefined ? {} : { commandShell }),
    processRun: (vector, options) => container.process.run(vector, options),
    processWhich: (binary) => container.process.which(binary),
    git: container.git,
    fs: container.fs,
    projections: container.projections,
    localStore: container.localStore,
    cache: container.cache,
    activity: container.activity,
    codeHost: once(() => resolveProvider<CodeHost>(codeHostBinding(ctx.bindings), adapters)),
    platform: (binding) =>
      binding.provider === null ? undefined : resolveProvider<Platform>(binding, adapters),
    reference: (binding) => resolveProvider(binding, adapters),
  };
}

// Import can resolve local Git hosts before a workspace exists; remote hosts need verified
// bindings. Only a host that is not an existing absolute path is "no code host"; a provider
// that refuses to resolve is a configuration failure the caller must see.
export async function codeHostFor(
  container: Container,
  host: string,
): Promise<CodeHost | undefined> {
  if (!path.isAbsolute(host) || !(await container.fs.exists(host))) return undefined;
  return resolveProvider<CodeHost>(
    { capability: 'code-host', provider: 'local-git', source: 'default', vars: { host } },
    adaptersOf(container),
  );
}

export interface LoginDepsInput {
  readonly container: Container;
  // The caller owns the gate: a second one would ask the same question again.
  readonly gate: TrustGate;
  readonly noInput: boolean;
  readonly yes: boolean;
  readonly posture: WritePosture;
}

// The bundle every login-aware use case receives, whether a person or a
// background hook started it.
export function loginDeps(input: LoginDepsInput): LoginDeps {
  return {
    serviceProtocol: new FamilyServiceProtocol(),
    describeProvider: input.container.describeProvider,
    prompter: input.container.prompter(input.noInput),
    clock: input.container.clock,
    home: input.container.userHome,
    trust: { gate: input.gate, yes: input.yes, posture: input.posture },
  };
}

export function skillDeps(
  container: Container,
  configured: readonly string[] | undefined,
): SkillDeps {
  return {
    hosts: container.agents,
    configured,
    bundledSkillDir: bundledSkillDir(),
    globalLock: container.lock,
  };
}
