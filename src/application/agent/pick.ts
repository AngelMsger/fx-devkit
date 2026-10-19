// Picking and unpicking agents writes config.agents. Under auto mode (no
// list) the first change spells the detected set out first, so "unpick
// codex" means exactly that and not "pick nothing".

import type { AgentCleanup, AgentCleanupRow } from '../../ports/agent-cleanup.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { ConfigStore } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { enabledHosts, findHost } from './list.js';

export interface AgentPickInput {
  readonly ids: readonly string[];
  readonly action: 'pick' | 'unpick';
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface AgentPickOutput {
  readonly scope: 'global';
  readonly affected_workspaces: readonly string[];
  readonly hooks?: readonly AgentCleanupRow[];
  readonly harness?: readonly AgentCleanupRow[];
  readonly path: string;
  readonly ids: readonly string[];
  readonly before: readonly string[] | null;
  readonly after: readonly string[];
  readonly changed: boolean;
  readonly written: boolean;
}

export class AgentPick {
  constructor(
    private readonly config: ConfigStore,
    private readonly hosts: readonly AgentHost[],
    private readonly cleanup?: AgentCleanup,
  ) {}

  async execute(input: AgentPickInput): Promise<AgentPickOutput> {
    for (const id of input.ids) findHost(this.hosts, id);
    const file = await this.config.read();
    const before = file.agents ?? null;
    const base = before ?? (await enabledHosts(this.hosts, undefined)).map((h) => h.id);
    const after = applySelection(base, input.ids, input.action);
    const changed = differs(before, after);
    const plan: AgentPickOutput = {
      scope: 'global',
      affected_workspaces: Object.keys(file.workspaces ?? {}).sort(),
      ...(input.action === 'unpick' && this.cleanup
        ? cleanupOutput(await this.cleanup.plan(input.ids))
        : {}),
      path: this.config.path(),
      ids: input.ids,
      before,
      after,
      changed,
      written: false,
    };
    if (input.dryRun || (!changed && !plan.hooks)) return plan;
    assertWritable(input.posture, `agent ${input.action} ${input.ids.join(' ')}`);
    let applied = { before, after, changed };
    if (changed) {
      // Both ends of the report come from the configuration the write itself
      // read, so a concurrent change cannot produce a pair that never existed.
      let observed = before;
      const saved = await this.config.update((current) => {
        observed = current.agents ?? null;
        return {
          ...current,
          agents: applySelection(observed ?? base, input.ids, input.action),
        };
      });
      const appliedAfter = [...(saved.agents ?? after)];
      applied = { before: observed, after: appliedAfter, changed: differs(observed, appliedAfter) };
    }
    const hooks = input.action === 'unpick' ? await this.cleanup?.apply(input.ids) : undefined;
    return {
      ...plan,
      ...applied,
      written: changed,
      ...(hooks === undefined ? {} : cleanupOutput(hooks)),
    };
  }
}

function differs(before: readonly string[] | null, after: readonly string[]): boolean {
  return (
    before === null ||
    after.length !== before.length ||
    after.some((id, index) => id !== before[index])
  );
}

function applySelection(
  base: readonly string[],
  ids: readonly string[],
  action: AgentPickInput['action'],
): string[] {
  return action === 'pick'
    ? [...new Set([...base, ...ids])]
    : base.filter((id) => !ids.includes(id));
}

function cleanupOutput(
  rows: readonly AgentCleanupRow[],
): Pick<AgentPickOutput, 'hooks' | 'harness'> {
  const hooks = rows.filter((row) => row.kind === undefined || row.kind === 'hooks');
  const harness = rows.filter((row) => row.kind !== undefined && row.kind !== 'hooks');
  return { hooks, ...(harness.length ? { harness } : {}) };
}
