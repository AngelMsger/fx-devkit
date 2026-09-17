// Running one step's check. Every check is read-only, so verification is
// something doctor, login, can and where can all do freely; only a patch-supplied
// command vector has to be trusted first.

import path from 'node:path';

import { matchesJson } from '../../domain/setup/json-check.js';
import type { SetupStep } from '../../domain/setup/types.js';
import { stderrReason } from '../../domain/toolchain/stderr.js';
import { ServiceOperation } from '../services/operation.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { LoginDeps } from './deps.js';

export interface Verdict {
  readonly ok: boolean;
  readonly detail: string;
}

export interface VerifyOptions {
  readonly dryRun?: boolean;
}

const CHECK_TIMEOUT_MS = 5000;

export class Verifier {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly setup: LoginDeps,
  ) {}

  async verify(step: SetupStep, options: VerifyOptions = {}): Promise<Verdict> {
    if (step.preparation) {
      const result = await new ServiceOperation(this.deps, this.setup).execute(step, true);
      return { ok: result.status === 'unchanged', detail: result.detail };
    }
    const { verify } = step;
    if ('file' in verify) {
      const target = expandHome(verify.file, this.setup.home);
      return (await this.deps.fs.exists(target))
        ? { ok: true, detail: `${target} exists` }
        : { ok: false, detail: `${target} is missing` };
    }
    if ('provider' in verify) {
      try {
        const { user } = await this.deps.codeHost().whoami();
        return { ok: true, detail: `authenticated as ${user}` };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    }
    const trust = {
      workspace: this.deps.ctx.name,
      commandShell: this.deps.commandShell,
      vector: verify.command,
      label: `${step.id} check`,
      origin: step.origin,
      yes: this.setup.trust.yes,
      posture: this.setup.trust.posture,
      ...(step.executionEnv
        ? {
            execution: {
              purpose: 'service authentication',
              resource: step.id,
              bindings: step.executionEnv,
            },
          }
        : {}),
    };
    if (options.dryRun && !(await this.setup.trust.gate.isTrusted(trust)))
      return { ok: false, detail: 'manifest command is not trusted' };
    await this.setup.trust.gate.ensure(trust);
    const vector = expandHomeIn(verify.command, this.setup.home);
    const result = await this.deps.processRun(vector, {
      timeoutMs: CHECK_TIMEOUT_MS,
      cwd: this.deps.ctx.root,
      env: step.executionEnv,
      diagnostic: { phase: `${step.id} check` },
    });
    if (result.code === 0 && verify.json !== undefined && !matchesJson(result.stdout, verify.json))
      return { ok: false, detail: `JSON check did not match ${verify.json.path}` };
    return result.code === 0
      ? { ok: true, detail: `${verify.command.join(' ')} succeeded` }
      : { ok: false, detail: stderrReason(result.stderr, result.code) };
  }
}

// Manifest paths say `~` the way a person would; a tool receiving them
// through a vector does not go through a shell, so fx expands it.
export function expandHome(target: string, home: string): string {
  const expand =
    target === '~' || target.startsWith('~/') || (path.sep === '\\' && target.startsWith('~\\'));
  return expand ? path.join(home, target.slice(1)) : target;
}

export function expandHomeIn(vector: readonly string[], home: string): readonly string[] {
  return vector.map((arg) => expandHome(arg, home));
}
