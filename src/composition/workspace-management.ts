// Compose lifecycle cleanup ports without exposing filesystem ownership details to commands.

import { ManageWorkspace } from '../application/workspace/manage.js';
import { WorkspaceResources } from '../application/workspace/resources.js';

import { harnessDeps, type HarnessCommandInput } from './harness.js';
import { hookDeps } from './hooks.js';

export function workspaceManagement(input: HarnessCommandInput): ManageWorkspace {
  const container = input.container;
  return new ManageWorkspace({
    fs: container.fs,
    config: container.config,
    lock: container.lock,
    manifestDirFor: container.manifestDirFor,
    bundledTools: container.bundledTools,
    cliVersion: input.cliVersion,
    resources: new WorkspaceResources(container.fs, harnessDeps(input), hookDeps(container)),
  });
}
