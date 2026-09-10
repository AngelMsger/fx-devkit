// The two update checks, over the personal cache and the system git.

import { CachedProbe } from '../application/update/check.js';
import { FxUpdateCheck } from '../application/update/fx.js';
import { ManifestUpdateCheck } from '../application/update/manifest.js';
import { PROBE_TIMEOUT_MS } from '../application/update/policy.js';

import type { Container } from './container.js';

export interface UpdateChecks {
  readonly fx: FxUpdateCheck;
  readonly manifest: ManifestUpdateCheck;
}

export function updateChecks(container: Container): UpdateChecks {
  const probe = new CachedProbe(container.cache, container.clock);
  return {
    fx: new FxUpdateCheck(probe, (url) => container.registryAt(url, PROBE_TIMEOUT_MS)),
    manifest: new ManifestUpdateCheck(probe, container.git),
  };
}
