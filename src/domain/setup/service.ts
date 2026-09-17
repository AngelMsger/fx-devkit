// Adapter-produced preparation contains only public settings, never credentials.
import type { SetupRecipe } from './types.js';

export type ServicePreparation =
  | {
      readonly kind: 'command';
      readonly resource: string;
      readonly minVersion: string;
      readonly command: readonly string[];
    }
  | {
      readonly kind: 'file';
      readonly relative: string;
      readonly text: string;
      readonly publicDefaults: Readonly<Record<string, string>>;
    };

export interface ServiceDefinition {
  readonly preparation: ServicePreparation;
  readonly recipes: readonly SetupRecipe[];
  readonly env?: Readonly<Record<string, string>>;
}
