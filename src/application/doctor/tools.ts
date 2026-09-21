// A required tool that is missing or too old breaks the workspace; an
// optional one only narrows what can be done.

import { DevkitError } from '../../domain/errors.js';
import type { LoginDeps } from '../login/deps.js';
import { commandTrustHandoff, isTrustRequired } from '../safety/trust.js';
import { toolChecks } from '../sync/checks.js';
import { ToolCheck, type ToolStatus } from '../tool/check.js';
import type { WorkspaceToolScope } from '../tool/scope.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand, type WorkspaceGuidance } from '../workspace/guidance.js';

import { finding, type Finding } from './types.js';

export interface ToolCheckOptions extends WorkspaceToolScope {
  readonly trust: LoginDeps['trust'];
}

export async function checkTools(
  deps: WorkspaceDeps,
  options: ToolCheckOptions,
): Promise<Finding[]> {
  const check = new ToolCheck({ run: deps.processRun, which: deps.processWhich });
  const tools = options.covered;
  const findings: Finding[] = [];
  const trust = { ...options.trust, workspace: deps.ctx.name, commandShell: deps.commandShell };
  for (const tool of tools) {
    try {
      const [status] = await check.execute({
        tools: [{ ...tool, required: options.required.has(tool.name) }],
        trust,
      });
      if (status !== undefined)
        findings.push({
          ...fromStatus(status, options.dependencies.has(tool.name), deps),
          required: options.required.has(tool.name),
          actions:
            toolChecks(
              [{ ...status, preparation_required: options.required.has(tool.name) }],
              deps,
            )[0]!.actions ?? [],
          evidence: {
            binary: status.binary,
            binary_path: status.binary_path ?? null,
            state: status.state,
            required: status.required,
            active_dependency: options.dependencies.has(tool.name),
            installed: status.installed,
            min_version: status.min_version,
          },
        });
    } catch (err) {
      if (!(err instanceof DevkitError)) throw err;
      findings.push(toolCheckFailure(deps, options, tool.name, err));
    }
  }

  return findings;
}

function toolCheckFailure(
  deps: WorkspaceDeps,
  options: ToolCheckOptions,
  name: string,
  error: DevkitError,
): Finding {
  const required = options.required.has(name);
  if (!isTrustRequired(error))
    return finding('tools', name, 'warn', error.message, {
      coverage: 'incomplete',
      required,
      fix: workspaceCommand(deps, 'tool', 'show', name),
    });
  const handoff = commandTrustHandoff({
    tool: name,
    workspace: deps.ctx.name,
    posture: options.trust.posture,
    commandShell: deps.commandShell,
  });
  return finding('tools', name, 'warn', error.message, {
    coverage: 'incomplete',
    required,
    fix: handoff.command,
    handoff,
    actions: [
      {
        id: `approve:${name}`,
        description: `Review ${name}'s exact probe arguments, then approve the check`,
        argv: ['fx', 'doctor', '--tool', name, '--workspace', deps.ctx.name, '--yes'],
        cwd: deps.ctx.root,
        actor: 'agent',
        requires_approval: true,
      },
    ],
  });
}

function fromStatus(
  status: ToolStatus,
  activeDependency: boolean,
  deps: WorkspaceGuidance,
): Finding {
  const { name } = status;
  switch (status.state) {
    case 'ok':
      return finding('tools', name, 'ok', `${status.installed} installed`);
    case 'disabled':
      return status.required || activeDependency
        ? finding(
            'tools',
            name,
            status.required ? 'fail' : 'warn',
            status.required
              ? 'disabled by the manifest but required by the workspace'
              : 'disabled by the manifest but used by an active provider',
            {
              coverage: 'incomplete',
              fix: workspaceCommand(deps, 'tool', 'show', name),
            },
          )
        : finding('tools', name, 'ok', 'disabled by the manifest; not checked', {
            coverage: 'not_applicable',
          });
    case 'missing':
      return finding('tools', name, status.required ? 'fail' : 'warn', 'not installed', {
        fix: workspaceCommand(deps, 'tool', 'install', name),
      });
    case 'outdated':
      return finding(
        'tools',
        name,
        status.required ? 'fail' : 'warn',
        `${status.installed} installed, ${status.min_version} required`,
        { fix: workspaceCommand(deps, 'tool', 'update', name) },
      );
    case 'unknown':
      return finding('tools', name, 'warn', 'installed but its version could not be read', {
        coverage: 'incomplete',
        fix: workspaceCommand(deps, 'tool', 'show', name),
      });
  }
}
