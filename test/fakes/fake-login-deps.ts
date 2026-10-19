import path from 'node:path';

import { FamilyServiceProtocol } from '../../src/adapters/family/service-protocol.js';
import type { LoginDeps } from '../../src/application/login/deps.js';
import type { ProviderDescriptor } from '../../src/ports/provider.js';

import { FakeClock } from './fake-clock.js';
import { FakePrompter } from './fake-prompter.js';

export function fakeLoginDeps(descriptors: Record<string, ProviderDescriptor<unknown>>): LoginDeps {
  const prompter = new FakePrompter();
  prompter.unavailable = true;
  return {
    serviceProtocol: new FamilyServiceProtocol(),
    describeProvider: (id) => descriptors[id],
    prompter,
    clock: new FakeClock(),
    home: path.resolve('/home/me'),
  };
}
