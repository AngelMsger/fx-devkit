// The last thing a command says: whether fx or the manifest is behind.
// Never for the commands that are themselves the remedy.

import type { FxUpdateInput } from '../application/update/fx.js';
import type { ManifestUpdateInput } from '../application/update/manifest.js';
import { fxOutdated, manifestOutdated } from '../application/update/notices.js';
import type { UpdateChecks } from '../composition/update.js';
import type { Notice } from '../ports/reporter.js';

const NEVER = new Set(['self:update', 'completion', 'hook:dispatch']);

export interface UpdateCheckGate {
  readonly id: string | undefined;
  readonly quiet: boolean;
  readonly enabled: boolean;
}

export function shouldCheckUpdates(gate: UpdateCheckGate): boolean {
  return (
    gate.enabled &&
    !gate.quiet &&
    gate.id !== undefined &&
    !gate.id.startsWith('skill:') &&
    !NEVER.has(gate.id)
  );
}

// The two checks run side by side and contain their own remote deadlines;
// orchestration catches failures without timing their local cache and config IO.
export async function updateNotices(
  checks: UpdateChecks,
  fx: FxUpdateInput,
  manifest: ManifestUpdateInput | undefined,
): Promise<Notice[]> {
  const quietly = async (work: () => Promise<Notice | undefined>): Promise<Notice | undefined> => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  };
  const notices = await Promise.all([
    manifest === undefined
      ? Promise.resolve(undefined)
      : quietly(() => checks.manifest.execute(manifest).then(manifestOutdated)),
    quietly(() => checks.fx.execute(fx).then(fxOutdated)),
  ]);
  return notices.filter((n): n is Notice => n !== undefined);
}
