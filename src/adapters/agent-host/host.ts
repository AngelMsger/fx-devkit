// One AgentHost for any agent in the spec table, so the whole family is this
// class plus data. Presence is a marker under the home directory or the
// agent's own binary on PATH; a project Skill directory is resolved against
// the root it is asked about, never against cwd.

import path from 'node:path';

import type { AgentHost, SkillScope } from '../../ports/agent-host.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Process } from '../../ports/process.js';

import type { AgentHostSpec } from './specs.js';

export interface AgentHostDeps {
  readonly fs: FileSystem;
  readonly process: Pick<Process, 'which'>;
  readonly home: string;
}

export class SpecAgentHost implements AgentHost {
  constructor(
    private readonly spec: AgentHostSpec,
    private readonly deps: AgentHostDeps,
  ) {}

  get id(): string {
    return this.spec.id;
  }

  get label(): string {
    return this.spec.label;
  }

  get hooks(): AgentHost['hooks'] {
    return this.spec.hooks ?? null;
  }

  get mcp(): AgentHost['mcp'] {
    return (
      this.spec.mcp ?? {
        status: 'unverified',
        reason: 'No verified project MCP protocol is registered for this host.',
      }
    );
  }

  get rules(): AgentHost['rules'] {
    return this.spec.rules ?? null;
  }

  async detect(scope: SkillScope = 'global', projectRoot = '.'): Promise<boolean> {
    const base = scope === 'project' ? projectRoot : this.deps.home;
    const markers = scope === 'project' ? this.spec.projectMarkers : this.spec.markers;
    for (const marker of markers) {
      if (await this.deps.fs.exists(path.join(base, marker))) return true;
    }
    if (scope === 'project') return false;
    for (const binary of this.spec.binaries) {
      if ((await this.deps.process.which(binary)) !== undefined) return true;
    }
    return false;
  }

  skillsDir(scope: SkillScope, projectRoot?: string): string {
    return scope === 'global'
      ? path.join(this.deps.home, this.spec.homeSub, 'skills')
      : path.join(projectRoot ?? '.', this.spec.projectSkills);
  }
}
