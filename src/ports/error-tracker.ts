// Where runtime errors are collected: a platform that can also list what
// is still unresolved in a project. `release` asks it that, and nothing else.

import type { IssuePage, IssueQuery } from '../domain/obs/types.js';
import type { Vars } from '../domain/template.js';

import type { Platform } from './platform.js';

export type { Issue, IssuePage, IssueQuery } from '../domain/obs/types.js';

export interface ErrorTracker extends Platform {
  issues(vars: Vars, query: IssueQuery): Promise<IssuePage>;
}
