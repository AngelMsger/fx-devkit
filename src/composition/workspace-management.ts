// Compose lifecycle cleanup ports without exposing filesystem ownership details to commands.

import { ManageWorkspace } from '../application/workspace/manage.js';
import { WorkspaceResources } from '../application/workspace/resources.js';
import type { ResolvedShell } from '../domain/shell.js';
import { workspaceHome } from '../infra/workspace-home.js';

import { harnessDeps, type HarnessCommandInput } from './harness.js';
import { hookDeps } from './hooks.js';

export function workspaceManagement(
  input: HarnessCommandInput & { readonly commandShell?: ResolvedShell },
): ManageWorkspace {
  const container = input.container;
  return new ManageWorkspace({
    fs: container.fs,
    config: container.config,
    lock: container.lock,
    manifestDirFor: container.manifestDirFor,
    workspaceHomeFor: (name) => workspaceHome(container.fxHome, name),
    bundledTools: container.bundledTools,
    providers: container.providers,
    cliVersion: input.cliVersion,
    commandShell: input.commandShell,
    resources: new WorkspaceResources(
      container.fs,
      harnessDeps(input),
      hookDeps(container),
      container.projections,
    ),
  });
}
