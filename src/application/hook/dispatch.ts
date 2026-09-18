// Dispatch validates the bound workspace without fallback before scheduling
// anything. Foreground work is local only; previous observations are labelled
// as historical rather than reused as current readiness assertions.

import path from 'node:path';

import type { HookRequest } from '../../domain/harness/request.js';
import { isAtOrInside, samePath } from '../../domain/path.js';
import { fingerprint } from '../../domain/toolchain/trust.js';
import type { Clock } from '../../ports/clock.js';
import type { FileSystem } from '../../ports/fs.js';
import type { HookHandler } from '../../ports/hook-handler.js';
import type { HookTasks } from '../../ports/hook-tasks.js';
import type { ConfigStore } from '../../ports/stores.js';
import { isEnabled } from '../agent/list.js';
import { readSettings } from '../config/settings.js';
import { resolvePosture } from '../safety/posture.js';

import { resolveHookHost } from './host.js';
import type { HookDeps } from './types.js';

export interface DispatchDeps extends HookDeps {
  readonly handlers: Readonly<Record<string, HookHandler>>;
  readonly config: ConfigStore;
  readonly fs: FileSystem;
  readonly clock: Clock;
  readonly tasks: HookTasks;
}

export class DispatchHook {
  constructor(private readonly deps: DispatchDeps) {}

  async execute(input: {
    readonly request: HookRequest;
    readonly raw: string;
    readonly env: NodeJS.ProcessEnv;
  }): Promise<string> {
    const { request, raw, env } = input;
    if (!(await acceptHook({ deps: this.deps, request, raw, env }))) return '';
    const handler = this.deps.handlers[request.event];
    if (!handler) return '';
    const state = await this.deps.state.read(request.workspace);
    const file = await this.deps.config.read();
    const isReadOnly = resolvePosture({ allowWrites: false, env, file }).readOnly;
    const age = this.deps.clock.now().getTime() - (state?.lastAttempt ?? 0);
    if (!isReadOnly && handler.shouldSchedule(age)) await this.deps.tasks.start(request);
    const support = this.deps.hosts.find((h) => h.id === request.agent)!.hooks!;
    const summary = handler.describe(state, isReadOnly).slice(0, 1500);
    return this.deps.protocol(support).context(summary, support, request.event);
  }
}

export async function acceptHook(input: {
  readonly deps: DispatchDeps;
  readonly request: HookRequest;
  readonly raw: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const { deps, request, raw, env } = input;
  const host = resolveHookHost(deps.hosts, request.agent, env);
  if (!host?.hooks) return false;
  const invocation = deps.protocol(host.hooks).decode(raw, host.hooks);
  if (!invocation || !path.isAbsolute(invocation.cwd)) return false;
  const file = await deps.config.read();
  const entry = file.workspaces?.[request.workspace];
  if (!entry) return false;
  const root = await deps.fs.realpath(entry.root);
  const cwd = await deps.fs.realpath(invocation.cwd);
  if (!samePath(root, request.root) || !isAtOrInside(cwd, root)) return false;
  for (const [name, other] of Object.entries(file.workspaces ?? {})) {
    const otherRoot = await deps.fs.realpath(other.root);
    if (
      name !== request.workspace &&
      otherRoot.length > root.length &&
      isAtOrInside(cwd, otherRoot)
    )
      return false;
  }
  if (
    request.owner !==
    `fx:${fingerprint([request.workspace, root, host.id, request.event]).slice(0, 24)}`
  )
    return false;
  const settings = readSettings({ env, file });
  if (!isEnabled(host.id, await host.detect(), settings.agents)) return false;
  if (!settings.hooks) return false;
  return (await deps.local.read(request.workspace)).hooks?.enabled !== false;
}
