// Automatic work has separate network and projection clocks. Attempts are
// recorded before IO so interrupted workers do not hammer an unavailable
// upstream; dated evidence never asserts current tool readiness.

import { asDevkitError } from '../../domain/errors.js';
import { SESSION_BURST_MS } from '../../domain/harness/deadlines.js';
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
  readonly root: () => Promise<readonly HookObservation[]>;
  readonly self?: () => Promise<readonly HookObservation[]>;
  readonly checks: () => Promise<readonly HookObservation[]>;
}

interface Phase {
  readonly name: string;
  readonly run: () => Promise<readonly HookObservation[]>;
  readonly code: string;
  readonly command: string;
}

export class AutomaticSync {
  constructor(private readonly deps: AutomaticSyncDeps) {}

  // Outcomes a contended state lease could not record yet, kept for the next
  // write of this run.
  private delayed: HookObservation[] = [];

  async execute(input: AutomaticSyncInput): Promise<void> {
    if (!(await this.deps.canWrite())) return;
    this.delayed = [];
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
      now - previous.lastAttempt < SESSION_BURST_MS
    )
      return;
    const refreshAt = previous?.lastRefresh;
    const refreshing =
      refreshAt === null ||
      refreshAt === undefined ||
      now - refreshAt >= MANIFEST_UPDATE_TTL_MS ||
      now < refreshAt;
    const phases = this.phases(lease, refreshing);
    // A worker its supervisor kills mid-phase never reaches its own recovery
    // path, so the phases this run committed to are dated before any of them
    // starts. A phase that reported replaces its own row; one still carrying
    // this code was planned and never answered.
    if (!(await this.update(input, { lastAttempt: now }, undefined, phases.map(unreported(now)))))
      return;
    if (refreshing && !(await this.update(input, { lastRefresh: now }))) return;
    for (const phase of phases) await this.step(input, phase);
    if (this.delayed.length) await this.update(input, {});
  }

  private phases(lease: Lease, refreshing: boolean): readonly Phase[] {
    return [
      // Local and read-only, so it answers before any phase that can stall.
      {
        name: 'root',
        run: this.deps.root,
        code: 'ROOT_CHECK_FAILED',
        command: 'fx doctor',
      },
      ...(refreshing
        ? [
            {
              name: 'manifest',
              run: this.deps.refresh,
              code: 'MANIFEST_REFRESH_FAILED',
              command: 'fx sync',
            },
          ]
        : []),
      {
        name: 'docs',
        run: () => this.deps.docs(lease),
        code: 'DOCS_SYNC_FAILED',
        command: 'fx sync --only docs',
      },
      {
        name: 'skills',
        run: this.deps.skills,
        code: 'SKILL_SYNC_FAILED',
        command: 'fx sync --only skills',
      },
      ...(this.deps.self
        ? [
            {
              name: 'self',
              run: this.deps.self,
              code: 'FX_UPDATE_UNAVAILABLE',
              command: 'fx doctor',
            },
          ]
        : []),
      {
        name: 'checks',
        run: this.deps.checks,
        code: 'HOOK_CHECKS_INCOMPLETE',
        command: 'fx doctor',
      },
    ];
  }

  private async step(input: AutomaticSyncInput, phase: Phase): Promise<void> {
    if (!(await this.deps.canWrite())) return;
    let observations: readonly HookObservation[];
    try {
      observations = await phase.run();
    } catch (error) {
      const failure = asDevkitError(error);
      observations = [
        {
          phase: phase.name,
          code: phase.code,
          command: phase.command,
          checkedAt: this.deps.clock.now().getTime(),
          detail: oneLine(`${failure.code}: ${failure.message}`),
        },
      ];
    }
    await this.update(input, {}, phase.name, observations);
  }

  private async update(
    input: AutomaticSyncInput,
    patch: Partial<Pick<HookState, 'lastAttempt' | 'lastRefresh'>>,
    phase?: string,
    observations: readonly HookObservation[] = [],
  ): Promise<boolean> {
    const lease = await this.deps.lock.acquire({ key: `hooks:${input.workspace}`, waitMs: 0 });
    if (!lease) {
      // A hook never waits for the state lease, and a dropped outcome would
      // read as unchanged.
      this.delayed.push(...observations.map((observation) => concurrent(observation)));
      return false;
    }
    const pending = [...this.delayed, ...observations];
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
      this.delayed = [];
      return true;
    } finally {
      await lease.release();
    }
  }
}

function unreported(at: number): (phase: Phase) => HookObservation {
  return (phase) => ({
    phase: phase.name,
    code: 'HOOK_PHASE_UNREPORTED',
    command: phase.command,
    checkedAt: at,
  });
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
