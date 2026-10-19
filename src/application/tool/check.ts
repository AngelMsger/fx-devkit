// Compare installed tools with declared requirements and report readiness.

import { asDevkitError, toEnvelope, type ErrorEnvelope } from '../../domain/errors.js';
import { atLeast } from '../../domain/semver.js';
import { commandOrigin, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { Process } from '../../ports/process.js';
import type { TrustContext } from '../safety/trust.js';

import { selectTools } from './select.js';
import { probeToolVersion } from './version.js';

export type ToolState = 'ok' | 'missing' | 'outdated' | 'disabled' | 'unknown';

// The `fx tool` subcommand that addresses a tool in a state other than ok.
export function toolRecoveryCommand(
  state: Exclude<ToolState, 'ok'>,
): 'show' | 'install' | 'update' {
  if (state === 'missing') return 'install';
  if (state === 'outdated') return 'update';
  return 'show';
}

export interface ToolStatus {
  readonly failure?: ErrorEnvelope['error'];
  readonly name: string;
  readonly required: boolean;
  readonly enabled: boolean;
  readonly state: ToolState;
  readonly installed: string | null;
  readonly min_version: string | null;
  readonly binary: string;
  readonly binary_path?: string | null;
  readonly install: { readonly via: string; readonly spec: string | null } | null;
  readonly docs: string | null;
}

export interface ToolCheckInput {
  readonly continueOnError?: boolean;
  readonly tools: readonly ResolvedTool[];
  readonly names?: readonly string[] | undefined;
  // Present when the toolchain came from a workspace.
  readonly trust?: TrustContext | undefined;
}

export class ToolCheck {
  constructor(private readonly process: Process) {}

  async execute(input: ToolCheckInput): Promise<ToolStatus[]> {
    const selected = selectTools(input.tools, input.names, {
      workspace: input.trust?.workspace,
      commandShell: input.trust?.commandShell,
    });
    const rows: ToolStatus[] = [];
    for (const tool of selected) {
      try {
        rows.push(await this.check(tool, input.trust));
      } catch (error) {
        if (!input.continueOnError) throw error;
        rows.push({
          name: tool.name,
          required: tool.required,
          enabled: tool.enabled,
          state: 'unknown',
          installed: null,
          min_version: tool.minVersion ?? null,
          binary: tool.binary,
          install: null,
          docs: tool.docs ?? null,
          failure: toEnvelope(asDevkitError(error)).error,
        });
      }
    }
    return rows;
  }

  private async check(tool: ResolvedTool, trust: ToolCheckInput['trust']): Promise<ToolStatus> {
    const base = {
      name: tool.name,
      required: tool.required,
      enabled: tool.enabled,
      min_version: tool.minVersion ?? null,
      binary: tool.binary,
      binary_path: (await this.process.which(tool.binary)) ?? null,
      install:
        tool.install[0] === undefined
          ? null
          : { via: tool.install[0].via, spec: tool.install[0].spec ?? null },
      docs: tool.docs ?? null,
    };
    if (!tool.enabled) return { ...base, state: 'disabled', installed: null };
    if (base.binary_path === null) return { ...base, state: 'missing', installed: null };
    if (trust !== undefined) {
      const probe = {
        tool: tool.name,
        workspace: trust.workspace,
        commandShell: trust.commandShell,
        vector: [tool.binary, ...tool.versionArgs],
        label: `${tool.name} version probe`,
        origin: commandOrigin(tool, 'versionArgs'),
        yes: trust.yes,
        posture: trust.posture,
      };
      if (trust.dryRun && !(await trust.gate.isTrusted(probe)))
        return { ...base, state: 'unknown', installed: null };
      await trust.gate.ensure(probe);
    }
    const installed = await probeToolVersion(this.process, tool);
    if (installed === undefined) return { ...base, state: 'unknown', installed: null };
    const outdated = tool.minVersion !== undefined && !atLeast(installed, tool.minVersion);
    return { ...base, state: outdated ? 'outdated' : 'ok', installed };
  }
}
