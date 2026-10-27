// All companion installation entry points share the same durable personal ledger.

import { ToolAudit } from '../application/tool/audit.js';
import { ToolInstall } from '../application/tool/install.js';
import {
  ToolInstallWithSkills,
  type ToolInstallWithSkillsDeps,
} from '../application/tool/with-skills.js';

import type { Container } from './container.js';

export function toolInstall(container: Container): ToolInstall {
  return new ToolInstall({
    installers: container.installers,
    process: container.process,
    audit: new ToolAudit(container.toolHistory, container.clock),
  });
}

// The tool commands install packages and then the Skills of what they installed.
export function toolInstallWithSkills(
  container: Container,
  deps: Omit<ToolInstallWithSkillsDeps, 'install' | 'process'>,
): ToolInstallWithSkills {
  return new ToolInstallWithSkills({
    ...deps,
    install: toolInstall(container),
    process: container.process,
  });
}
