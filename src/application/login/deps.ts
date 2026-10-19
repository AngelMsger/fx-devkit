// What the setup and doctor use cases need beyond the workspace bundle: the
// provider registry (for recipes), a person to talk to, a clock for
// acknowledgements, and the home directory that `~` in a manifest path stands for.

import type { Clock } from '../../ports/clock.js';
import type { Prompter } from '../../ports/prompter.js';
import type { ProviderDescriptor } from '../../ports/provider.js';
import type { ServiceProtocol } from '../../ports/service-protocol.js';

export interface LoginDeps {
  readonly serviceProtocol: ServiceProtocol;
  readonly describeProvider: (id: string) => ProviderDescriptor<unknown> | undefined;
  readonly prompter: Prompter;
  readonly clock: Clock;
  readonly home: string;
}
