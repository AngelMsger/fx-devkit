// Where builds run: a platform that can also say how a job's last build
// went. `release` asks it that, and nothing else.

import type { Build } from '../domain/obs/types.js';
import type { Vars } from '../domain/template.js';

import type { Platform } from './platform.js';

export type { Build, BuildStatus } from '../domain/obs/types.js';

export interface Ci extends Platform {
  // undefined when the job the coordinate names does not exist.
  lastBuild(vars: Vars): Promise<Build | undefined>;
}
