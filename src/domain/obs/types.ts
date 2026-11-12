// Where to look on a platform. A provider's `Coordinate` is the default template filled
// in; an `ObsCoordinate` is the answer for one repository in one environment, with
// everything the manifest had to say about it. fx prints coordinates, it never executes
// them.

import type { ErrorEnvelope } from '../errors.js';
import type { TimeRange } from '../release/window.js';
import type { Vars } from '../template.js';

import type { Confidence } from './confidence.js';

export interface Coordinate {
  readonly label: string;
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly note?: string;
}

// A read-only command a provider offers for checking that a coordinate
// exists; the application runs it, the adapter only names it.
export interface ProbeVector {
  readonly label: string;
  readonly command: readonly string[];
  readonly template?: readonly string[];
}

// What a ci platform says about a job's latest build.
export type BuildStatus =
  'success' | 'failure' | 'unstable' | 'aborted' | 'building' | 'not_built' | 'unknown';

export interface Build {
  readonly number: number;
  readonly status: BuildStatus;
  // ISO 8601; null when the platform did not say.
  readonly startedAt: string | null;
  readonly url: string | null;
  // The commit the build checked out; null when the platform did not say.
  readonly commit: string | null;
}

// What an error tracker says about one open issue.
export interface Issue {
  readonly id: string;
  readonly shortId: string;
  readonly title: string;
  readonly level: string;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly count: number;
  readonly url: string | null;
  readonly culprit: string | null;
  // Legacy firstSeen means lifetime; explicit scope prevents a filtered list date masquerading as it.
  readonly firstSeenScope?: 'lifetime' | 'unknown';
  readonly listFirstSeen?: string | null;
  readonly windowFirstSeen?: string | null;
  readonly status?: string | null;
  // Receipt time of the metadata response that supplied this status, not the report start.
  readonly statusObservedAt?: string;
  readonly assignee?: Readonly<Record<string, unknown>> | null;
}

export interface IssueFailure {
  readonly stage: 'list' | 'detail' | 'pagination' | 'metadata';
  readonly issue_id?: string;
  readonly error: ErrorEnvelope['error'];
}

export interface IssueQuery {
  // A window as the manifest writes it, e.g. 14d.
  readonly since: string;
  // The most issues worth returning.
  readonly limit: number;
  readonly range?: TimeRange;
  // Report start for correlation only; adapters independently date status observations.
  readonly observedAt?: string;
  readonly cursor?: string;
}

export interface IssuePage {
  readonly issues: readonly Issue[];
  // The tracker had more than the limit asked for, so the list is a floor.
  readonly more: boolean;
  readonly next?: string;
  readonly pagesRead?: number;
  readonly coverage?: 'checked' | 'incomplete';
  readonly failures?: readonly IssueFailure[];
  readonly truncationReason?: string;
}

export interface ObsCoordinate {
  readonly platform: string;
  readonly env: string;
  readonly repo: string;
  readonly provider: string | null;
  readonly capability: string;
  readonly status: 'located' | 'not_covered';
  readonly label: string;
  readonly command: string | null;
  readonly url: string | null;
  readonly confidence: Confidence;
  readonly notes: readonly string[];
  readonly vars: Vars;
}
