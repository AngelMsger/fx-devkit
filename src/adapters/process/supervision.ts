// A supervised worker is timed and reaped by its supervisor, so it never owns
// the process group of a companion command. Its role names who is waiting on
// the run.

import type { LifecycleRole } from '../../ports/lifecycle-runner.js';

const VARIABLE = 'FX_LIFECYCLE_WORKER';

export function supervisedRole(): LifecycleRole | undefined {
  if (process.send === undefined) return undefined;
  const value = process.env[VARIABLE];
  return value === 'foreground' || value === 'background' ? value : undefined;
}

export function supervisedBy(role: LifecycleRole): NodeJS.ProcessEnv {
  return { [VARIABLE]: role };
}

// The background supervisor is started by a foreground worker and supervises
// rather than serves; it must not inherit that worker's role.
export function unsupervised(): NodeJS.ProcessEnv {
  return { [VARIABLE]: '' };
}
