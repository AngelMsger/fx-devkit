// Explicit manifest opt-ins install missing tools before init synchronizes resources.
// All installation/probe vectors are approved before any package manager runs.
import { DevkitError, toEnvelope, withPartialResult } from '../../domain/errors.js';
import { atLeast } from '../../domain/semver.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { TrustContext } from '../safety/trust.js';
import { recoveryCommand } from '../workspace/guidance.js';

import type { ToolInstall, ToolInstallOutput } from './install.js';

interface InitializeToolsInput {
  readonly commandShell?: ResolvedShell | undefined;
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
      if (plan.vector === null) throw installFailure(plan, 'requires manual installation', input);
    }
    const results = await this.install.execute({
      ...request,
      dryRun: false,
      requireInstallTrust: true,
      operation: 'init',
    });
    for (const result of results) {
      if (!result.ran || result.code !== 0)
        throw partialInstallFailure(result, 'package installation failed', results, input);
      const tool = tools.find((tool) => tool.name === result.name)!;
      if (
        result.version_after === null ||
        (tool.minVersion && !atLeast(result.version_after, tool.minVersion))
      )
        throw partialInstallFailure(
          result,
          'installed version could not satisfy the requirement',
          results,
          input,
        );
    }
    return results;
  }
}

function installFailure(
  result: ToolInstallOutput,
  reason: string,
  input: InitializeToolsInput,
): DevkitError {
  return new DevkitError('config', 'INIT_TOOL_INSTALL_FAILED', `${result.name}: ${reason}`, {
    hint: 'Workspace registration may already exist. Resolve the tool failure, then retry init with the same directory and source.',
    cause: result.error,
    nextSteps: [
      recoveryCommand(
        { workspace: input.trust.workspace, commandShell: input.commandShell },
        'tool',
        'show',
        result.name,
      ),
      recoveryCommand(
        { workspace: input.trust.workspace, commandShell: input.commandShell },
        'tool',
        'install',
        result.name,
        '--dry-run',
      ),
      recoveryCommand(
        { workspace: input.trust.workspace, commandShell: input.commandShell },
        'tool',
        'install',
        result.name,
      ),
    ],
  });
}

function partialInstallFailure(
  result: ToolInstallOutput,
  reason: string,
  results: readonly ToolInstallOutput[],
  input: InitializeToolsInput,
): DevkitError {
  const failure = installFailure(result, reason, input);
  return withPartialResult(failure, {
    tool_install: results.map((item) =>
      item === result ? { ...item, status: 'failed', failure: toEnvelope(failure).error } : item,
    ),
  });
}
