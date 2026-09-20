// Bind manifest editing to the shared compare-and-replace file port.
import {
  SetRepoField,
  type SetRepoFieldInput,
  type SetRepoFieldOutput,
} from '../application/manifest/set.js';
import { FileProjectionStore } from '../infra/projection-store.js';

import type { Container } from './container.js';

export function editManifestRepo(
  container: Container,
  input: SetRepoFieldInput,
): Promise<SetRepoFieldOutput> {
  return new SetRepoField(new FileProjectionStore(container.lock)).execute(input);
}
