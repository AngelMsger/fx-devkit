// Refresh the registered source before loading its manifest, under the same
// workspace lease used by resource synchronization. Broken manifests remain repairable.

import { busyError } from '../domain/errors.js';
import type { Lock } from '../ports/lock.js';
import type { ManifestSource } from '../ports/manifest-source.js';

import { RefreshManifest } from './refresh-manifest.js';
import type { WritePosture } from './safety/posture.js';
import { resolveWorkspace, type ResolveInput } from './workspace/resolve.js';

interface RefreshWorkspaceDeps {
  readonly lock: Lock;
  readonly sourceFor: (spec: string) => Promise<ManifestSource>;
  readonly settle: (name: string, manifestDir: string) => Promise<void>;
}

export async function refreshWorkspaceManifest(
  deps: RefreshWorkspaceDeps,
  resolve: ResolveInput,
  run: { readonly dryRun: boolean; readonly posture: WritePosture },
): Promise<void> {
  const located = await resolveWorkspace(resolve);
  const entry = (await resolve.config.read()).workspaces?.[located.name];
  const source = entry?.source === undefined ? undefined : await deps.sourceFor(entry.source);
  const lease =
    run.dryRun || run.posture.readOnly
      ? undefined
      : await deps.lock.acquire({ key: `workspace:${located.name}`, waitMs: 2000 });
  if (lease === null)
    throw busyError('LOCK_BUSY', 'The workspace', { nextSteps: ['Retry fx sync shortly.'] });
  try {
    await new RefreshManifest(resolve.reporter).execute({
      manifestDir: located.manifestDir,
      source,
      ...run,
      settle: () => deps.settle(located.name, located.manifestDir),
    });
  } finally {
    await lease?.release();
  }
}
