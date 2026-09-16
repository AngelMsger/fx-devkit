// What the checks say on stderr when something is behind; nothing when not.

import type { Notice } from '../../ports/reporter.js';

import type { FxVerdict } from './fx.js';
import type { ManifestVerdict } from './manifest.js';
import { SILENCE } from './policy.js';

export function fxOutdated(verdict: FxVerdict): Notice | undefined {
  if (!verdict.behind || verdict.latest === null) return undefined;
  return {
    code: 'FX_OUTDATED',
    message: `fx ${verdict.current} is behind ${verdict.latest}`,
    nextSteps: ['fx self update --yes', 'fx skill install'],
    silence: SILENCE,
  };
}

export function manifestOutdated(verdict: ManifestVerdict): Notice | undefined {
  if (!verdict.behind) return undefined;
  return {
    code: 'MANIFEST_OUTDATED',
    message: `the manifest repository of workspace ${verdict.workspace} has new commits upstream since the last fx sync`,
    nextSteps: ['fx sync'],
    silence: SILENCE,
  };
}
