// Running one step's check. Every check is read-only, so verification is
// something doctor, login, can and where can all do freely; only a patch-supplied
// command vector has to be trusted first.

import path from 'node:path';

import type { PreparationAction } from '../../domain/preparation.js';
import { matchesJson, statedReason } from '../../domain/setup/json-check.js';
import type { SetupCheck, SetupStep } from '../../domain/setup/types.js';
import { stderrReason } from '../../domain/toolchain/stderr.js';
import type { ProcessResult } from '../../ports/process.js';
import { ServiceOperation } from '../services/operation.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { LoginDeps } from './deps.js';

export interface Verdict {
  readonly actions?: readonly PreparationAction[];
  readonly ok: boolean;
  readonly detail: string;
}

export interface VerifyOptions {
  readonly dryRun?: boolean;
}

// Identity and access checks may contact a remote service or unlock native storage.
// Local binary and public-setting probes retain their separate short deadlines.
const CHECK_TIMEOUT_MS = 30_000;

export class Verifier {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly setup: LoginDeps,
  ) {}

  async verify(step: SetupStep, options: VerifyOptions = {}): Promise<Verdict> {
    if (step.preparation) {
      const result = await new ServiceOperation(this.deps, this.setup).execute(step, true);
      return {
        ok: result.status === 'unchanged',
        detail: result.detail,
        ...(result.actions ? { actions: result.actions } : {}),
      };
    }
    const { verify } = step;
    if ('file' in verify) {
      const target = path.resolve(this.deps.ctx.root, expandHome(verify.file, this.setup.home));
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
      tool: step.tool,
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
      sensitiveOutput: true,
    });
    return commandVerdict(verify, result);
  }
}

function commandVerdict(
  verify: Extract<SetupCheck, { readonly command: readonly string[] }>,
  result: ProcessResult,
): Verdict {
  const unmet =
    verify.json !== undefined && !matchesJson(result.stdout, verify.json)
      ? (statedReason(result.stdout, verify.json) ??
        verify.json.unmet ??
        `expected ${verify.json.path} to be ${String(verify.json.equals)}`)
      : undefined;
  if (result.code === 0)
    return unmet === undefined
      ? { ok: true, detail: `${verify.command.join(' ')} succeeded` }
      : { ok: false, detail: unmet };
  // A tool that fails silently still answered the declared expectation on stdout.
  const silent = result.stderr.trim() === '';
  return {
    ok: false,
    detail: silent && unmet !== undefined ? unmet : stderrReason(result.stderr, result.code),
  };
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
