// A provider is one implementation of a capability's port plus what fx needs to know to
// wire it: the facts a manifest is read against, the tools it drives, the variables the
// manifest must supply, and the setup steps it brings. Every adapter directory exports one
// descriptor; the registry collects them.

import type { ProviderFacts } from '../domain/manifest/providers.js';
import type { ServiceSettings } from '../domain/manifest/service.schema.js';
import type { ServiceDefinition } from '../domain/setup/service.js';
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

export interface ProviderDescriptor<P> extends ProviderFacts {
  readonly recipes: readonly SetupRecipe[];
  // Values the recipes read that the provider works out from a binding's own variables,
  // e.g. the host name inside a clone URL.
  readonly recipeVars?: (vars: Vars) => Vars;
  readonly service?: (settings: ServiceSettings) => ServiceDefinition;
  readonly vars: readonly VarSpec[];
  // A reference provider creates a pure entry coordinate, not a live business client.
  readonly reference?: true;
  // For an environment-scoped provider: what each environment supplies.
  readonly envVars?: readonly VarSpec[];
  create(deps: AdapterDeps, vars: Vars): P;
}
