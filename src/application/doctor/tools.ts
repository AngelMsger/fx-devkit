// A required tool that is missing or too old breaks the workspace; an
// optional one only narrows what can be done.

import { DevkitError } from '../../domain/errors.js';
import type { LoginDeps } from '../login/deps.js';
import { commandTrustHandoff, isTrustRequired } from '../safety/trust.js';
import { ToolCheck, type ToolStatus } from '../tool/check.js';
import { selectTools } from '../tool/select.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { finding, type Finding } from './types.js';

export interface ToolCheckOptions {
  readonly names?: readonly string[] | undefined;
  readonly trust: LoginDeps['trust'];
}

export async function checkTools(
  deps: WorkspaceDeps,
  options: ToolCheckOptions,
): Promise<Finding[]> {
  const check = new ToolCheck({ run: deps.processRun, which: deps.processWhich });
  const available = toolchainOf(deps.ctx).tools;
  const selected = new Set(selectTools(available, options.names).map((tool) => tool.name));
  const tools = available.filter((tool) => selected.has(tool.name));
  const findings: Finding[] = [];
  for (const tool of tools) {
    try {
      const [status] = await check.execute({
        tools: [tool],
        trust: { ...options.trust, workspace: deps.ctx.name },
      });
      if (status !== undefined) findings.push(fromStatus(status));
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

function fromStatus(status: ToolStatus): Finding {
  const { name } = status;
  switch (status.state) {
    case 'ok':
      return finding('tools', name, 'ok', `${status.installed} installed`);
    case 'disabled':
      return finding('tools', name, 'ok', 'disabled by the manifest');
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
