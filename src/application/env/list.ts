// The declared environments, each marked picked or not. An unset scope means all
// of them, which is a notice rather than a column left to be misread.

import type { WorkspaceDeps } from '../workspace/deps.js';

import { environmentsOf } from './names.js';

export interface EnvRow {
  readonly name: string;
  readonly label: string | null;
  readonly picked: boolean;
  readonly platforms: readonly string[];
  readonly confidence: string | null;
  readonly note: string | null;
}

export class EnvList {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(): EnvRow[] {
    const doc = environmentsOf(this.deps.ctx);
    const picked = this.deps.ctx.local.scope?.envs;
    if (picked === undefined) {
      this.deps.reporter.notice({
        code: 'SCOPE_ENVS_UNSET',
        message: 'no environments picked; login and doctor expand all of them',
        nextSteps: ['fx env pick <env...>'],
      });
    }
    return Object.entries(doc.envs).map(([name, env]) => ({
      name,
      label: env.label ?? null,
      picked: picked === undefined || picked.includes(name),
      platforms: Object.keys(env.platforms ?? {}),
      confidence: env.confidence ?? null,
      note: env.note ?? null,
    }));
  }
}
