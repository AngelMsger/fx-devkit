// What the setup and doctor use cases need beyond the workspace bundle: the
// provider registry (for recipes), a person to talk to, the trust gate for
// patch-supplied vectors, a clock for acknowledgements, and the home
// directory that `~` in a manifest path stands for.

import type { Clock } from '../../ports/clock.js';
import type { Prompter } from '../../ports/prompter.js';
import type { ProviderDescriptor } from '../../ports/provider.js';
import type { WritePosture } from '../safety/posture.js';
import type { TrustGate } from '../safety/trust.js';

export interface LoginDeps {
  readonly describeProvider: (id: string) => ProviderDescriptor<unknown> | undefined;
  readonly prompter: Prompter;
  readonly clock: Clock;
  readonly home: string;
  readonly trust: {
    readonly gate: TrustGate;
    readonly yes: boolean;
    readonly posture: WritePosture;
  };
}
