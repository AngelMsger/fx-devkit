// Ownership follows successful installation evidence, not the most recent updater.
// Legacy, interrupted and replaced installations remain explicitly uncertain.

import { pathKey } from '../path.js';

import type { InstallationOrigin, ToolInstallation } from './installation.js';

export function hasUnfinishedInstallation(events: readonly ToolInstallation[]): boolean {
  const attempts = new Map(events.map((event) => [event.id, event]));
  return [...attempts.values()].some((event) => event.event !== 'finished' || event.code === null);
}

export function originBeforeInstallation(
  events: readonly ToolInstallation[],
  binaryPath: string | null,
): InstallationOrigin {
  if (hasUnfinishedInstallation(events)) return 'unknown';
  if (binaryPath === null) return 'fx';
  if (events.length === 0) return 'external';
  return observedInstallationOrigin(events, binaryPath);
}

export function observedInstallationOrigin(
  events: readonly ToolInstallation[],
  binaryPath: string | null,
): InstallationOrigin {
  const success = [...events].reverse().find((event) => event.code === 0);
  if (
    binaryPath === null ||
    !success?.binary_path ||
    pathKey(binaryPath) !== pathKey(success.binary_path) ||
    hasUnfinishedInstallation(events)
  )
    return 'unknown';
  return success.installation_origin ?? 'unknown';
}
