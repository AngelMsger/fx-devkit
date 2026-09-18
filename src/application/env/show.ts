// One environment in full: every platform it declares, with the provider bound
// to it, the variables that reach it and whatever the manifest said about how
// well they are known.

import type { WorkspaceDeps } from '../workspace/deps.js';

import { envNotFound, environmentsOf } from './names.js';

export interface EnvPlatformRow {
  readonly platform: string;
  readonly provider: string | null;
  readonly capability: string;
  readonly vars: Readonly<Record<string, string>>;
  readonly confidence: string | null;
  readonly note: string | null;
  readonly setup: Readonly<Record<string, string>> | null;
}

export interface EnvDetail {
  readonly name: string;
  readonly label: string | null;
  readonly picked: boolean;
  readonly confidence: string | null;
  readonly note: string | null;
  readonly platforms: readonly EnvPlatformRow[];
}

export class EnvShow {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(name: string): EnvDetail {
    const doc = environmentsOf(this.deps.ctx, this.deps.commandShell);
    const env = doc.envs[name];
    if (env === undefined) throw envNotFound(this.deps, name, Object.keys(doc.envs));
    const picked = this.deps.ctx.local.scope?.envs;
    return {
      name,
      label: env.label ?? null,
      picked: picked === undefined || picked.includes(name),
      confidence: env.confidence ?? null,
      note: env.note ?? null,
      platforms: Object.entries(env.platforms ?? {}).map(([platform, onEnv]) => {
        const binding = this.deps.ctx.platforms.find((b) => b.platform === platform);
        return {
          platform,
          provider: binding?.provider ?? null,
          capability: binding?.capability ?? 'unknown',
          // The environment's coordinate: its own variables over the platform's.
          vars: { ...doc.platforms[platform]?.vars, ...onEnv.vars },
          confidence: onEnv.confidence ?? null,
          note: onEnv.note ?? doc.platforms[platform]?.note ?? null,
          setup: onEnv.setup ?? null,
        };
      }),
    };
  }
}
