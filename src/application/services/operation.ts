// Prepare public settings through native tools or an owned public workspace file.
// Checks never read credential stores or perform personal authentication.
import path from 'node:path';

import { asDevkitError, DevkitError, toEnvelope } from '../../domain/errors.js';
import { atLeast } from '../../domain/semver.js';
import { matchesPublicDefaults } from '../../domain/setup/public-defaults.js';
import type { SetupStep } from '../../domain/setup/types.js';
import type { LoginDeps } from '../login/deps.js';
import { assertWritable } from '../safety/posture.js';
import { toolChecks } from '../sync/checks.js';
import { ToolCheck } from '../tool/check.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import { prepareCommand } from './command.js';
import type { ServiceOutcome, ServiceResult } from './types.js';

export class ServiceOperation {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {}

  async execute(step: SetupStep, dryRun: boolean): Promise<ServiceResult> {
    const base = { id: step.id, tool: step.tool, env: step.env ?? null };
    try {
      const preparation = step.preparation;
      if (!preparation)
        return { ...base, status: 'failed', detail: 'No service preparation declared' };
      if (preparation.kind === 'file') return { ...base, ...(await this.file(step, dryRun)) };
      const tools = toolchainOf(this.deps.ctx)
        .tools.filter((tool) => tool.name === step.tool)
        .map((tool) => ({
          ...tool,
          minVersion:
            tool.minVersion && atLeast(tool.minVersion, preparation.minVersion)
              ? tool.minVersion
              : preparation.minVersion,
        }));
      const [version] = await new ToolCheck({
        run: this.deps.processRun,
        which: this.deps.processWhich,
      }).execute({
        tools,
        trust: {
          ...this.login.trust,
          workspace: this.deps.ctx.name,
          commandShell: this.deps.commandShell,
          dryRun,
        },
      });
      if (version?.state !== 'ok')
        return {
          ...base,
          status: 'blocked',
          detail: `${step.tool} is ${version?.state ?? 'unknown'}; requires ${version?.min_version ?? preparation.minVersion} for public service settings`,
          ...(version
            ? {
                actions:
                  toolChecks([{ ...version, preparation_required: step.required }], this.deps)[0]
                    ?.actions ?? [],
              }
            : {}),
          next_steps: [
            workspaceCommand(this.deps, 'doctor', '--tool', step.tool),
            workspaceCommand(this.deps, 'tool', 'update', step.tool),
          ],
        };
      return { ...base, ...(await prepareCommand(this.deps, this.login, step, dryRun)) };
    } catch (error) {
      const failure = toEnvelope(asDevkitError(error)).error;
      return {
        ...base,
        status: 'blocked',
        detail: failure.message,
        failure,
        next_steps: failure.next_steps,
      };
    }
  }

  private async file(step: SetupStep, dryRun: boolean): Promise<ServiceOutcome> {
    const prep = step.preparation;
    if (prep?.kind !== 'file')
      throw new DevkitError('internal', 'SERVICE_PREPARATION_INVALID', 'Expected file preparation');
    const target = path.join(this.deps.ctx.root, prep.relative);
    if ((await this.deps.fs.readLink(target)) || (await this.deps.fs.isDirectory(target)))
      return { status: 'blocked', detail: `${prep.relative} is a foreign path; left unchanged` };
    const before = await this.deps.fs.readText(target);
    if (before !== undefined && matchesPublicDefaults(before, prep.publicDefaults))
      return { status: 'unchanged', detail: 'Public workspace defaults match' };
    if (before !== undefined)
      return {
        status: 'blocked',
        detail: `${prep.relative} already exists with different content; left unchanged`,
        next_steps: [
          'Review the service declaration and the existing [defaults] section; preserve personal credentials outside the shared file.',
        ],
      };
    if (dryRun)
      return {
        status: 'planned',
        detail: `Create ${prep.relative} with public defaults only`,
        changes: Object.fromEntries(
          Object.entries(prep.publicDefaults).map(([key, value]) => [
            key,
            { before: null, after: value },
          ]),
        ),
      };
    assertWritable(this.login.trust.posture, step.id);
    await this.login.trust.gate.ensure({
      ...this.login.trust,
      workspace: this.deps.ctx.name,
      commandShell: this.deps.commandShell,
      vector: ['fx', 'sync', '--only', 'services'],
      origin: 'patch',
      label: step.id,
      execution: {
        purpose: 'public service defaults',
        resource: target,
        bindings: { content: prep.text },
      },
    });
    if (await this.deps.fs.exists(target))
      return { status: 'blocked', detail: 'Workspace defaults changed during preparation; retry' };
    await this.deps.fs.writeText(target, prep.text);
    return {
      status: 'configured',
      detail: 'Public workspace defaults created; personal login is separate',
    };
  }
}
