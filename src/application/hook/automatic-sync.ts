// Automatic work has separate network and projection clocks. Attempts are
// recorded before IO so interrupted workers do not hammer an unavailable
// upstream; dated evidence never asserts current tool readiness.

import { asDevkitError } from '../../domain/errors.js';
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
    const delayed: HookObservation[] = [];
    if (!(await this.update(input, { lastAttempt: now }, delayed))) return;
    const refreshAt = previous?.lastRefresh;
    if (
      refreshAt === null ||
      refreshAt === undefined ||
      now - refreshAt >= MANIFEST_UPDATE_TTL_MS ||
      now < refreshAt
    ) {
      if (!(await this.update(input, { lastRefresh: now }, delayed))) return;
      await this.step(
        input,
        delayed,
        'manifest',
        this.deps.refresh,
        'MANIFEST_REFRESH_FAILED',
        'fx sync',
      );
    }
    await this.step(
      input,
      delayed,
      'docs',
      () => this.deps.docs(lease),
      'DOCS_SYNC_FAILED',
      'fx sync --only docs',
    );
    await this.step(
      input,
      delayed,
      'skills',
      this.deps.skills,
      'SKILL_SYNC_FAILED',
      'fx sync --only skills',
    );
    if (this.deps.self)
      await this.step(input, delayed, 'self', this.deps.self, 'FX_UPDATE_UNAVAILABLE', 'fx doctor');
    await this.step(
      input,
      delayed,
      'checks',
      this.deps.checks,
      'HOOK_CHECKS_INCOMPLETE',
      'fx doctor',
    );
    if (delayed.length) await this.update(input, {}, delayed);
  }

  private async step(
    input: AutomaticSyncInput,
    delayed: HookObservation[],
    phase: string,
    run: () => Promise<readonly HookObservation[]>,
    code: string,
    command: string,
  ): Promise<void> {
    if (!(await this.deps.canWrite())) return;
    let observations: readonly HookObservation[];
    try {
      observations = await run();
    } catch (error) {
      const failure = asDevkitError(error);
      observations = [
        {
          phase,
          code,
          command,
          checkedAt: this.deps.clock.now().getTime(),
          detail: oneLine(`${failure.code}: ${failure.message}`),
        },
      ];
    }
    await this.update(input, {}, delayed, phase, observations);
  }

  private async update(
    input: AutomaticSyncInput,
    patch: Partial<Pick<HookState, 'lastAttempt' | 'lastRefresh'>>,
    delayed: HookObservation[],
    phase?: string,
    observations: readonly HookObservation[] = [],
  ): Promise<boolean> {
    const lease = await this.deps.lock.acquire({ key: `hooks:${input.workspace}`, waitMs: 0 });
    if (!lease) {
      // A hook never waits for the state lease, and a phase whose outcome is
      // dropped would read as unchanged. Keep it as a concurrency note for the
      // next write of this run instead of losing the phase silently.
      delayed.push(...observations.map((observation) => concurrent(observation)));
      return false;
    }
    const pending = [...delayed, ...observations];
    try {
      const current = await this.deps.state.read(input.workspace);
      if (current && !samePath(current.root, input.root)) return false;
      const replaced = new Set(pending.map((observation) => observation.phase));
      await this.deps.state.write(input.workspace, {
        root: input.root,
        receipts: current?.receipts ?? [],
        lastAttempt: current?.lastAttempt ?? null,
        lastRefresh: current?.lastRefresh ?? null,
        ...patch,
        observations: [
          ...(current?.observations ?? []).filter(
            (o) => o.phase !== phase && !replaced.has(o.phase),
          ),
          ...pending,
        ],
      });
      delayed.length = 0;
      return true;
    } finally {
      await lease.release();
    }
  }
}

function concurrent(observation: HookObservation): HookObservation {
  return {
    ...observation,
    code: 'HOOK_STATE_BUSY',
    detail: oneLine(
      observation.detail === undefined
        ? observation.code
        : `${observation.code}: ${observation.detail}`,
    ),
  };
}

// Observations are dated status fields, not a log: the reason is kept as a
// single bounded line so a background failure stays diagnosable without
// storing companion output.
const DETAIL_LIMIT = 200;

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT - 3)}...` : line;
}
