// The declared environments, each marked picked or not. An unset scope means all
// of them, which is a notice rather than a column left to be misread.

import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';
import { scopeMode, type ScopeMode } from '../workspace/scope.js';

import { environmentsOf } from './names.js';

export interface EnvRow {
  readonly name: string;
  readonly label: string | null;
  readonly picked: boolean;
  readonly selection_mode: ScopeMode;
  readonly platforms: readonly string[];
  readonly confidence: string | null;
  readonly note: string | null;
}

export const ENV_COLUMNS = [
  'name',
  'label',
  'picked',
  'selection_mode',
  'platforms',
  'confidence',
  'note',
] as const;

export class EnvList {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(): EnvRow[] {
    const doc = environmentsOf(this.deps.ctx, this.deps.commandShell);
    const picked = this.deps.ctx.local.scope?.envs;
    if (picked === undefined) {
      this.deps.reporter.notice({
        code: 'SCOPE_ENVS_UNSET',
        message:
          'All declared environments are selected, including future additions. Use env select to narrow the scope.',
        nextSteps: [workspaceCommand(this.deps, 'env', 'select', '<env...>')],
      });
    }
    return Object.entries(doc.envs).map(([name, env]) => ({
      name,
      label: env.label ?? null,
      selection_mode: scopeMode(picked),
      picked: picked === undefined || picked.includes(name),
      platforms: Object.keys(env.platforms ?? {}),
      confidence: env.confidence ?? null,
      note: env.note ?? null,
    }));
  }
}
