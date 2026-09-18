// What a provider declares to prepare one service: its preparation, the recipes
// that verify it, and the environment its commands need.
import type { ServicePreparation, SetupRecipe } from './types.js';

export interface ServiceDefinition {
  readonly preparation: ServicePreparation;
  readonly recipes: readonly SetupRecipe[];
  readonly env?: Readonly<Record<string, string>>;
}
