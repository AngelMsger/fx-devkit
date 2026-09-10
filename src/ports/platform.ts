// A platform instance from environments.yaml, alive: it turns the merged
// variables of one environment into a coordinate. Each environment-scoped
// capability names its own port so the registry can type them apart.

import type { Capability } from '../domain/capability.js';
import type { Coordinate, ProbeVector } from '../domain/obs/types.js';
import type { Vars } from '../domain/template.js';

export interface Platform {
  readonly id: string;
  readonly capability: Capability;
  locate(vars: Vars): Coordinate;
  probe?(vars: Vars): ProbeVector | undefined;
}
