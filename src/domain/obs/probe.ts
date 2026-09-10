// Only definite probe outcomes can change shared confidence. Authentication
// and transport uncertainty never become claims about resource existence.

import type { Confidence } from './confidence.js';

export type ProbeOutcome = 'reachable' | 'unauthorized' | 'missing' | 'unknown';

export function confidenceForProbe(outcome: ProbeOutcome): Confidence | null {
  if (outcome === 'reachable') return 'verified';
  if (outcome === 'missing') return 'not_found';
  return null;
}
