// Where builds run: a platform that can also say how a job's last build
// went, and which commit it built when the platform records that. `release`
// asks it that, and nothing else.

import type { Build } from '../domain/obs/types.js';
import type { Vars } from '../domain/template.js';

import type { Platform } from './platform.js';

export type { Build, BuildStatus } from '../domain/obs/types.js';

// What the caller knows about the build it wants: the branch whose head it judges. A
// provider whose coordinate already names one branch's builds keeps its own.
export interface BuildQuery {
  readonly branch: string;
}

export interface Ci extends Platform {
  // undefined when the job the coordinate names does not exist.
  lastBuild(vars: Vars, query: BuildQuery): Promise<Build | undefined>;
}
