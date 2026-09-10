// Automatic work has separate network and projection clocks. Attempts are
// recorded before IO so interrupted workers do not hammer an unavailable
// upstream; dated evidence never asserts current tool readiness.

import type { HookObservation, HookState } from '../../domain/harness/state.js';
import { samePath } from '../../domain/path.js';
import type { Clock } from '../../ports/clock.js';
import type { HookStateStore } from '../../ports/hook-state.js';
import type { Lock, Lease } from '../../ports/lock.js';
import { MANIFEST_UPDATE_TTL_MS } from '../update/policy.js';

export interface AutomaticSyncInput {
  readonly workspace: string;
  readonly root: string;
}
export interface AutomaticSyncDeps {
  readonly clock: Clock;
  readonly state: HookStateStore;
  readonly lock: Lock;
  readonly canWrite: () => Promise<boolean>;
  readonly refresh: () => Promise<readonly HookObservation[]>;
  readonly docs: (lease: Lease) => Promise<readonly HookObservation[]>;
  readonly skills: () => Promise<readonly HookObservation[]>;
  readonly self?: () => Promise<readonly HookObservation[]>;
  readonly checks: () => Promise<readonly HookObservation[]>;
}

export class AutomaticSync {
  constructor(private readonly deps: AutomaticSyncDeps) {}

  async execute(input: AutomaticSyncInput): Promise<void> {
    if (!(await this.deps.canWrite())) return;
    const lease = await this.deps.lock.acquire({ key: `workspace:${input.workspace}`, waitMs: 0 });
    if (!lease) return;
    try {
      await this.run(input, lease);
    } finally {
      await lease.release();
    }
  }

  private async run(input: AutomaticSyncInput, lease: Lease): Promise<void> {
    const now = this.deps.clock.now().getTime();
    const previous = await this.deps.state.read(input.workspace);
    if (
      previous?.lastAttempt !== null &&
      previous?.lastAttempt !== undefined &&
      now - previous.lastAttempt >= 0 &&
      now - previous.lastAttempt < 15000
    )
      return;
    if (!(await this.update(input, { lastAttempt: now }))) return;
    const refreshAt = previous?.lastRefresh;
    if (
      refreshAt === null ||
      refreshAt === undefined ||
      now - refreshAt >= MANIFEST_UPDATE_TTL_MS ||
      now < refreshAt
    ) {
      if (!(await this.update(input, { lastRefresh: now }))) return;
      await this.step(input, 'manifest', this.deps.refresh, 'MANIFEST_REFRESH_FAILED', 'fx sync');
    }
    await this.step(
      input,
      'docs',
      () => this.deps.docs(lease),
      'DOCS_SYNC_FAILED',
      'fx sync --only docs',
    );
    await this.step(
      input,
      'skills',
      this.deps.skills,
      'SKILL_SYNC_FAILED',
      'fx sync --only skills',
    );
    if (this.deps.self)
      await this.step(input, 'self', this.deps.self, 'FX_UPDATE_UNAVAILABLE', 'fx doctor');
    await this.step(input, 'checks', this.deps.checks, 'HOOK_CHECKS_INCOMPLETE', 'fx doctor');
  }

  private async step(
    input: AutomaticSyncInput,
    phase: string,
    run: () => Promise<readonly HookObservation[]>,
    code: string,
    command: string,
  ): Promise<void> {
    if (!(await this.deps.canWrite())) return;
    let observations: readonly HookObservation[];
    try {
      observations = await run();
    } catch {
      observations = [{ phase, code, command, checkedAt: this.deps.clock.now().getTime() }];
    }
    await this.update(input, {}, phase, observations);
  }

  private async update(
    input: AutomaticSyncInput,
    patch: Partial<Pick<HookState, 'lastAttempt' | 'lastRefresh'>>,
    phase?: string,
    observations: readonly HookObservation[] = [],
  ): Promise<boolean> {
    const lease = await this.deps.lock.acquire({ key: `hooks:${input.workspace}`, waitMs: 0 });
    if (!lease) return false;
    try {
      const current = await this.deps.state.read(input.workspace);
      if (current && !samePath(current.root, input.root)) return false;
      await this.deps.state.write(input.workspace, {
        root: input.root,
        receipts: current?.receipts ?? [],
        lastAttempt: current?.lastAttempt ?? null,
        lastRefresh: current?.lastRefresh ?? null,
        ...patch,
        observations: [
          ...(current?.observations ?? []).filter((o) => o.phase !== phase),
          ...observations,
        ],
      });
      return true;
    } finally {
      await lease.release();
    }
  }
}
