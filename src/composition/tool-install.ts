// All companion installation entry points share the same durable personal ledger.

import { ToolAudit } from '../application/tool/audit.js';
import { ToolInstall } from '../application/tool/install.js';

import type { Container } from './container.js';

export function toolInstall(container: Container): ToolInstall {
  return new ToolInstall({
    installers: container.installers,
    process: container.process,
    audit: new ToolAudit(container.toolHistory, container.clock),
  });
}
