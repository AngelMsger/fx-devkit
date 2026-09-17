// A required tool that is missing or too old breaks the workspace; an
// optional one only narrows what can be done.

import { DevkitError } from '../../domain/errors.js';
import type { LoginDeps } from '../login/deps.js';
import { commandTrustHandoff, isTrustRequired } from '../safety/trust.js';
import { ToolCheck, type ToolStatus } from '../tool/check.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { DoctorToolScope } from './tool-scope.js';
import { finding, type Finding } from './types.js';

export interface ToolCheckOptions extends DoctorToolScope {
  readonly trust: LoginDeps['trust'];
}

export async function checkTools(
  deps: WorkspaceDeps,
  options: ToolCheckOptions,
): Promise<Finding[]> {
  const check = new ToolCheck({ run: deps.processRun, which: deps.processWhich });
  const available = toolchainOf(deps.ctx).tools;
  const tools = available.filter((tool) => options.names.includes(tool.name));
  const findings: Finding[] = options.names
    .filter((name) => !available.some((tool) => tool.name === name))
    .map((name) =>
      finding('tools', name, 'fail', 'active provider requires a tool missing from the toolchain', {
        coverage: 'incomplete',
        fix: 'fx manifest validate',
      }),
    );
  for (const tool of tools) {
    try {
      const [status] = await check.execute({
        tools: [{ ...tool, required: options.required.has(tool.name) }],
        trust: { ...options.trust, workspace: deps.ctx.name },
      });
      if (status !== undefined)
        findings.push({
          ...fromStatus(status, options.dependencies.has(tool.name)),
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
      if (!isTrustRequired(err)) {
        findings.push(
          finding('tools', tool.name, 'warn', err.message, {
            coverage: 'incomplete',
            fix: `fx tool show ${tool.name}`,
          }),
        );
        continue;
      }
      const handoff = commandTrustHandoff({ tool: tool.name, posture: options.trust.posture });
      findings.push(
        finding('tools', tool.name, 'warn', err.message, {
          coverage: 'incomplete',
          fix: handoff.command,
          handoff,
        }),
      );
    }
  }
  return findings;
}

function fromStatus(status: ToolStatus, activeDependency: boolean): Finding {
  const { name } = status;
  switch (status.state) {
    case 'ok':
      return finding('tools', name, 'ok', `${status.installed} installed`);
    case 'disabled':
      return activeDependency
        ? finding(
            'tools',
            name,
            status.required ? 'fail' : 'warn',
            'disabled by the manifest but used by an active provider',
            {
              coverage: 'incomplete',
              fix: `fx tool show ${name}`,
            },
          )
        : finding('tools', name, 'ok', 'disabled by the manifest; not checked', {
            coverage: 'not_applicable',
          });
    case 'missing':
      return finding('tools', name, status.required ? 'fail' : 'warn', 'not installed', {
        fix: `fx tool install ${name}`,
      });
    case 'outdated':
      return finding(
        'tools',
        name,
        status.required ? 'fail' : 'warn',
        `${status.installed} installed, ${status.min_version} required`,
        { fix: `fx tool update ${name}` },
      );
    case 'unknown':
      return finding('tools', name, 'warn', 'installed but its version could not be read', {
        coverage: 'incomplete',
        fix: `fx tool show ${name}`,
      });
  }
}
