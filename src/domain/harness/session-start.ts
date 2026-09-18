// Session-start context is a bounded description of prior observations, never
// a fresh readiness claim. Scheduling keeps bursts from spawning more workers.

import type { HookState } from './state.js';

export function shouldScheduleSessionStart(ageMs: number): boolean {
  return ageMs < 0 || ageMs >= 15000;
}

export function describeSessionStart(input: {
  readonly state: HookState | null;
  readonly readOnly: boolean;
}): string {
  const lines =
    input.state?.observations.map(
      (o) =>
        `${new Date(o.checkedAt).toISOString()}: ${o.code}${o.detail ? ` (${o.detail})` : ''}${o.command ? `; check with ${o.command}` : ''}`,
    ) ?? [];
  return [
    input.readOnly
      ? 'fx automatic sync is disabled by the read-only posture.'
      : 'fx automatic sync is asynchronous; updated resources may apply next session.',
    lines.length
      ? 'Previous observations (not current readiness):'
      : 'No previous readiness observations. Ask fx can or fx doctor when needed.',
    ...lines,
  ].join('\n');
}
