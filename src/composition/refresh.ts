// Bind source adapters and update receipts to the pre-sync refresh workflow.

import {
  refreshWorkspaceManifest,
  type RefreshManifestOutput,
} from '../application/manifest/refresh.js';
import type { WritePosture } from '../application/safety/posture.js';
import type { ResolveInput } from '../application/workspace/resolve.js';

import type { Container } from './container.js';
import { manifestSourceFor } from './manifest-sources.js';
import { updateChecks } from './update.js';

export function refreshManifestBeforeSync(
  container: Container,
  resolve: ResolveInput,
  run: { readonly dryRun: boolean; readonly posture: WritePosture },
): Promise<RefreshManifestOutput> {
  return refreshWorkspaceManifest(
    {
      lock: container.lock,
      sourceFor: (spec) => manifestSourceFor(spec, container, async () => ''),
      settle: (name, dir) => updateChecks(container).manifest.markCurrent(name, dir),
    },
    resolve,
    run,
  );
}
