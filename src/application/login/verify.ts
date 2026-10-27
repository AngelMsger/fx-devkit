// Running one step's check. Every check is read-only, so verification is
// something doctor, login, can and where can all do freely; only a patch-supplied
// command vector has to be trusted first.

import path from 'node:path';

import { type DevkitError, toolMissingError } from '../../domain/errors.js';
import type { PreparationAction } from '../../domain/preparation.js';
import { failureCaseOf } from '../../domain/setup/failure-case.js';
import { matchesJson, statedReason } from '../../domain/setup/json-check.js';
import type { CheckCause, FailureCase, SetupCheck, SetupStep } from '../../domain/setup/types.js';
import { stderrReason } from '../../domain/toolchain/stderr.js';
import { messageOf } from '../../domain/values.js';
import type { ProcessResult } from '../../ports/process.js';
import type { WritePosture } from '../safety/posture.js';
import type { TrustContext, TrustInput } from '../safety/trust.js';
import { ServiceOperation } from '../services/operation.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import type { LoginDeps } from './deps.js';

export interface CheckVerdict {
  readonly actions?: readonly PreparationAction[];
  readonly ok: boolean;
  readonly detail: string;
  // What the recipe reads from its own check failing, when a failure case answers.
  readonly cause?: CheckCause;
  readonly recovery?: Pick<FailureCase, 'instructions' | 'open'>;
  // The check did not run, so it says nothing about the step either way.
  readonly withheld?: true;
}

export interface VerifyOptions {
  readonly dryRun?: boolean;
}

// Identity and access checks may contact a remote service or unlock native storage.
// Local binary and public-setting probes retain their separate short deadlines.
export const CHECK_TIMEOUT_MS = 30_000;

export class Verifier {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly setup: LoginDeps,
  ) {}

  async verify(step: SetupStep, options: VerifyOptions = {}): Promise<CheckVerdict> {
    if (step.preparation) {
      const result = await new ServiceOperation(this.deps, this.setup).execute(step, {
        dryRun: true,
      });
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
        return { ok: false, detail: messageOf(err) };
      }
    }
    const { gate } = this.deps.trust;
    const trust = stepTrust(this.deps.trust, step, {
      vector: verify.command,
      label: `${step.id} check`,
    });
    if (options.dryRun && !(await gate.isTrusted(trust)))
      return { ok: false, detail: 'manifest command is not trusted', withheld: true };
    await gate.ensure(trust);
    const vector = expandHomeIn(verify.command, this.setup.home);
    const result = await this.deps.process.run(vector, {
      timeoutMs: CHECK_TIMEOUT_MS,
      deadline: verify.deadline,
      cwd: this.deps.ctx.root,
      env: step.executionEnv,
      diagnostic: { phase: `${step.id} check` },
      sensitiveOutput: true,
    });
    if (result.notStarted) throw this.toolMissing(step.tool, vector[0] ?? step.tool);
    return commandVerdict(verify, result);
  }

  private toolMissing(tool: string, binary: string): DevkitError {
    return toolMissingError(binary, {
      hint: 'The check did not run, so it says nothing about this step.',
      nextSteps: [
        workspaceCommand(this.deps, 'tool', 'show', tool),
        workspaceCommand(this.deps, 'tool', 'install', tool),
      ],
    });
  }
}

// What the trust gate is asked about one of a step's vectors, its check's or its command's.
export function stepTrust(
  trust: TrustContext,
  step: SetupStep,
  asked: Pick<TrustInput, 'vector' | 'label'> & { readonly posture?: WritePosture },
): TrustInput {
  return {
    tool: step.tool,
    workspace: trust.workspace,
    commandShell: trust.commandShell,
    vector: asked.vector,
    label: asked.label,
    origin: step.origin,
    yes: trust.yes,
    posture: asked.posture ?? trust.posture,
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
}

// Init without a workspace reads a tool's sign-in status through the same verdict.
export function commandVerdict(
  verify: Extract<SetupCheck, { readonly command: readonly string[] }>,
  result: ProcessResult,
): CheckVerdict {
  const unmet =
    verify.json !== undefined && !matchesJson(result.stdout, verify.json)
      ? (statedReason(result.stdout, verify.json) ??
        verify.json.unmet ??
        `expected ${verify.json.path} to be ${String(verify.json.equals)}`)
      : undefined;
  if (result.code === 0 && unmet === undefined) return { ok: true, detail: passed(verify) };
  // A tool that fails silently, or answers without failing, still answered the declared
  // expectation on stdout.
  const silent = result.code === 0 || result.stderr.trim() === '';
  const read = failureCaseOf(result, verify.failures);
  return {
    ok: false,
    detail: silent && unmet !== undefined ? unmet : stderrReason(result.stderr, result.code),
    ...(read === undefined
      ? {}
      : {
          cause: read.cause,
          recovery: {
            instructions: read.instructions,
            ...(read.open === undefined ? {} : { open: read.open }),
          },
        }),
  };
}

// What a passing check established; the command itself is in the step's plan.
function passed(verify: Extract<SetupCheck, { readonly command: readonly string[] }>): string {
  return verify.json === undefined
    ? 'the check passed'
    : `${verify.json.path} is ${String(verify.json.equals)}`;
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
