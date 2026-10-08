import path from 'node:path';

import type { AgentHost } from '../../src/ports/agent-host.js';

export class FakeAgentHost implements AgentHost {
  readonly hooks: AgentHost['hooks'] = null;
  readonly mcp: AgentHost['mcp'] = {
    status: 'unsupported',
    reason: 'Fixture host has no MCP protocol.',
  };
  readonly rules: AgentHost['rules'] = null;
  constructor(
    readonly id: string,
    private readonly detected: boolean,
    private readonly base = path.resolve('/fake/home'),
  ) {}

  get label(): string {
    return this.id;
  }

  async detect(): Promise<boolean> {
    return this.detected;
  }

  skillsDir(scope: 'global' | 'project', projectRoot?: string): string {
    return scope === 'global'
      ? path.join(this.base, this.id, 'skills')
      : path.join(projectRoot ?? path.resolve('/ws'), `.${this.id}`, 'skills');
  }

  projectPaths(): readonly string[] {
    return [`.${this.id}/skills`];
  }
}
