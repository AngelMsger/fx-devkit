import path from 'node:path';

import { FamilyServiceProtocol } from '../../src/adapters/family/service-protocol.js';
import type { LoginDeps } from '../../src/application/login/deps.js';
import { TrustGate } from '../../src/application/safety/trust.js';
import type { ProviderDescriptor } from '../../src/ports/provider.js';

import { FakeClock } from './fake-clock.js';
import { FakePrompter } from './fake-prompter.js';
import { FakeTrustStore } from './fake-trust-store.js';

export function fakeLoginDeps(
  descriptors: Record<string, ProviderDescriptor<unknown>>,
  options: { unavailable?: boolean; yes?: boolean } = {},
): LoginDeps {
  const prompter = new FakePrompter();
  prompter.unavailable = options.unavailable ?? true;
  return {
    serviceProtocol: new FamilyServiceProtocol(),
    describeProvider: (id) => descriptors[id],
    prompter,
    clock: new FakeClock(),
    home: path.resolve('/home/me'),
    trust: {
      gate: new TrustGate(new FakeTrustStore(), prompter, new FakeClock()),
      yes: options.yes ?? false,
      posture: { readOnly: false, source: 'default' },
    },
  };
}
