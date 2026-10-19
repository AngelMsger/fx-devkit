// Supply local manifest and personal history readers without executing tool vectors.

import { ToolInstalled } from '../application/tool/installed.js';

import type { Container } from './container.js';

export function toolInventory(container: Container, cliVersion: string): ToolInstalled {
  return new ToolInstalled({
    history: container.toolHistory,
    config: container.config,
    fs: container.fs,
    process: container.process,
    bundledTools: container.bundledTools,
    providers: container.providers,
    manifestDirFor: container.manifestDirFor,
    cliVersion,
  });
}
