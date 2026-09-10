// A coding agent as fx sees it: whether it is on this machine, and where it loads Skills
// from.

import type { HookSupport } from '../domain/harness/hooks.js';
import type { McpSupport, RulesSupport } from '../domain/harness/mcp.js';

export type SkillScope = 'global' | 'project';

export interface AgentHost {
  readonly id: string;
  readonly label: string;
  readonly hooks: HookSupport | null;
  readonly mcp: McpSupport;
  readonly rules: RulesSupport | null;
  detect(): Promise<boolean>;
  skillsDir(scope: SkillScope, projectRoot?: string): string;
}
