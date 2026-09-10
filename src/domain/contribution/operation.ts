// An operation journal stores identities and intended transitions, never file
// contents or PR prose. Prepared objects are recorded before ref publication.

import type { PendingContribution } from './pending.js';

export interface ContributionOperation extends PendingContribution {
  readonly base: string;
  readonly parent: string;
  readonly previousHead: string | null;
  readonly sourceFingerprint: string;
  readonly paths: readonly string[];
  readonly pullRequestId: string | null;
}
