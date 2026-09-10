// A provider is one implementation of a capability's port plus what fx needs to know to
// wire it: the tools it drives, the variables the manifest must supply, and the setup
// steps it brings. Every adapter directory exports one descriptor; the registry collects
// them.

import type { Capability } from '../domain/capability.js';
import type { SetupRecipe } from '../domain/setup/types.js';

import type { Clock } from './clock.js';
import type { FileSystem } from './fs.js';
import type { Process } from './process.js';

export interface VarSpec {
  readonly name: string;
  readonly desc: string;
  readonly required: boolean;
}

export interface AdapterDeps {
  readonly process: Process;
  readonly fs: FileSystem;
  readonly clock: Clock;
}

export type Vars = Readonly<Record<string, string>>;

export interface ProviderDescriptor<P> {
  readonly id: string;
  readonly capability: Capability;
  readonly tools: readonly string[];
  readonly recipes: readonly SetupRecipe[];
  readonly vars: readonly VarSpec[];
  // A reference provider creates a pure entry coordinate, not a live business client.
  readonly reference?: true;
  // For an environment-scoped provider: what each environment supplies.
  readonly envVars?: readonly VarSpec[];
  create(deps: AdapterDeps, vars: Vars): P;
}
