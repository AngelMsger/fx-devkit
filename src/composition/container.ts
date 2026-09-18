// The one place that sees every layer: it picks concrete implementations
// for the ports and hands them to command wiring.

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { SystemGit } from '../adapters/git/system-git.js';
import { BrewInstaller } from '../adapters/installer/brew.js';
import { GoInstaller } from '../adapters/installer/go.js';
import { ManualInstaller } from '../adapters/installer/manual.js';
import { NpmInstaller } from '../adapters/installer/npm.js';
import { DiagnosticProcess } from '../adapters/process/diagnostic-process.js';
import { NodeProcess } from '../adapters/process/node-process.js';
import { SystemUrlOpener } from '../adapters/process/url-opener.js';
import { TerminalPrompter } from '../adapters/prompter/terminal.js';
import { NpmHttpRegistry } from '../adapters/registry/npm-http.js';
import type { SkillDeps } from '../application/skill/targets.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { WorkspaceContext } from '../application/workspace-context.js';
import { CAPABILITIES } from '../domain/capability.js';
import { FileCache } from '../infra/cache.js';
import { FileConfigStore } from '../infra/config-store.js';
import { fxHome } from '../infra/home.js';
import { FileLocalLayerStore } from '../infra/local-store.js';
import { FileLock } from '../infra/lock.js';
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
import type { Prompter } from '../ports/prompter.js';
import type { ProviderDescriptor } from '../ports/provider.js';
import type { Registry } from '../ports/registry.js';
import type { Reporter } from '../ports/reporter.js';
import type { Cache, ConfigStore, LocalLayerStore, TrustStore } from '../ports/stores.js';
import type { ToolHistoryStore } from '../ports/tool-history.js';

import { bundledSkillDir, bundledToolsText } from './bundled.js';
import { DiagnosticChannel } from './diagnostics.js';
import { createAgentHosts, describeProvider, providersFor, resolveProvider } from './registry.js';

export interface Container {
  readonly openUrl: (url: string) => Promise<boolean>;
  readonly config: ConfigStore;
  readonly localStore: LocalLayerStore;
  readonly cache: Cache;
  readonly trust: TrustStore;
  readonly toolHistory: ToolHistoryStore;
  readonly lock: Lock;
  readonly fs: FileSystem;
  readonly process: Process;
  readonly git: Git;
  readonly clock: Clock;
  readonly bundledTools: () => string;
  readonly prompter: (noInput: boolean) => Prompter;
  readonly installers: readonly Installer[];
  readonly agents: readonly AgentHost[];
  readonly userHome: string;
  readonly fxHome: string;
  readonly manifestDirFor: (name: string) => string;
  readonly describeProvider: (id: string) => ProviderDescriptor<unknown> | undefined;
  readonly registryAt: (url: string, timeoutMs: number) => Registry;
  readonly diagnostics: DiagnosticChannel;
}

export function createContainer(env: NodeJS.ProcessEnv): Container {
  const home = fxHome(env);
  const clock = new SystemClock();
  const diagnostics = new DiagnosticChannel();
  const process = new DiagnosticProcess(new NodeProcess(), diagnostics);
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
    process,
    git: new SystemGit(process),
    clock,
    bundledTools: bundledToolsText,
    prompter: (noInput) => new TerminalPrompter(noInput),
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
    registryAt: (registry, timeoutMs) =>
      new NpmHttpRegistry({ registry, timeoutMs, env, userHome: os.homedir() }),
    diagnostics,
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

// The bundle every workspace use case receives. The code host is resolved
// lazily from the workspace's own binding, and only once.
export function workspaceDeps(
  container: Container,
  ctx: WorkspaceContext,
  reporter: Reporter,
  cliVersion: string,
  user: string | undefined,
): WorkspaceDeps {
  let codeHost: CodeHost | undefined;
  return {
    ctx,
    user,
    processRun: (vector, options) => container.process.run(vector, options),
    processWhich: (binary) => container.process.which(binary),
    git: container.git,
    fs: container.fs,
    localStore: container.localStore,
    cache: container.cache,
    reporter,
    cliVersion,
    codeHost: () => {
      codeHost ??= resolveProvider<CodeHost>(
        ctx.bindings.find((b) => b.capability === 'code-host') ?? {
          capability: 'code-host',
          provider: null,
          source: 'unbound',
          vars: {},
        },
        { process: container.process, fs: container.fs, clock: container.clock },
      );
      return codeHost;
    },
    platform: (binding) =>
      binding.provider === null
        ? undefined
        : resolveProvider<Platform>(binding, {
            process: container.process,
            fs: container.fs,
            clock: container.clock,
          }),
    reference: (binding) =>
      resolveProvider(binding, {
        process: container.process,
        fs: container.fs,
        clock: container.clock,
      }),
  };
}

// Import can resolve local Git hosts before a workspace exists; remote hosts need verified bindings.
export function codeHostFor(container: Container, host: string): CodeHost | undefined {
  if (!path.isAbsolute(host) || !existsSync(host)) return undefined;
  const provider = 'local-git';
  try {
    return resolveProvider<CodeHost>(
      { capability: 'code-host', provider, source: 'default', vars: { host } },
      { process: container.process, fs: container.fs, clock: container.clock },
    );
  } catch {
    return undefined;
  }
}

export function skillDeps(
  container: Container,
  configured: readonly string[] | undefined,
): SkillDeps {
  return {
    hosts: container.agents,
    configured,
    bundledSkillDir: bundledSkillDir(),
    globalLock: new FileLock(path.join(container.userHome, '.fx')),
  };
}
