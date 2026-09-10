// Whether a platform can be asked at all is judged once per capability and
// environment, not once per repository: thirty repositories share one
// missing tool. A closed gate becomes the same warning on every finding it
// blocks, with the handoff a person needs.

import type { Capability } from '../../domain/capability.js';
import { asDevkitError } from '../../domain/errors.js';
import { unanswered, type Check, type ReleaseFinding } from '../../domain/release/types.js';
import type { LoginDeps } from '../login/deps.js';
import { Readiness, type Verdict } from '../readiness.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export type Gate =
  | { readonly open: true }
  | { readonly open: false; readonly reason: string; readonly verdict?: Verdict };

export class Gates {
  private readonly readiness: Readiness;
  private readonly judged = new Map<string, Promise<Gate>>();

  constructor(deps: WorkspaceDeps, login: LoginDeps) {
    this.readiness = new Readiness(deps, login);
  }

  through(capability: Capability, env: string | undefined): Promise<Gate> {
    const key = `${capability}@${env ?? ''}`;
    let gate = this.judged.get(key);
    if (gate === undefined) {
      gate = this.judge(capability, env);
      this.judged.set(key, gate);
    }
    return gate;
  }

  private async judge(capability: Capability, env: string | undefined): Promise<Gate> {
    try {
      const target = this.readiness.resolve(capability, env);
      const verdict = await this.readiness.judge(target, env ?? null);
      // "unknown" is readiness failing to tell, not the tool failing; the
      // query itself will say what is wrong, with a better reason.
      if (verdict.status === 'ready' || verdict.status === 'unknown') return { open: true };
      return {
        open: false,
        reason: `${target.tool?.name ?? target.binding?.provider ?? capability} is ${verdict.status.replaceAll('_', ' ')}${env === undefined ? '' : ` for ${env}`}`,
        verdict,
      };
    } catch (err) {
      const failure = asDevkitError(err);
      // A verify that overran its deadline is readiness failing to tell, as above.
      if (failure.code === 'PROCESS_TIMEOUT') return { open: true };
      return { open: false, reason: failure.message };
    }
  }
}

export function blocked(check: Check, repo: string, gate: Gate & { open: false }): ReleaseFinding {
  const fix = gate.verdict?.handoff?.command ?? gate.verdict?.alternatives[0];
  return unanswered(check, repo, gate.reason, {
    fix,
    handoff: gate.verdict?.handoff ?? undefined,
  });
}
