// Which agents fx projects Skills into: the detected ones, unless
// config.agents names a list — then that list, with a note on any entry
// the machine does not actually have.

import type { AgentHost } from '../../ports/agent-host.js';

export interface AgentRow {
  readonly id: string;
  readonly label: string;
  readonly detected: boolean;
  readonly enabled: boolean;
  readonly skills_dir: string;
  readonly note: string | null;
}

export interface AgentListInput {
  readonly configured: readonly string[] | undefined;
}

export class AgentList {
  constructor(private readonly hosts: readonly AgentHost[]) {}

  async execute(input: AgentListInput): Promise<AgentRow[]> {
    const rows: AgentRow[] = [];
    for (const host of this.hosts) {
      const detected = await host.detect();
      const enabled = isEnabled(host.id, detected, input.configured);
      rows.push({
        id: host.id,
        label: host.label,
        detected,
        enabled,
        skills_dir: host.skillsDir('global'),
        note: enabled && !detected ? 'enabled in config but not detected on this machine' : null,
      });
    }
    return rows;
  }
}

export function isEnabled(
  id: string,
  detected: boolean,
  configured: readonly string[] | undefined,
): boolean {
  return configured === undefined ? detected : configured.includes(id);
}

export async function enabledHosts(
  hosts: readonly AgentHost[],
  configured: readonly string[] | undefined,
): Promise<AgentHost[]> {
  const enabled: AgentHost[] = [];
  for (const host of hosts) {
    if (isEnabled(host.id, await host.detect(), configured)) enabled.push(host);
  }
  return enabled;
}
