// Plan trusted package-manager operations and retain installation outcomes.

import {
  asDevkitError,
  DevkitError,
  toEnvelope,
  withPartialResult,
  type ErrorEnvelope,
} from '../../domain/errors.js';
import type { EffectOutcome } from '../../domain/outcome.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { ToolInstallation } from '../../domain/toolchain/installation.js';
import {
  commandOrigin,
  type InstallMethod,
  type ResolvedTool,
} from '../../domain/toolchain/resolve.js';
import type { Installer } from '../../ports/installer.js';
import type { Process } from '../../ports/process.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { TrustContext } from '../safety/trust.js';
import { recoveryCommand } from '../workspace/guidance.js';

import type { ToolAudit } from './audit.js';
import { assertToolSelection, selectTools } from './select.js';
import { probeToolVersion } from './version.js';

export interface ToolInstallInput {
  readonly commandShell?: ResolvedShell | undefined;
  readonly tools: readonly ResolvedTool[];
  readonly names?: readonly string[] | undefined;
  readonly all?: boolean | undefined;
  readonly update: boolean;
  readonly operation?: ToolInstallation['operation'];
  readonly requireInstallTrust?: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  // Present inside a workspace, where the post-install probe may run a
  // patch-supplied vector.
  readonly trust?: TrustContext | undefined;
}

export interface ToolInstallOutput {
  readonly name: string;
  readonly via: string;
  readonly vector: readonly string[] | null;
  readonly docs: string | null;
  readonly ran: boolean;
  readonly code: number | null;
  readonly version_after: string | null;
  readonly error?: string;
  readonly status?: EffectOutcome;
  readonly phase?: 'install' | 'version';
  readonly failure?: ErrorEnvelope['error'];
}

interface ToolInstallPlan {
  readonly tool: ResolvedTool;
  readonly output: ToolInstallOutput;
  readonly method: InstallMethod;
}

export interface ToolInstallDeps {
  readonly installers: readonly Installer[];
  readonly process: Process;
  readonly audit: ToolAudit;
}

export class ToolInstall {
  constructor(private readonly deps: ToolInstallDeps) {}

  async execute(input: ToolInstallInput): Promise<ToolInstallOutput[]> {
    assertToolSelection(input.names, input.all === true);
    const selected =
      input.all === true
        ? await this.selectAll(input)
        : selectTools(input.tools, input.names, {
            workspace: input.trust?.workspace,
            commandShell: input.commandShell,
          });
    const plans: ToolInstallPlan[] = [];
    for (const tool of selected) plans.push(await this.plan(tool, input));
    if (input.dryRun) return plans.map((plan) => plan.output);
    const names = selected.map((tool) => tool.name);
    if (plans.some((plan) => plan.output.vector !== null)) {
      const action = input.update ? 'update' : 'install';
      assertWritable(input.posture, `tool ${action} ${names.join(' ')}`);
    }
    if (input.requireInstallTrust) {
      if (!input.trust)
        throw new DevkitError(
          'config',
          'VECTOR_UNTRUSTED',
          'Automatic installation requires workspace command trust',
          {
            nextSteps: [
              'Re-run the same command in a terminal and review the install vector.',
              recoveryCommand({ commandShell: input.commandShell }, 'tool', 'install', ...names),
            ],
          },
        );
      await input.trust.gate.ensureAll({
        ...input.trust,
        vectors: plans.flatMap((plan) =>
          plan.output.vector === null
            ? []
            : [plan.output.vector, [plan.tool.binary, ...plan.tool.versionArgs]],
        ),
        origin: 'patch',
        label: 'workspace initialization',
      });
    }
    const results: ToolInstallOutput[] = plans.map((plan) => ({
      ...plan.output,
      status: 'not_started',
    }));
    for (const [index, plan] of plans.entries()) {
      try {
        results[index] = await this.apply(plan, input, (result) => {
          results[index] = result;
        });
      } catch (error) {
        const failure = toEnvelope(asDevkitError(error)).error;
        results[index] = { ...results[index]!, status: 'failed', error: failure.message, failure };
        throw withPartialResult(error, { tool_install: results });
      }
    }
    return results;
  }

  private async plan(tool: ResolvedTool, input: ToolInstallInput): Promise<ToolInstallPlan> {
    const { method, installer } = await this.choose(tool, input);
    const vector =
      installer.vector(method.spec ?? tool.name, {
        registry: method.registry,
        update: input.update,
      }) ?? null;
    return {
      tool,
      method,
      output: {
        name: tool.name,
        via: method.via,
        vector,
        docs: tool.docs ?? null,
        ran: false,
        code: null,
        version_after: null,
        status: 'planned',
      },
    };
  }

  private async apply(
    plan: ToolInstallPlan,
    input: ToolInstallInput,
    record: (result: ToolInstallOutput) => void,
  ): Promise<ToolInstallOutput> {
    const { tool, output, method } = plan;
    const { vector } = output;
    if (vector === null || method.via === 'manual') return { ...output, status: 'skipped' };
    const entry = await this.startAudit(plan, input, vector);
    let current: ToolInstallOutput = {
      ...output,
      ran: true,
      status: 'not_started',
      phase: 'install',
    };
    let binaryPath: string | null = null;
    const retain = (result: ToolInstallOutput): void => {
      current = result;
      record(result);
    };
    retain(current);
    try {
      const result = await this.deps.process.run(vector, {
        diagnostic: { phase: `${tool.name} package install` },
      });
      retain({ ...current, code: result.code, status: result.code === 0 ? 'done' : 'failed' });
      if (result.code !== 0) {
        retain({ ...current, error: result.stderr.trim() || result.stdout.trim() });
        return current;
      }
      await this.deps.audit.checkpoint(entry, {
        event: 'installed',
        code: 0,
        version_after: null,
        binary_path: null,
        failure_code: null,
      });
      retain({ ...current, phase: 'version' });
      binaryPath = (await this.deps.process.which(tool.binary)) ?? null;
      const version = await this.probe(tool, input.trust);
      retain({ ...output, ran: true, code: 0, version_after: version ?? null, status: 'done' });
      return current;
    } catch (error) {
      const failure = toEnvelope(asDevkitError(error)).error;
      retain({ ...current, status: 'failed', failure, error: failure.message });
      throw error;
    } finally {
      // Every path closes the ledger entry: an install that threw still happened.
      await this.deps.audit.checkpoint(entry, {
        event: 'finished',
        code: current.code,
        version_after: current.version_after,
        binary_path: binaryPath,
        failure_code: current.failure?.code ?? null,
      });
    }
  }

  private async startAudit(
    { tool, method }: ToolInstallPlan,
    input: ToolInstallInput,
    vector: readonly string[],
  ): Promise<ToolInstallation> {
    if (method.via === 'manual')
      throw new DevkitError('internal', 'INTERNAL', 'Manual installs cannot execute');
    return this.deps.audit.start({
      operation: input.operation ?? (input.update ? 'update' : 'install'),
      workspace: input.trust?.workspace ?? null,
      name: tool.name,
      binary: tool.binary,
      via: method.via,
      spec: method.spec ?? tool.name,
      vector,
      binary_path_before: (await this.deps.process.which(tool.binary)) ?? null,
    });
  }

  private async probe(
    tool: ResolvedTool,
    trust: ToolInstallInput['trust'],
  ): Promise<string | undefined> {
    const vector = [tool.binary, ...tool.versionArgs];
    try {
      if (trust !== undefined && commandOrigin(tool, 'versionArgs') === 'patch') {
        await trust.gate.ensure({
          workspace: trust.workspace,
          commandShell: trust.commandShell,
          vector,
          label: `${tool.name} version check`,
          origin: 'patch',
          yes: trust.yes,
          posture: trust.posture,
        });
      }
      return await probeToolVersion(this.deps.process, tool, { propagateErrors: true });
    } catch (error) {
      // The package is already installed: a version command nobody approved leaves the
      // version unknown, it does not turn the installation into a failure.
      if (
        !(error instanceof DevkitError) ||
        !['VECTOR_UNTRUSTED', 'VECTOR_REJECTED'].includes(error.code)
      )
        throw error;
      return undefined;
    }
  }

  private async choose(
    tool: ResolvedTool,
    input: ToolInstallInput,
  ): Promise<{ method: InstallMethod; installer: Installer }> {
    // Declared order is the team's preference; availability on this machine is the
    // only thing allowed to skip a method.
    for (const method of tool.install) {
      const installer = this.deps.installers.find((i) => i.id === method.via);
      if (installer !== undefined && (await installer.available())) return { method, installer };
    }
    const wanted = tool.install.map((m) => m.via).filter((v) => v !== 'manual');
    throw new DevkitError(
      'config',
      'INSTALLER_UNAVAILABLE',
      `No package manager on this machine can install ${tool.name}: it needs ${wanted.join(' or ') || 'a manual install'}`,
      {
        hint: `Install ${wanted[0] ?? 'the tool'} first, or install ${tool.name} by hand${tool.docs === undefined ? '' : ` (${tool.docs})`}.`,
        nextSteps: [
          recoveryCommand(
            { workspace: input.trust?.workspace, commandShell: input.commandShell },
            'tool',
            'show',
            tool.name,
          ),
        ],
      },
    );
  }

  // --all: install takes every enabled tool whose binary is not on PATH, and update every
  // one whose binary is. An outdated tool is a `tool update` decision, and a missing one a
  // `tool install` decision; neither command makes the other's implicitly.
  private async selectAll(input: ToolInstallInput): Promise<ResolvedTool[]> {
    const selected: ResolvedTool[] = [];
    for (const tool of input.tools) {
      if (!tool.enabled) continue;
      const present = (await this.deps.process.which(tool.binary)) !== undefined;
      if (present === input.update) selected.push(tool);
    }
    return selected;
  }
}
