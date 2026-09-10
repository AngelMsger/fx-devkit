// `tool install` / `tool update`: fx assembles the vector from the entry's
// installer, package and registry — a manifest names a package, never a
// command — shows it under --dry-run, and runs it once the posture allows.

import { DevkitError } from '../../domain/errors.js';
import {
  commandOrigin,
  type InstallMethod,
  type ResolvedTool,
} from '../../domain/toolchain/resolve.js';
import type { Installer } from '../../ports/installer.js';
import type { Process } from '../../ports/process.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { TrustContext } from '../safety/trust.js';

import { selectTools } from './select.js';
import { probeToolVersion } from './version.js';

export interface ToolInstallInput {
  readonly tools: readonly ResolvedTool[];
  readonly names?: readonly string[] | undefined;
  readonly all?: boolean | undefined;
  readonly update: boolean;
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
}

interface ToolInstallPlan {
  readonly tool: ResolvedTool;
  readonly output: ToolInstallOutput;
}

export class ToolInstall {
  constructor(
    private readonly installers: readonly Installer[],
    private readonly process: Process,
  ) {}

  async execute(input: ToolInstallInput): Promise<ToolInstallOutput[]> {
    const selected =
      input.all === true ? await this.needing(input.tools) : selectTools(input.tools, input.names);
    const plans: ToolInstallPlan[] = [];
    for (const tool of selected) plans.push(await this.plan(tool, input.update));
    if (input.dryRun) return plans.map((plan) => plan.output);
    if (plans.some((plan) => plan.output.vector !== null)) {
      const action = input.update ? 'update' : 'install';
      assertWritable(
        input.posture,
        `tool ${action} ${selected.map((tool) => tool.name).join(' ')}`,
      );
    }
    if (input.requireInstallTrust) {
      if (!input.trust)
        throw new DevkitError(
          'config',
          'VECTOR_UNTRUSTED',
          'Automatic installation requires workspace command trust.',
        );
      for (const plan of plans) {
        if (plan.output.vector === null) continue;
        for (const vector of [plan.output.vector, [plan.tool.binary, ...plan.tool.versionArgs]])
          await input.trust.gate.ensure({
            ...input.trust,
            vector,
            origin: 'patch',
            label: `${plan.tool.name} initialization`,
          });
      }
    }
    const results: ToolInstallOutput[] = [];
    for (const plan of plans) results.push(await this.apply(plan, input.trust));
    return results;
  }

  private async plan(tool: ResolvedTool, update: boolean): Promise<ToolInstallPlan> {
    const { method, installer } = await this.choose(tool);
    const vector =
      installer.vector(method.spec ?? tool.name, {
        registry: method.registry,
        update,
      }) ?? null;
    return {
      tool,
      output: {
        name: tool.name,
        via: method.via,
        vector,
        docs: tool.docs ?? null,
        ran: false,
        code: null,
        version_after: null,
      },
    };
  }

  private async apply(
    plan: ToolInstallPlan,
    trust: ToolInstallInput['trust'],
  ): Promise<ToolInstallOutput> {
    const { tool, output } = plan;
    const { vector } = output;
    if (vector === null) return output;
    const result = await this.process.run(vector, {
      diagnostic: { phase: `${tool.name} package install` },
    });
    if (result.code !== 0)
      return {
        ...output,
        ran: true,
        code: result.code,
        error: result.stderr.trim() || result.stdout.trim(),
      };
    const probe = await this.probe(tool, trust);
    return {
      ...output,
      ran: true,
      code: 0,
      version_after: probe ?? null,
    };
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
          vector,
          label: `${tool.name} version check`,
          origin: 'patch',
          yes: trust.yes,
          posture: trust.posture,
        });
      }
      return await probeToolVersion(this.process, tool);
    } catch {
      // The install succeeded; an unverifiable version is reported as null.
      return undefined;
    }
  }

  private async choose(
    tool: ResolvedTool,
  ): Promise<{ method: InstallMethod; installer: Installer }> {
    for (const method of tool.install) {
      const installer = this.installers.find((i) => i.id === method.via);
      if (installer !== undefined && (await installer.available())) return { method, installer };
    }
    const wanted = tool.install.map((m) => m.via).filter((v) => v !== 'manual');
    throw new DevkitError(
      'config',
      'INSTALLER_UNAVAILABLE',
      `no package manager on this machine can install ${tool.name}: it needs ${wanted.join(' or ') || 'a manual install'}`,
      {
        hint: `Install ${wanted[0] ?? 'the tool'} first, or install ${tool.name} by hand${tool.docs === undefined ? '' : ` (${tool.docs})`}.`,
        nextSteps: [`fx tool show ${tool.name}`],
      },
    );
  }

  // --all: every enabled tool whose binary is not on PATH. An outdated tool
  // is a `tool update` decision, not an implicit one.
  private async needing(tools: readonly ResolvedTool[]): Promise<ResolvedTool[]> {
    const needing: ResolvedTool[] = [];
    for (const tool of tools) {
      if (!tool.enabled) continue;
      if ((await this.process.which(tool.binary)) === undefined) needing.push(tool);
    }
    return needing;
  }
}
