// Where runtime errors are collected: a platform that can also list what
// is still unresolved in a project. `release` asks it that, and nothing else.

import type { IssuePage, IssueQuery } from '../domain/obs/types.js';
import type { Vars } from '../domain/template.js';

import type { Platform } from './platform.js';

export type { Issue, IssueFailure, IssuePage, IssueQuery } from '../domain/obs/types.js';

export interface ErrorTracker extends Platform {
  issues(vars: Vars, query: IssueQuery): Promise<IssuePage>;
  // Identifies the actual query scope, excluding unrelated workspace labels.
  // null means the configured endpoint/scope cannot be established.
  queryFingerprint?(vars: Vars): string | null;
}
