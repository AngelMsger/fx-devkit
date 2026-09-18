// Refreshing the manifest checkout before `fx sync` loads the workspace, so
// sync sees the new manifest and a broken one can still be replaced. Wiring
// only: the decision is RefreshManifest's.

import { RefreshManifest } from '../application/refresh-manifest.js';
import type { WritePosture } from '../application/safety/posture.js';
import { resolveWorkspace, type ResolveInput } from '../application/workspace/resolve.js';
import { busyError } from '../domain/errors.js';

import type { Container } from './container.js';
import { manifestSourceFor } from './manifest-sources.js';
import { updateChecks } from './update.js';

export async function refreshManifestBeforeSync(
  container: Container,
  resolve: ResolveInput,
  run: { readonly dryRun: boolean; readonly posture: WritePosture },
): Promise<void> {
  const located = await resolveWorkspace(resolve);
  const entry = (await container.config.read()).workspaces?.[located.name];
  const source =
    entry?.source === undefined
      ? undefined
      : await manifestSourceFor(entry.source, container, async () => '');
  const lease =
    run.dryRun || run.posture.readOnly
      ? undefined
      : await container.lock.acquire({ key: `workspace:${located.name}`, waitMs: 2000 });
  if (lease === null)
    throw busyError('LOCK_BUSY', 'The workspace', { nextSteps: ['Retry fx sync shortly.'] });
  try {
    await new RefreshManifest(resolve.reporter).execute({
      manifestDir: located.manifestDir,
      source,
      ...run,
      settle: () => updateChecks(container).manifest.markCurrent(located.name, located.manifestDir),
    });
  } finally {
    await lease?.release();
  }
}
