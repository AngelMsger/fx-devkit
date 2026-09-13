// Picking and unpicking agents writes config.agents. Under auto mode (no
// list) the first change spells the detected set out first, so "unpick
// codex" means exactly that and not "pick nothing".

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { AgentCleanup, AgentCleanupRow } from '../../ports/agent-cleanup.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { ConfigStore } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { enabledHosts } from './list.js';

export interface AgentPickInput {
  readonly ids: readonly string[];
  readonly action: 'pick' | 'unpick';
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface AgentPickOutput {
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
    for (const id of input.ids) this.assertKnown(id);
    const file = await this.config.read();
    const before = file.agents ?? null;
    const base = before ?? (await enabledHosts(this.hosts, undefined)).map((h) => h.id);
    const after =
      input.action === 'pick'
        ? [...new Set([...base, ...input.ids])]
        : base.filter((id) => !input.ids.includes(id));
    const changed =
      before === null ||
      after.length !== before.length ||
      after.some((id, index) => id !== before[index]);
    const plan: AgentPickOutput = {
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
    let appliedAfter = after;
    if (changed) {
      const saved = await this.config.update((current) => {
        const selected = current.agents ?? base;
        return {
          ...current,
          agents:
            input.action === 'pick'
              ? [...new Set([...selected, ...input.ids])]
              : selected.filter((id) => !input.ids.includes(id)),
        };
      });
      appliedAfter = [...(saved.agents ?? after)];
    }
    const hooks = input.action === 'unpick' ? await this.cleanup?.apply(input.ids) : undefined;
    return {
      ...plan,
      after: appliedAfter,
      written: changed,
      ...(hooks === undefined ? {} : cleanupOutput(hooks)),
    };
  }

  private assertKnown(id: string): void {
    if (this.hosts.some((h) => h.id === id)) return;
    const suggestion = nearest(
      id,
      this.hosts.map((h) => h.id),
    );
    throw new DevkitError('not_found', 'AGENT_UNKNOWN', `"${id}" is not an agent fx knows`, {
      hint:
        suggestion === undefined
          ? 'fx agent list shows the known ids.'
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx agent list'],
    });
  }
}

function cleanupOutput(
  rows: readonly AgentCleanupRow[],
): Pick<AgentPickOutput, 'hooks' | 'harness'> {
  const hooks = rows.filter((row) => row.kind === undefined || row.kind === 'hooks');
  const harness = rows.filter((row) => row.kind !== undefined && row.kind !== 'hooks');
  return { hooks, ...(harness.length ? { harness } : {}) };
}
