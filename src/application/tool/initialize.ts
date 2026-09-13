// Explicit manifest opt-ins install missing tools before init synchronizes resources.
// All installation/probe vectors are approved before any package manager runs.
import { DevkitError, withPartialResult } from '../../domain/errors.js';
import { atLeast } from '../../domain/semver.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { TrustContext } from '../safety/trust.js';

import type { ToolInstall, ToolInstallOutput } from './install.js';

interface InitializeToolsInput {
  readonly tools: readonly ResolvedTool[];
  readonly posture: WritePosture;
  readonly trust: TrustContext;
}

export class ToolInitialize {
  constructor(private readonly install: ToolInstall) {}

  async execute(input: InitializeToolsInput): Promise<readonly ToolInstallOutput[]> {
    const tools = input.tools.filter((tool) => tool.enabled && tool.installOnInit);
    const request = { ...input, tools, all: true, update: false };
    const plans = await this.install.execute({ ...request, dryRun: true });
    if (plans.length === 0) return [];
    assertWritable(input.posture, 'install workspace initialization tools');
    for (const plan of plans) {
      if (plan.vector === null) throw installFailure(plan, 'requires manual installation');
    }
    const results = await this.install.execute({
      ...request,
      dryRun: false,
      requireInstallTrust: true,
    });
    for (const result of results) {
      if (!result.ran || result.code !== 0)
        throw withPartialResult(installFailure(result, 'package installation failed'), {
          tool_install: results,
        });
      const tool = tools.find((tool) => tool.name === result.name)!;
      if (
        result.version_after === null ||
        (tool.minVersion && !atLeast(result.version_after, tool.minVersion))
      )
        throw withPartialResult(
          installFailure(result, 'installed version could not satisfy the requirement'),
          { tool_install: results },
        );
    }
    return results;
  }
}

function installFailure(result: ToolInstallOutput, reason: string): DevkitError {
  return new DevkitError('config', 'INIT_TOOL_INSTALL_FAILED', `${result.name}: ${reason}`, {
    hint: 'Workspace registration may already exist. Resolve the tool failure, then retry init with the same directory and source.',
    cause: result.error,
    nextSteps: [
      `fx tool show ${result.name}`,
      `fx tool install ${result.name} --dry-run`,
      `fx tool install ${result.name}`,
    ],
  });
}
