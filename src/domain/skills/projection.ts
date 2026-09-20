// What to do at one Skill location. Ownership decides it, by the rules AGENTS.md states
// under workspace and data ownership: the stage never replaces a directory it did not
// create.

import { samePath } from '../path.js';
import { atLeast } from '../semver.js';

export type LinkObservation =
  | { readonly kind: 'absent' }
  | { readonly kind: 'link'; readonly target: string }
  | { readonly kind: 'directory' }
  | { readonly kind: 'file' };

export type LinkAction = 'create' | 'unchanged' | 'prune' | 'foreign' | 'skip';

export interface LinkDecision {
  readonly action: LinkAction;
  readonly reason?: string;
}

export function decideLink(
  observed: LinkObservation,
  wantedTarget: string,
  hasSource: boolean,
): LinkDecision {
  if (observed.kind === 'absent') return { action: hasSource ? 'create' : 'skip' };
  if (observed.kind !== 'link')
    return { action: 'foreign', reason: `a ${observed.kind} not created by fx is already there` };
  if (!samePath(observed.target, wantedTarget)) {
    return {
      action: 'foreign',
      reason: `a link to ${observed.target} not created by fx is already there`,
    };
  }
  return { action: hasSource ? 'unchanged' : 'prune' };
}

export type CopyObservation =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ours'; readonly version: string }
  | { readonly kind: 'foreign' };

export type CopyAction = 'install' | 'upgrade' | 'unchanged' | 'foreign';

export function decideCopy(observed: CopyObservation, cliVersion: string): CopyAction {
  if (observed.kind === 'absent') return 'install';
  if (observed.kind === 'foreign') return 'foreign';
  return atLeast(observed.version, cliVersion) ? 'unchanged' : 'upgrade';
}
